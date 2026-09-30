//! The differential test for `ppsc`'s proxy elision.
//!
//! Every case runs twice in a realm modelling the page: once as written, with `window`,
//! `document` and the rest bound to the proxies - which is what `ppsc` promises the page sees -
//! and once rewritten, with them bound to the real objects, whose `location` is "REAL". Elision
//! must not change a single result, and must never hand the program the real `location`.
//!
//! The cases are `elide-tests/*.js`, each a file of `T(name, fn)` calls, one program per call:
//!
//! - `elide-tests/` - asserted in every configuration
//! - `elide-tests/this/` - a `this` reached through an unwrapped receiver, which only
//!   `ppsc_wrap_this` answers as the proxy would: asserted with it, printed without
//! - `elide-tests/limits/` - what the rewrite knowingly answers differently: printed, never asserted
//!
//! `ELIDE_DIFF=<dir>` adds a directory of generated cases (`elide-tests/generate.mjs`).

#[cfg(test)]
mod test {
	use std::{fs, path::Path};

	use boa_engine::{Context, Source};
	use clap::Parser;
	use js::cfg::JsRewriter;

	use crate::{RewriterOptions, rewriter::NativeRewriter};

	const REALM: &str = r#"
var __out = [];
var RL = { href: "REAL", toString() { return "REAL" } };
var SL = { href: "SAFE", toString() { return "SAFE" } };
var RW = { innerWidth: 1, name: "w", addEventListener(t, f) { this.__l = f }, open() { return PW }, setTimeout(f) { f() } };
var RD = { title: "t", cookie: "c", body: { tagName: "BODY" }, createElement(t) { var el = { tagName: t }; Object.defineProperty(el, "ownerDocument", { get() { return PD } }); return el }, querySelector() { return this.body } };
Object.defineProperty(RW, "location", { get() { return RL }, set(v) { __out.push("NAVIGATED-REAL") } });
Object.defineProperty(RD, "location", { get() { return RL }, set(v) { __out.push("NAVIGATED-REAL") } });
RW.window = RW; RW.self = RW; RW.frames = RW; RW.globalThis = RW; RW.document = RD; RW.top = RW; RW.parent = RW;
RW.eval = function () { return "REAL-EVAL" };
var SAFE_EVAL = function () { return "SAFE-EVAL" };
RD.defaultView = RW;
var PW, PD;
var hW = {
	get(t, p) {
		if (p === "location") return SL;
		if (p === "window" || p === "self" || p === "frames" || p === "globalThis" || p === "top" || p === "parent") return PW;
		if (p === "document") return PD;
		if (p === "eval") return SAFE_EVAL;
		return t[p];
	},
	set(t, p, v) { if (p === "location") { __out.push("NAVIGATED-SAFE"); return true } t[p] = v; return true },
};
var hD = {
	get(t, p) { if (p === "location") return SL; if (p === "defaultView") return PW; return t[p] },
	set(t, p, v) { if (p === "location") { __out.push("NAVIGATED-SAFE"); return true } t[p] = v; return true },
};
PW = new Proxy(RW, hW); PD = new Proxy(RD, hD);
// a native dispatching an event calls the listener with the real object, whatever it was added through
RW.dispatch = function () { this.__l.call(PW) };
RW.dispatchReal = function () { this.__l.call(RW) };
RD.dispatchReal = function (f) { f.call(RD) };

// the runtime the rewrite calls into
function $wrap(v) { return v === RW ? PW : v === RD ? PD : v === RL ? SL : v === RW.eval ? SAFE_EVAL : v }
function $scramjet$unwrap(v) { return v === PW ? RW : v === PD ? RD : v }
var $scramjet$rw = RW, $scramjet$rd = RD;
function $rewrite(s) { return s }
function $tryset() { return false }
["location", "parent", "top", "eval"].forEach(function (n) {
	Object.defineProperty(Object.prototype, "$sj_" + n, {
		get: function () { if (n === "location") return this === RW || this === RD ? SL : this.location; return $wrap(this[n]) },
		set: function (v) { if (n === "location" && (this === RW || this === RD)) { __out.push("NAVIGATED-SAFE"); return } this[n] = v },
		configurable: true, enumerable: false,
	});
});

function T(name, fn) {
	var r;
	try { r = fn(); r = typeof r === "object" && r !== null ? (r === PW ? "[PW]" : r === PD ? "[PD]" : r === RW ? "[RW!]" : r === RD ? "[RD!]" : "[obj]") : String(r) }
	catch (e) { r = "throw " + (e && e.name) }
	__out.push(name + "=" + r);
}
"#;

	/// What the page is handed for each global: the proxies, as written; the real objects, rewritten.
	const AS_WRITTEN: &str =
		"var window = PW, document = PD, self = PW, frames = PW, top = PW, parent = PW, location = SL;\n";
	const REWRITTEN: &str =
		"var window = RW, document = RD, self = RW, frames = RW, top = RW, parent = RW, location = RL;\n";

	fn run(program: &str, globals: &str) -> Result<String, String> {
		let mut ctx = Context::default();
		ctx.eval(Source::from_bytes(format!("{REALM}\n{globals}").as_bytes()))
			.map_err(|e| format!("realm: {e}"))?;
		ctx.eval(Source::from_bytes(program.as_bytes()))
			.map_err(|e| format!("eval: {e}"))?;
		let v = ctx
			.eval(Source::from_bytes(b"__out.join('\\n')"))
			.map_err(|e| format!("{e}"))?;
		Ok(v.to_string(&mut ctx).unwrap().to_std_string_escaped())
	}

