/**
 * What can a guest frame reach that a browser would forbid?
 *
 * The Turnstile widget is a cross-origin iframe in a direct load:
 * challenges.cloudflare.com inside rateyourmusic.com. Under scramjet both are
 * documents of the SAME real origin, so every access the browser would answer
 * with a SecurityError may simply succeed -- and a challenge that tests the
 * boundary sees a page no browser produces.
 *
 * Reports one line per realm, each access separately, because the interesting
 * result is WHICH ones differ and not a single pass/fail. Every probe is its
 * own try block for the same reason: sharing one would let the first throw hide
 * every answer after it, which is how an earlier version of the widget probe
 * reported "no listener" for a whole run.
 */
(function () {
	"use strict";
	var GUARD = Symbol.for("sbxdiff.boundary");
	if (window[GUARD]) return;
	window[GUARD] = true;

	var probe = function (name, fn) {
		try {
			var v = fn();
			return name + "=OK(" + String(v).slice(0, 48) + ")";
		} catch (err) {
			return name + "=THREW(" + String(err.name || err).slice(0, 28) + ")";
		}
	};

	var report = function (when) {
		var who;
		try {
			who = String(location.href).slice(0, 70);
		} catch (err) {
			who = "unreadable";
		}
		// No early return on "this is the top document". Under scramjet a guest
		// is MEANT to believe it is top-level, so that test silently skipped
		// every realm -- including the widget, which is the one that matters.
		// Whether it believes it is top is itself an answer, so report it.
		var out = [
			probe("isTop", function () {
				return window === window.top;
			}),
			probe("isOwnParent", function () {
				return window === window.parent;
			}),
			probe("parent.document", function () {
				return window.parent.document.title;
			}),
			probe("parent.location.href", function () {
				return window.parent.location.href;
			}),
			probe("top.location.href", function () {
				return window.top.location.href;
			}),
			probe("parent.eval", function () {
				// The access RULES.md records the challenge actually using.
				return window.parent.eval("location.origin");
			}),
			probe("ancestorOrigins", function () {
				return Array.prototype.join.call(location.ancestorOrigins, ",");
			}),
			probe("referrer", function () {
				return document.referrer;
			}),
			probe("frameElement", function () {
				return String(window.frameElement && window.frameElement.tagName);
			}),
		];
		console.info(
			"sbxdiff-boundary: " + when + " " + who + " :: " + out.join(" | ")
		);

		// The same questions as the GUEST sees them.
		//
		// NOT `window.eval`. This file is served straight to the browser and is
		// never put through scramjet's JS rewriter, and scramjet does not
		// replace the real `eval` either -- it exposes its rewriting one as a
		// `$scramjet__eval` accessor that only REWRITTEN code compiles into. So
		// `window.eval("window.top")` reads the raw top and looks exactly like
		// not being proxied at all, which is a convincing wrong answer.
		//
		// `$scramjet__eval` is the one the challenge's own code reaches, so it
		// is the one that answers the question. Same for `$scramjet__top` and
		// `$scramjet__parent`, read here directly as the controls.
		var sjEval;
		try {
			sjEval = window["$scramjet__eval"];
		} catch (err) {
			sjEval = null;
		}
		var asGuest = [
			probe("HAS-$scramjet__eval", function () {
				return typeof sjEval === "function";
			}),
			probe("sj:top===window", function () {
				return window["$scramjet__top"] === window;
			}),
			probe("sj:top.location.href", function () {
				return window["$scramjet__top"]["$scramjet__location"].href;
			}),
			probe("sj:parent.location.href", function () {
				return window["$scramjet__parent"]["$scramjet__location"].href;
			}),
			probe("sj:parent.document.title", function () {
				return window["$scramjet__parent"].document.title;
			}),
		];
		if (typeof sjEval === "function") {
			[
				"window.top.location.href",
				"window.parent.location.href",
				"window.parent.document.title",
				"window.top === window",
			].forEach(function (expr) {
				asGuest.push(
					probe(
						"eval:" + expr.replace("window.", "").slice(0, 24),
						function () {
							return sjEval(expr);
						}
					)
				);
			});
		}
		console.info(
			"sbxdiff-guestview: " + when + " " + who + " :: " + asGuest.join(" | ")
		);

		// Where does the chain actually stop, and what is each rung?
		//
		// `createWrapFn` walks up while the next window has SCRAMJETCLIENT on
		// it, meaning to stop at the topmost window still inside the proxy. If
		// the HARNESS page has that symbol too -- it hosts the controller -- the
		// walk goes one rung too far and `top` becomes the embedder.
		var chain = [];
		try {
			var cur = window;
			for (var i = 0; i < 8; i++) {
				var mark = "?";
				try {
					var sj = Object.getOwnPropertySymbols(cur)
						.filter(function (x) {
							return String(x).indexOf("scramjet") !== -1;
						})
						.map(function (x) {
							var c = cur[x];
							return c && c.url ? c.url.origin : "client-no-url";
						});
					mark = sj.length ? sj.join(",") : "NO-CLIENT";
				} catch (err) {
					mark = "THREW";
				}
				var u = "?";
				try {
					u = String(cur.location.href).slice(0, 52);
				} catch (err) {
					u = "THREW";
				}
				chain.push("[" + i + "] " + mark + " " + u);
				if (cur.parent === cur) break;
				cur = cur.parent;
			}
		} catch (err) {
			chain.push("walk THREW " + err);
		}
		console.info(
			"sbxdiff-chain: " + when + " " + who + " :: " + chain.join("  ||  ")
		);
	};

	// Once at parse time and once after: the widget replaces its own document,
	// and the answer can differ before and after.
	report("early");
	setTimeout(function () {
		report("late ");
	}, 8000);
})();
