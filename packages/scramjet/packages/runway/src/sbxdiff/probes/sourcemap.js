/**
 * Which of the three sourcemap lookups misses, for a stack frame.
 *
 * `error.ts:originalColumn` needs all three of `sourcemapSizes`,
 * `sourcemapLines` and `sourcemapPrelude` for a script before it can correct a
 * frame's column, and returns null if any is absent. Measured on rateyourmusic
 * the correction is not applying -- the challenge's captured stack reads
 * `:223:206018` in a browser and `:223:872417` under the proxy -- and FINDINGS
 * #179 names two ways for that to happen silently, neither of which fits: the
 * script is pure ASCII (checked, zero non-ASCII bytes in all 253062), and the
 * lookup already tries both spellings of the URL.
 *
 * So this reports what is actually in the three maps, and what a real frame's
 * filename looks like, from inside the realm that matters. A lookup that never
 * hits is indistinguishable from a correction that does not apply, which is the
 * trap #179 was written about.
 *
 * Sandbox-only by nature: the oracle has no maps and needs none.
 */
(function () {
	"use strict";
	var G = Symbol.for("sbxdiff.sourcemap");
	var s = typeof globalThis !== "undefined" ? globalThis : this;
	if (!s || s[G]) return;
	s[G] = true;

	var doc = s.document;
	var sink =
		doc && doc.createComment
			? Function.prototype.bind.call(doc.createComment, doc)
			: function (t) {
					new s.URL("sbxsm:" + t);
				};
	var say = function (t) {
		try {
			sink("sbxsm" + t);
		} catch (err) {
			/* nothing to report through */
		}
	};

	var report = function (when) {
		try {
			var client = s[Symbol.for("scramjet client global")];
			if (!client) return say(when + "|no client on this global");
			var box = client.box;
			if (!box) return say(when + "|client has no box");
			var keys = function (o) {
				try {
					return Object.keys(o || {});
				} catch (err) {
					return [];
				}
			};
			var sizes = keys(box.sourcemapSizes);
			var lines = keys(box.sourcemapLines);
			var prel = keys(box.sourcemapPrelude);
			say(
				when +
					"|sizes=" +
					sizes.length +
					"|lines=" +
					lines.length +
					"|prelude=" +
					prel.length
			);
			// The keys themselves, so a mismatch against a frame's filename is
			// visible rather than inferred.
			for (var i = 0; i < sizes.length && i < 6; i++) {
				say(when + "|sizeKey|" + sizes[i]);
			}
			for (var j = 0; j < lines.length && j < 6; j++) {
				say(when + "|lineKey|" + lines[j]);
			}
			// And a real frame, so its spelling can be compared to those keys.
			var st = new Error().stack || "";
			var frames = st.split("\n");
			for (var k = 1; k < frames.length && k < 4; k++) {
				say(when + "|frame|" + frames[k].trim());
			}
		} catch (err) {
			say(when + "|threw " + (err && err.message));
		}
	};

	report("enter");
	try {
		s.setTimeout(function () {
			report("t1");
		}, 1200);
		s.setTimeout(function () {
			report("t2");
		}, 3000);
	} catch (err) {
		/* no timers */
	}
})();