	fn rewrite(src: &str, js_rewriter: JsRewriter, wrap_this: bool) -> Result<String, String> {
		let mut opts = RewriterOptions::parse_from(std::iter::empty::<std::ffi::OsString>());
		opts.js_rewriter = js_rewriter;
		opts.ppsc_wrap_this = wrap_this;
		let rw = NativeRewriter::new(&opts);
		let out = rw.rewrite(src, &opts).map_err(|e| format!("rewrite: {e}"))?;
		Ok(String::from_utf8(out.js.to_vec()).unwrap())
	}

	/// One program per `T(` case, after whatever the file declares before its first case.
	fn cases(text: &str) -> Vec<(String, String)> {
		let starts: Vec<usize> = text
			.match_indices("T(\"")
			.map(|(i, _)| i)
			.filter(|&i| i == 0 || text.as_bytes()[i - 1] == b'\n')
			.collect();
		let head = &text[..starts.first().copied().unwrap_or(text.len())];
		starts
			.iter()
			.enumerate()
			.map(|(j, &st)| {
				let end = starts.get(j + 1).copied().unwrap_or(text.len());
				let name = text[st..end].lines().next().unwrap_or("").chars().take(70).collect();
				(name, format!("{head}{}", &text[st..end]))
			})
			.collect()
	}

	#[derive(Default)]
	struct Tally {
		cases: u32,
		diffs: u32,
		leaks: u32,
		errors: u32,
		fixed: u32,
	}

	/// Runs every case of every `.js` file in `dir`; returns the tally, printing what differs.
	fn check_dir(dir: &Path, js_rewriter: JsRewriter, wrap_this: bool) -> Tally {
		let mut t = Tally::default();
		let mut files: Vec<_> = fs::read_dir(dir)
			.unwrap()
			.map(|e| e.unwrap().path())
			.filter(|p| p.extension().is_some_and(|e| e == "js"))
			.collect();
		files.sort();
		for f in files {
			for (name, src) in cases(&fs::read_to_string(&f).unwrap()) {
				t.cases += 1;
				// boa has panics of its own on a few shapes; those say nothing about the rewrite
				let outcome = std::panic::catch_unwind(|| {
					let expected = run(&src, AS_WRITTEN)?;
					let got = run(&rewrite(&src, js_rewriter, wrap_this)?, REWRITTEN)?;
					Ok::<_, String>((expected, got))
				});
				match outcome {
					Err(_) => {}
					Ok(Err(e)) => {
						t.errors += 1;
						println!("ERROR {name}: {}", e.chars().take(300).collect::<String>());
					}
					Ok(Ok((expected, got))) if expected == got => {}
					// closing a leak the proxy itself has is the one difference wanted
					Ok(Ok((expected, got))) if expected.contains("REAL") && !got.contains("REAL") => {
						t.fixed += 1;
					}
					Ok(Ok((expected, got))) => {
						if got.contains("REAL") && !expected.contains("REAL") {
							t.leaks += 1;
							println!("LEAK {name}\n   expected {expected}\n   got      {got}");
						} else {
							t.diffs += 1;
							println!("DIFF {name}\n   expected {expected}\n   got      {got}");
						}
					}
				}
			}
		}
		t
	}

	#[test]
	fn elide_diff() {
		let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("elide-tests");
		let mut dirs = vec![root.clone()];
		if let Ok(extra) = std::env::var("ELIDE_DIFF") {
			dirs.push(extra.into());
		}
		// generated cases that read a `this` through an unwrapped receiver
		let this_extra = std::env::var("ELIDE_DIFF_THIS").ok();
		let mut failed = false;
		for js_rewriter in [JsRewriter::Ppsc, JsRewriter::PpscHybrid] {
			for wrap_this in [false, true] {
				let label = format!("{js_rewriter:?}, wrap_this {wrap_this}");
				for dir in &dirs {
					let t = check_dir(dir, js_rewriter, wrap_this);
					println!(
						"elide_diff [{label}] {}: {} cases, {} diffs, {} leaks, {} errors, {} leaks closed",
						dir.display(),
						t.cases,
						t.diffs,
						t.leaks,
						t.errors,
						t.fixed
					);
					failed |= t.diffs + t.leaks + t.errors > 0;
				}
				for dir in std::iter::once(root.join("this")).chain(this_extra.iter().map(Into::into)) {
					let t = check_dir(&dir, js_rewriter, wrap_this);
					println!(
						"elide_diff [{label}] {}: {} cases, {} differ",
						dir.display(),
						t.cases,
						t.diffs + t.leaks + t.errors
					);
					failed |= wrap_this && t.diffs + t.leaks + t.errors > 0;
				}
				// the known limits, printed for the record
				let t = check_dir(&root.join("limits"), js_rewriter, wrap_this);
				println!("elide_diff [{label}] limits: {} cases, {} differ", t.cases, t.diffs + t.leaks);
			}
		}
		assert!(!failed, "elision changed what a program sees; see the output above");
	}
}
