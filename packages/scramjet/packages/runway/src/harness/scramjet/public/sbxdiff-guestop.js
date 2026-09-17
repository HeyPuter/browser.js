/**
 * The guest-op recorder: what the GUEST asked scramjet for, and what it got.
 *
 * This is the half of the diff that did not exist.
 *
 * The binding tracer records native calls. For an API scramjet leaves alone
 * that is the guest's view and both sides record it. For an API scramjet
 * INTERCEPTS it is not: the guest calls a trap, the trap calls the native, and
 * the native's record has scramjet's script on top -- so the differ, which
 * pairs guest calls against guest calls, finds zero on the sandbox side and
 * reports `missing-call` at T2. Measured on rateyourmusic, in the page realm
 * alone: 43 APIs and 1344 calls, `Element.getAttribute` at 217 against 0. A
 * further 18 APIs never reach a native at all -- scramjet answers `location`
 * out of the URL string it already holds -- so no binding record exists to
 * compare even in principle.
 *
 * That is the whole intercepted surface, which is exactly the surface scramjet
 * can be WRONG about, and 663 buckets of the rateyourmusic baseline are it.
 *
 * scramjet reaches the guest through seven seams, and each of them knows both
 * who asked and what the answer was:
 *
 *   ScramjetClient.RawProxy    function members          } all install a
 *   ScramjetClient.RawTrap     accessor and data members } descriptor, so one
 *   ScramjetClient.Intercept   class-handler members     } hook covers all three
 *   constructors               RawProxy's `construct`, Intercept's class swap
 *   createLocationProxy        location's own per-property proxies
 *   shared/wrap.ts             $scramjet$location / $parent / $top
 *   dom/element.ts             href, src, action and the other URL attributes
 *   shared/event.ts            wrapEvent, a Proxy around ONE event object
 *
 * They call the recorder this file installs, if it is there. Off unless the
 * symbol is present, which is one global lookup when off. See
 * `docs/sbxdiff/GUEST-OPS.md` for why each of the by-hand ones needed one.
 *
 * ## Depth is the cut
 *
 * scramjet's own code uses the trapped members -- its URL rewriter reads
 * `location`, its element shims read attributes -- so a recorder that logged
 * every entry would log scramjet's plumbing as though the guest had asked for
 * it. The outermost entry is the guest's; everything nested inside it is
 * scramjet working. So the recorder counts depth and records only at zero.
 *
 * That is the guest-op bracket ARCHITECTURE.md specifies, in JS rather than in
 * C++, and it needs no Chromium rebuild.
 *
 * ## The sink
 *
 * `document.createComment`, buffered. The argument lands in the trace as a
 * string and nothing else in the page can read a detached Comment, which is
 * why `probestore.ts` already reports through it. Buffered because an
 * unbuffered one would put a binding record between every pair of guest ops
 * and roughly double the trace.
 *
 * Long values are NOT shipped out whole -- the tracer truncates a string at
 * 512 bytes, so a chunk that overran would lose the end of it silently. The
 * recorder emits a prefix, the true length and a hash. It also runs the leak
 * check itself, on the value it still has in hand, so a proxy URL buried in
 * the middle of a 40 KB string is still caught. Doing it here is strictly
 * better than shipping the string: no truncation can hide it.
 *
 * Documents and workers both. A worker has no `document`, so it reports through
 * `new URL("sbxgop:" + chunk)` -- see the sink below for why that one. Workers
 * are not a corner: on rateyourmusic they are eight blob realms and 85% of the
 * oracle's records, and Cloudflare runs its detections inside them.
 */
