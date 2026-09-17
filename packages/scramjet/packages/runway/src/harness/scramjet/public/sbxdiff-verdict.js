/**
 * Did Turnstile pass? Read from the widget's own moment of decision.
 *
 * The signals used before this were all proxies for the answer and each was
 * weak in its own way: "does the log contain 'Rate Your Music'" depends on the
 * page having got far enough to set a title, `cf_chl_rc_ni` is a cookie a live
 * run does not surface, and "Cannot find Widget" is the retry SYMPTOM
 * (FINDINGS #143) rather than the verdict.
 *
 * The verdict itself is a style flip. The interstitial clears a node's
 * `textContent`, and the widget then changes an INLINE style from
 * `display: none` to `display: grid` on either its pass div or its fail div.
 * Exactly one of the two, exactly once per attempt -- so it says which way it
 * went and how many times it was asked.
 *
 * Reading it needs the shadow root, because Turnstile draws into one and it may
 * be CLOSED -- so roots are captured at `attachShadow` rather than looked up
 * afterwards. A document-level query finds nothing, and `body.textContent` is
 * the empty string.
 *
 * Reports through `console.info`, not the trace: this is meant for LIVE runs,
 * where there is no tracer and the harness log is the only channel out.
 *
 *     SBXDIFF_PROBE=/sbxdiff-verdict.js pnpm serve --url … --wisp --open sandbox
 *
 * `rym.sh live` sets it.
 */
(function () {
	"use strict";
	var GUARD = Symbol.for("sbxdiff.verdict");
	var s = typeof globalThis !== "undefined" ? globalThis : this;
	if (!s || s[GUARD] || !s.document) return;
	s[GUARD] = true;

	var said = 0;
	var say = function (msg) {
		if (said++ > 120) return;
		try {
			console.info("sbxdiff-verdict: " + msg);
		} catch (err) {
			/* no console */
		}
	};

	/** Shadow roots, captured as they are made. A closed one has no other way in. */
	var roots = [];
	try {
		var attach = Element.prototype.attachShadow;
		Element.prototype.attachShadow = function () {
			var r = attach.apply(this, arguments);
			try {
				roots.push(r);
				watch(r);
			} catch (err) {
				/* a root we cannot observe is one we do not report on */
			}

			return r;
		};
	} catch (err) {
		/* frozen prototype */
	}

	/** Enough to tell the pass div from the fail div, without dumping the DOM. */
	var describe = function (el) {
		try {
			var id = el.id ? "#" + el.id : "";
			var cls =
				el.className && typeof el.className === "string"
					? "." + el.className.trim().split(/\s+/).join(".")
					: "";
			var text = visibleText(el).slice(0, 60);
			var label = el.getAttribute && el.getAttribute("aria-label");

			return (
				(el.tagName || "?").toLowerCase() +
				id +
				cls +
				(label ? ' aria-label="' + label + '"' : "") +
				(text ? ' "' + text + '"' : "")
			);
		} catch (err) {
			return "(undescribable)";
		}
	};

	/**
	 * Turnstile's states, by the text each one carries.
	 *
	 * Every state's markup exists at once inside the shadow root and is toggled
	 * by `display`, so which one is grid IS the verdict:
	 *
	 *     <div role="alert" style="display: grid">  <span>Success!</span>
	 *     <div role="alert" style="display: none">  <p>Verification failed</p>
	 *     <div role="alert" style="display: none">  <p>Verification expired</p>
	 *     <div role="alert" style="display: none">  <p id="challenge-error-text">
	 *
	 * Read from the text rather than the element id: the ids are minted per
	 * challenge build and would need re-learning every time Cloudflare ships.
	 */
	/**
	 * The text a user can actually SEE under `el`.
	 *
	 * Plain `textContent` is wrong here and gave a wrong answer: every state's
	 * markup is present at once, so the wrapper's textContent concatenates
	 * "Success!" AND "Verification failed" AND "Verification expired", and
	 * whichever the verdict test named first won. Descending past a hidden
	 * subtree is what makes the reading specific to the state on screen.
	 */
	var visibleText = function (el) {
		var out = "";
		var walk = function (n) {
			for (var c = n.firstChild; c; c = c.nextSibling) {
				if (c.nodeType === 3) {
					out += c.nodeValue;
					continue;
				}
				if (c.nodeType !== 1) continue;
				var st = c.style;
				if (st && (st.display === "none" || st.visibility === "hidden")) {
					continue;
				}
				walk(c);
			}
		};
		try {
			walk(el);
		} catch (err) {
			/* a subtree that will not walk */
		}

		return out.replace(/\s+/g, " ").trim();
	};

	var verdictOf = function (text) {
		if (/success/i.test(text)) return "PASS";
		if (/verification failed/i.test(text)) return "FAIL";
		if (/expired/i.test(text)) return "EXPIRED";
		if (/error|troubleshoot/i.test(text)) return "ERROR";

		return null;
	};

	var onStyle = function (el) {
		try {
			var d = el.style && el.style.display;
			if (!d || d === "none") return;
			// Re-read on a later tick as well as now. The style flips BEFORE the
			// state's text is filled in, so reading only at the mutation gives an
			// empty div and no verdict -- which is what the first version did,
			// and it reported the flip without saying which way it went.
			say("display:" + d + " on " + describe(el));
			var settle = function () {
				try {
					var v = verdictOf(visibleText(el));
					if (v) say("VERDICT " + v + " -- " + describe(el));
				} catch (err) {
					/* nothing to read */
				}
			};
			if (typeof queueMicrotask === "function") queueMicrotask(settle);
			try {
				s.setTimeout(settle, 50);
			} catch (err) {
				/* no timers */
			}
		} catch (err) {
			/* an element that will not describe itself */
		}
	};

	var watch = function (root) {
		try {
			var mo = new MutationObserver(function (records) {
				for (var i = 0; i < records.length; i++) {
					var r = records[i];
					if (r.type === "attributes" && r.attributeName === "style") {
						onStyle(r.target);
					}
				}
			});
			mo.observe(root, {
				attributes: true,
				attributeFilter: ["style"],
				subtree: true,
			});
		} catch (err) {
			/* a root that cannot be observed */
		}
	};

	// The document too: the interstitial's own divs are not in a shadow root.
	try {
		watch(s.document);
	} catch (err) {
		/* no document */
	}

	// The trigger the user named: the interstitial clearing a node's text is
	// what immediately precedes the widget's flip, so logging it gives the
	// verdict a timestamp to sit next to.
	try {
		var proto = s.Node && s.Node.prototype;
		var desc = proto
			? Object.getOwnPropertyDescriptor(proto, "textContent")
			: null;
		if (desc && desc.set && desc.configurable) {
			var nativeSet = desc.set;
			Object.defineProperty(proto, "textContent", {
				get: desc.get,
				set: function (v) {
					try {
						if (v === "" && this.nodeType === 1) {
							say("textContent cleared on " + describe(this));
						}
					} catch (err) {
						/* nothing to report */
					}

					return nativeSet.call(this, v);
				},
				configurable: true,
				enumerable: desc.enumerable,
			});
		}
	} catch (err) {
		/* textContent is not interceptable here */
	}

	say(
		"installed in " + (s.location ? String(s.location.href).slice(0, 80) : "?")
	);
})();
