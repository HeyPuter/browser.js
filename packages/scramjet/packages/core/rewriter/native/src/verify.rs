//! `native verify`: rewrites a set of scripts with each rewriter, as the service worker would, and
//! checks that every output still parses - reporting what did not, and how long each rewriter
//! took.

use std::{
	path::{Path, PathBuf},
	sync::{
		Mutex,
		atomic::{AtomicUsize, Ordering},
	},
	time::Instant,
};

use js::cfg::{IncumbencyMode, JsRewriter};
use oxc::{
	allocator::Allocator,
	parser::{ParseOptions, Parser},
	span::SourceType,
};

use crate::{RewriterOptions, rewriter::NativeRewriter};

const REWRITERS: [(&str, JsRewriter); 3] = [
	("dpsc", JsRewriter::Dpsc),
	("ppsc", JsRewriter::Ppsc),
	("ppsc-hybrid", JsRewriter::PpscHybrid),
];

fn parses(src: &str, module: bool) -> bool {
	let alloc = Allocator::new();
	let source_type = SourceType::unambiguous()
		.with_javascript(true)
		.with_module(module)
		.with_standard(true);
	let options = ParseOptions {
		allow_v8_intrinsics: true,
		allow_return_outside_function: true,
		..Default::default()
	};
	let r = Parser::new(&alloc, src, source_type).with_options(options).parse();
	!r.panicked && r.errors.is_empty()
}

#[derive(Default)]
struct Totals {
	/// per rewriter: microseconds, and the files that failed
	micros: [u128; 3],
	failed: [Vec<String>; 3],
	files: usize,
	bytes: usize,
	skipped: usize,
}

fn one(path: &Path, wrap_this: bool, incumbency: IncumbencyMode, totals: &Mutex<Totals>) {
	let Ok(src) = std::fs::read_to_string(path) else { return };
	// a file that does not parse to begin with says nothing about the rewrite
	let module = match (parses(&src, false), parses(&src, true)) {
		(true, _) => false,
		(false, true) => true,
		_ => {
			totals.lock().unwrap().skipped += 1;
			return;
		}
	};
	let mut micros = [0u128; 3];
	let mut failed = [false; 3];
	for (i, (_, js_rewriter)) in REWRITERS.iter().enumerate() {
		let mut cfg = RewriterOptions::default();
		cfg.is_module = module;
		cfg.do_sourcemaps = true;
		cfg.destructure_rewrites = true;
		cfg.js_rewriter = *js_rewriter;
		cfg.ppsc_wrap_this = wrap_this;
		cfg.incumbency = incumbency;
		let rewriter = NativeRewriter::new(&cfg);
		let t = Instant::now();
		let out = rewriter.rewrite(&src, &cfg);
		micros[i] = t.elapsed().as_micros();
		failed[i] = match out {
			Ok(out) => !std::str::from_utf8(&out.js).is_ok_and(|js| parses(js, module)),
			Err(_) => true,
		};
	}
	let mut t = totals.lock().unwrap();
	t.files += 1;
	t.bytes += src.len();
	for i in 0..3 {
		t.micros[i] += micros[i];
		if failed[i] {
			t.failed[i].push(path.display().to_string());
		}
	}
}

pub fn run(files: &[PathBuf], threads: usize, wrap_this: bool, incumbency: IncumbencyMode) -> bool {
	let next = AtomicUsize::new(0);
	let totals = Mutex::new(Totals::default());
	std::thread::scope(|s| {
		for _ in 0..threads.max(1) {
			s.spawn(|| {
				while let Some(f) = files.get(next.fetch_add(1, Ordering::Relaxed)) {
					one(f, wrap_this, incumbency, &totals);
				}
			});
		}
	});

	let t = totals.into_inner().unwrap();
	let mb = t.bytes as f64 / 1e6;
	println!("{} files, {mb:.1} MB ({} skipped: they do not parse as written)", t.files, t.skipped);
	for (i, (name, _)) in REWRITERS.iter().enumerate() {
		let ms = t.micros[i] as f64 / 1e3;
		println!(
			"  {name:12} {:6} failed   {ms:10.0} ms   {:6.1} ms/MB",
			t.failed[i].len(),
			ms / mb.max(f64::EPSILON)
		);
		for f in t.failed[i].iter().take(10) {
			println!("      {f}");
		}
	}
	t.failed.iter().all(Vec::is_empty)
}
