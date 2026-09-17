/**
 * What `Error.stackTraceLimit` reads, and how deep a stack actually comes out.
 *
 * The challenge captures stack traces into its payload. Measured with
 * `rym.sh plaintext`, the oracle's captured trace has 10 frames and the
 * sandbox's has 17 -- and V8's default limit is exactly 10, so the obvious
 * reading is that something raised it. `rewriters/js.ts` does raise it to 50
 * for the duration of one rewrite, but it saves and restores in a `finally`,
 * so that should not be observable.
 *
 * This settles which it is: report the limit at several moments, and the depth
 * of a stack captured right then. If the limit reads 10 on both sides and the
 * sandbox still gets more frames, the extra frames are real -- scramjet's
 * trampolines standing between the challenge's own functions -- and the fix is
 * a different one entirely.
 */
(function () {
	"use strict";
	var G = Symbol.for("sbxdiff.stacklimit");
	var s = typeof globalThis !== "undefined" ? globalThis : this;
	if (!s || s[G]) return;
	s[G] = true;

	var doc = s.document;
	var sink =
		doc && doc.createComment
			? Function.prototype.bind.call(doc.createComment, doc)
			: function (t) {
					new s.URL("sbxsl:" + t);
				};

	var depth = function () {
		try {
			var st = new Error().stack;

			return st ? st.split("\n").length - 1 : -1;
		} catch (err) {
			return -2;
		}
	};

	var report = function (when) {
		try {
			var lim;
			try {
				lim = String(Error.stackTraceLimit);
			} catch (err) {
				lim = "throw";
			}
			sink("sbxsl" + when + "|limit=" + lim + "|depth=" + depth());
		} catch (err) {
			/* nothing to report through */
		}
	};

	report("enter");
	try {
		Promise.resolve().then(function () {
			report("microtask");
		});
	} catch (err) {
		/* no promises */
	}
	// A few points across the run, on the NATIVE timer where one is reachable,
	// so this does not spend a guest timer id the way `blob.ts` used to.
	try {
		var n = 0;
		var tick = function () {
			report("t" + ++n);
			if (n < 6) s.setTimeout(tick, 400);
		};
		s.setTimeout(tick, 400);
	} catch (err) {
		/* no timers */
	}
})();