(function () {
	"use strict";
	var self_ = typeof globalThis !== "undefined" ? globalThis : this;
	// One global, not two, and it is the recorder itself.
	//
	// There used to be a separate `sbxdiff.guestop.installed` guard beside it.
	// Both were registered symbols, and while `Object.getOwnPropertyNames` does
	// not list symbols -- which is what they were chosen for --
	// `Object.getOwnPropertySymbols` and `Reflect.ownKeys` do, and
	// `Symbol.keyFor` hands a page back the string "sbxdiff.guestop.installed".
	// This page enumerates its own globals and posts the result. So: one
	// property, and `core/src/client/guestop.ts` deletes it the moment it has
	// read it, which is during scramjet's bootstrap and ahead of guest code.
	var GUESTOP = Symbol.for("sbxdiff.guestop");
	if (!self_ || self_[GUESTOP]) return;

	// The sink, captured before scramjet installs anything -- which is what
	// `probePath` guarantees, in a document AND in a worker: it runs with
	// scramjet's own bootstrap, ahead of the client being constructed. Reading
	// these later would read the interceptors instead, and the sink would
	// re-enter the thing it is measuring.
	//
	// A document reports through `document.createComment`: the argument lands in
	// the trace as a string and nothing else in the page can read a detached
	// Comment.
	//
	// A WORKER has no document. It reports through `new URL("sbxgop:" + chunk)`
	// instead, which works because:
	//
	//   - `URL.constructor` is a traced binding and records its string ARGUMENT,
	//     so the parser's normalization of the payload does not matter;
	//   - `sbxgop:` is a valid scheme with an opaque path, so the URL parses,
	//     touches no network and throws for nothing;
	//   - it exists in every worker and worklet.
	//
	// Deliberately not `TextEncoder.encode`, the other traced string-taking call
	// in those realms: it already carries 40000 real calls per blob worker on
	// rateyourmusic, and `sbxdiff-encode.js` reads the challenge's payload
	// plaintext out of exactly those records.
	var doc = self_.document;
	var sink = null;
	if (doc && doc.createComment) {
		var createComment = Function.prototype.bind.call(doc.createComment, doc);
		sink = function (payload) {
			createComment(payload);
		};
	} else if (typeof self_.URL === "function") {
		var URLCtor = self_.URL;
		sink = function (payload) {
			// eslint-disable-next-line no-new
			new URLCtor("sbxgop:" + payload);
		};
	}
	if (!sink) return;
	var stringify = String;
	var WeakMapCtor = self_.WeakMap;

	/** Chunk marker. Not a string the page would pass to createComment. */
	var MARK = "sbxgop";
	/** Separates events inside one chunk. */
	var SEP = "";
	/** Marks a line that was itself over the chunk budget. */
	var OVERLONG = "";
	/** The tracer truncates a traced string at 512 bytes; stay inside it. */
	var CHUNK_MAX = 440;
	/**
	 * A value longer than this is emitted as prefix + true length + hash.
	 *
	 * 200 because that is above every value the comparison turns on -- a URL,
	 * an origin, a cookie string, a referrer, a user-agent -- and below the
	 * chunk budget, so an ordinary event still shares a chunk with its
	 * neighbours. Past it the oracle has the first 512 bytes (the tracer's own
	 * cap) and this has the first 48 plus a hash of the whole, so the two are
	 * compared on length and the common prefix. See `docs/sbxdiff/GUEST-OPS.md`.
	 */
	var VALUE_MAX = 200;

	var buf = "";
	var n = 0;
	var dropped = 0;

	function flush() {
		if (!buf) return;
		var payload = MARK + buf;
		buf = "";
		try {
			sink(payload);
		} catch (err) {
			dropped++;
		}
	}

	// NOT a timer.
	//
	// The first version flushed on `setInterval(flush, 250)` and the run
	// promptly reported `Window.setTimeout` returning 3 on the oracle against 2
	// in the sandbox, and `setInterval` 2 against 5. Those were real
	// divergences in a real sense -- the guest CAN read a timer id and
	// rateyourmusic's own probe page exists because Cloudflare does -- and they
	// were caused by the instrument. The recorder had taken timer id 1 and
	// shifted every id the page minted after it.
	//
	// A microtask takes no id and nothing observable. Scheduled only when
	// there is something to flush and only one at a time, so an idle page
	// schedules nothing at all, and every task's ops reach the trace at the end
	// of that task -- which bounds what a kill can lose to one task rather than
	// to 250 ms.
	var pending = false;
	var queue =
		typeof queueMicrotask === "function"
			? queueMicrotask
			: function (f) {
					Promise.resolve().then(f);
				};

	function scheduleFlush() {
		if (pending || !buf) return;
		pending = true;
		queue(function () {
			pending = false;
			flush();
		});
	}

	function emit(line) {
		if (buf.length + line.length + 1 > CHUNK_MAX) flush();
		// A single line over the budget would loop forever against the check
		// above, so it goes out alone and is marked as over-long rather than
		// silently split -- a split line decodes as two wrong events.
		if (line.length > CHUNK_MAX) {
			buf = line.slice(0, CHUNK_MAX - 2) + OVERLONG;
			flush();

			return;
		}
		buf = buf ? buf + SEP + line : line;
		scheduleFlush();
	}

	// ---- leak markers -------------------------------------------------------
	//
	// The recorder checks these itself, on the whole value, because it is the
	// last place that HAS the whole value. Taken from the document's own
	// location rather than hardcoded: the harness port is a harness detail and
	// a stale constant here would report a clean run.
	var chromeOrigin = "";
	try {
		chromeOrigin = self_.location.origin;
	} catch (err) {
		/* opaque origin, or a worklet with no location */
	}
	var SHIM_IDS = [
		"$scramjet",
		"ScramjetClient",
		"__scramjet",
		"$scramjetController",
	];

	function leaks(s) {
		if (s.indexOf("/~/sj/") >= 0) return "p";
		if (chromeOrigin && s.indexOf(chromeOrigin) >= 0) return "c";
		for (var i = 0; i < SHIM_IDS.length; i++) {
			if (s.indexOf(SHIM_IDS[i]) >= 0) return "s";
		}

		return "";
	}

	/**
	 * Length in UTF-8 BYTES, which is what the tracer reports for a traced
	 * string.
	 *
	 * `s.length` is UTF-16 code units, and comparing one against the other
	 * reports every non-ASCII value as a length divergence -- a page title with
	 * an accent in it, which rateyourmusic has. Computed only when the string
	 * is not ASCII, so the common case is still a property read.
	 */
	var NON_ASCII = /[^\x00-\x7f]/;

	function utf8len(s) {
		if (!NON_ASCII.test(s)) return s.length;
		var n = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c < 0x80) n += 1;
			else if (c < 0x800) n += 2;
			else if (c >= 0xd800 && c <= 0xdbff) {
				// A surrogate PAIR is one 4-byte code point. A lone surrogate is
				// not, and the encoder would emit U+FFFD for it -- 3 bytes -- so
				// only advance past a real low surrogate.
				var d = s.charCodeAt(i + 1);
				if (d >= 0xdc00 && d <= 0xdfff) {
					n += 4;
					i++;
				} else n += 3;
			} else n += 3;
		}

		return n;
	}

	function hash(s) {
		// FNV-1a, matching store.ts so a hash can be read across the two.
		var h = 0x811c9dc5;
		for (var i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i) & 0xff;
			h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
		}

		return h.toString(36);
	}

	// ---- identity -----------------------------------------------------------
	//
	// Run-local ids in first-sighting order, the same scheme the C++ tracer
	// uses, so "the sandbox minted a fresh object where the oracle reused one"
	// is answerable. A WeakMap rather than a property on the object: a property
	// forces a hidden-class transition and is visible to the page.
	var ids = WeakMapCtor ? new WeakMapCtor() : null;
	var nextId = 1;

	function idOf(o) {
		if (!ids) return 0;
		var got = ids.get(o);
		if (got === undefined) {
			got = nextId++;
			ids.set(o, got);
		}

		return got;
	}

	function esc(s) {
		var out = "";
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c === 0x5c) out += "\\\\";
			else if (c === 0x7c) out += "\\p";
			else if (c < 0x20) out += "\\x" + c.toString(16);
			else out += s[i];
		}

		return out;
	}

	/**
	 * `{tag}{payload}`, never contents.
	 *
	 * Strings are the exception and deliberately so: a string IS the value, and
	 * every leak and nearly every real divergence on a proxied site is one.
	 * Everything else gets a tag and an identity.
	 */
	function enc(v, max) {
		var t = typeof v;
		if (max === undefined) max = VALUE_MAX;
		if (v === null) return "N";
		if (t === "undefined") return "U";
		if (t === "boolean") return v ? "B1" : "B0";
		if (t === "number") return "#" + (Object.is(v, -0) ? "-0" : stringify(v));
		if (t === "bigint") return "G" + stringify(v);
		if (t === "symbol") return "Y";
		if (t === "string") {
			var mark = leaks(v);
			if (v.length <= max) {
				return (mark ? "!" + mark : "") + '"' + esc(v);
			}

			return (
				(mark ? "!" + mark : "") +
				"~" +
				utf8len(v) +
				"," +
				hash(v) +
				',"' +
				esc(v.slice(0, 48))
			);
		}
		// Functions and objects. Reading a constructor NAME would run guest code
		// on a Proxy, which is the one thing the tracer's own rules forbid, so
		// identity is all this carries.
		return (t === "function" ? "F" : "O") + idOf(v);
	}

	// ---- the recorder -------------------------------------------------------

	var depth = 0;
	/**
	 * Entries that arrived with an interception already in progress.
	 *
	 * The cut is depth: the outermost entry is the guest's and everything
	 * nested inside it is scramjet working. RULES.md #10 says that is not
	 * quite right -- brackets should be token-returning, because per-instance
	 * `RawTrap`s are installed INSIDE an apply handler and the nesting is
	 * re-entrant -- but nothing has ever measured how much a depth counter
	 * actually drops. This is that number. It is reported, not acted on: if it
	 * is large, the token-returning bracket is worth building; if it is zero,
	 * #10 is satisfied by the shape of the code and there is nothing to fix.
	 */
	var nested = 0;
	/** Members scramjet installed, reported once so coverage is not inferred. */
	var installed = [];

	function record(member, op, args, result, threw, max) {
		var line;
		try {
			line =
				++n + "|" + op + "|" + member + "|" + (threw ? "!" : "") + enc(result);
			for (var i = 0; i < args.length && i < 6; i++)
				line += "|" + enc(args[i], max);
			if (args.length > 6) line += "|+" + (args.length - 6);
		} catch (err) {
			dropped++;

			return;
		}
		emit(line);
	}

	/**
	 * Wraps one funnel's call. `fn` does the real work; everything it does
	 * re-entrantly is scramjet's own and must not be recorded, hence the depth.
	 */
	function around(member, op, args, fn) {
		var entered = depth === 0;
		if (!entered) nested++;
		depth++;
		var out;
		try {
			out = fn();
		} catch (err) {
			depth--;
			if (entered) record(member, op, args, err, true);
			throw err;
		}
		depth--;
		if (entered) record(member, op, args, out, false);

		return out;
	}

	/**
	 * An error scramjet BUILT, recorded with its text.
	 *
	 * Not gated on depth, unlike `around`. An error is constructed inside the
	 * trap that rejects the call, so it is always nested and the depth gate
	 * would drop every one -- but it is not scramjet working, it is the value
	 * the guest is about to catch.
	 *
	 * Recorded as a string argument, so it goes through `enc` and therefore
	 * through `leaks()`: a message naming the proxy is marked a leak by the
	 * same scan that marks one in any other value, on the full text, before
	 * the length cap truncates it.
	 */
	function threw(name, message) {
		// 512, not the 200 every other value gets, because that is the tracer's
		// own `kMaxStringBytes` and the oracle's side of this comparison is a
		// `kException` record capped at exactly that. An error message is long
		// by nature and the part that decides the question -- the origin, the
		// URL -- is at the END of it, so the ordinary cap kept the first 48
		// characters and threw away everything worth comparing. Two layers that
		// truncate differently compare their own truncation, which is the
		// mistake GUEST-OPS.md exists to name.
		record("Error." + name, "throw", [message], undefined, true, 512);
	}

	self_[GUESTOP] = {
		around: around,
		threw: threw,
		/** Registered at install time, so coverage is measured, not guessed. */
		note: function (member, kind) {
			installed.push(kind + " " + member);
		},
		/** Flushed on demand; the run's end is not a thing the page can see. */
		flush: flush,
		stats: function () {
			return {
				events: n,
				dropped: dropped,
				installed: installed.length,
				nested: nested,
			};
		},
	};

	// The run can end at any time -- the harness kills the browser after its
	// grace period -- so the tail must not depend on a clean shutdown. Both
	// hooks, because `pagehide` does not fire for a killed process and a timer
	// does not fire for a page that is torn down first.
	function drain() {
		flush();
		// The counts go to the console rather than into the trace: they are
		// about the INSTRUMENT, and an instrument's self-report does not belong
		// in the stream it is instrumenting. `chromium.stderr.log` is where the
		// run already looks for "sbxdiff-guestop: installed".
		//
		// `nested` is the RULES.md #10 number -- ops that arrived with an
		// interception already in progress and were therefore dropped. Nobody
		// had ever measured it.
		try {
			console.info(
				"sbxdiff-guestop: events=" +
					n +
					" dropped=" +
					dropped +
					" nested=" +
					nested +
					" installed=" +
					installed.length
			);
		} catch (err) {
			/* no console */
		}
	}
	try {
		self_.addEventListener("pagehide", drain, { capture: true });
		self_.addEventListener("beforeunload", drain, { capture: true });
	} catch (err) {
		/* a worker has neither event */
	}
	// One line so a run says whether this was in the picture at all. A probe
	// that silently did not install reads as "no divergences", which is the
	// failure mode this whole file exists to remove.
	try {
		console.info(
			"sbxdiff-guestop: installed (" + (doc ? "document" : "worker") + ")"
		);
	} catch (err) {
		/* no console */
	}
})();
