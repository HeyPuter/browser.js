/**
 * Is a window the same object on BOTH sides of the frame boundary?
 *
 * RULES #191 says a window must be the same object everywhere it surfaces --
 * `contentWindow`, `event.source`, `frames[i]`, `parent`, `top`, `opener` --
 * because a browser hands out one WindowProxy per browsing context. It is a SET
 * constraint, and FINDINGS #251 is what happens when you satisfy half of it:
 * routing `event.source` through the cross-origin cache while `contentWindow`
 * still returned the raw window made the child's `e.source === parent` start
 * matching and the parent's `e.source === contentWindow` stop, and Turnstile
 * logged "ignored message from unexpected source" fifty times.
 *
 * `widgetidentity.js` only ever asked the CHILD. This asks whichever frame it
 * lands in and says which one that is, so planting it in the interstitial and
 * in the widget gives both halves of the constraint.
 *
 *     rym.sh probe "orchestrate"      probes/windowset.js   # the parent's view
 *     rym.sh probe "turnstile/f/av0"  probes/windowset.js   # the child's view
 *
 * Reports through `document.createComment`, which lands in the trace and which
 * nothing else in the page can read.
 */
(function () {
	"use strict";
	var say = function (s) {
		try {
			document.createComment("sbxws: " + s);
		} catch (err) {
			/* no document */
		}
	};
	var ask = function (label, fn) {
		try {
			say(label + " " + String(fn()));
		} catch (err) {
			say(label + " THREW " + (err && err.name ? err.name : "?"));
		}
	};

	// Which frame is this? The two roles ask different questions, and a line
	// that does not say which one it is cannot be paired across two runs.
	var isChild = window.parent !== window;
	say(
		"role " + (isChild ? "child" : "top") + " url=" + location.href.slice(0, 80)
	);

	// ---- the child's half ---------------------------------------------------
	if (isChild) {
		ask("parent===top", function () {
			return window.parent === window.top;
		});
		ask("parent===parent", function () {
			return window.parent === window.parent;
		});
		window.addEventListener(
			"message",
			function (e) {
				// The one that matters: a child validating its parent.
				ask("IN source===parent", function () {
					return e.source === window.parent;
				});
			},
			true
		);
	}

	// ---- the parent's half, which is the one that was never asked -----------
	//
	// A parent validates a child by comparing `e.source` against the
	// `contentWindow` of the iframe it created. Both have to be the same object
	// for that to work, and only ONE of them went through the cross-origin
	// cache.
	var frameFor = function (src) {
		var frames = document.getElementsByTagName("iframe");
		for (var i = 0; i < frames.length; i++) {
			try {
				if (frames[i].contentWindow === src) return "contentWindow[" + i + "]";
			} catch (err) {
				/* keep looking */
			}
		}
		for (var j = 0; j < window.length && j < 8; j++) {
			try {
				if (window[j] === src) return "frames[" + j + "]";
			} catch (err) {
				/* keep looking */
			}
		}
		return "NO-MATCH";
	};
	window.addEventListener(
		"message",
		function (e) {
			if (e.source === window || e.source === null) return;
			ask("IN source-is", function () {
				return frameFor(e.source);
			});
		},
		true
	);

	// And the set constraint stated directly, once the frames exist.
	var checkSet = function () {
		var frames = document.getElementsByTagName("iframe");
		say("iframes " + frames.length);
		for (var i = 0; i < frames.length && i < 4; i++) {
			(function (n, f) {
				ask("contentWindow[" + n + "]===frames[" + n + "]", function () {
					return f.contentWindow === window[n];
				});
				ask("contentWindow[" + n + "] stable", function () {
					return f.contentWindow === f.contentWindow;
				});
			})(i, frames[i]);
		}
	};
	// No timer: the guest-op recorder took timer id 1 once and shifted every id
	// the page minted after it. `load` is an event the page already has.
	try {
		window.addEventListener("load", checkSet, true);
	} catch (err) {
		/* no events */
	}
	checkSet();
	say("installed");
})();
