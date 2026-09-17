/**
 * Why `document.referrer` loses the challenge token.
 *
 * The oracle's page reads `https://rateyourmusic.com/?__cf_chl_tk=<token>` and
 * the sandbox's reads `https://rateyourmusic.com/` -- 145 characters against
 * 26. It is not cosmetic: `__cf_chl_tk` is what ties a Cloudflare challenge to
 * its redemption, and the value travels. Google Analytics puts it in `dr`, and
 * that is one of the two store misses the gate reports, because the sandbox
 * asks for a `g/collect` URL the oracle never asked for.
 *
 * 26 characters is exactly `referrerOrigin + "/"`, which `createReferrerString`
 * returns for every origin-only policy and for a cross-origin request under
 * `strict-origin-when-cross-origin`. It is ALSO what the same-origin branch
 * returns if the history entry it reads had no query to begin with. Those are
 * different bugs in different files, so this asks rather than assumes:
 *
 *   - what the guest actually sees
 *   - what `client.url` is
 *   - what is in `client.history`, which is what the referrer is derived from
 *   - the policy attached to each entry
 *
 * Plant it in a script that runs in the PAGE realm at the time the referrer is
 * read -- `gtag/js` is the one that reads it for real:
 *
 *   ./rym.sh probe "gtag/js" src/sbxdiff/probes/referrer.js
 */
(function () {
	"use strict";
	var G = Symbol.for("sbxdiff.referrer");
	var s = typeof globalThis !== "undefined" ? globalThis : this;
	if (!s || s[G]) return;
	s[G] = true;

	var doc = s.document;
	if (!doc || !doc.createComment) return;
	var cc = Function.prototype.bind.call(doc.createComment, doc);
	var say = function (t) {
		try {
			cc("sbxrf" + t);
		} catch (err) {
			/* nothing to report through */
		}
	};

	var report = function (when) {
		try {
			// Through the accessors the GUEST would use, not a raw read: a probe
			// that reaches past the shim measures the shim's input rather than
			// its output, and gives a convincing wrong answer.
			say(when + "|referrer|" + String(doc.referrer));
			say(when + "|location|" + String(s.location.href));
		} catch (err) {
			say(when + "|threw reading the guest view: " + (err && err.message));
		}
		try {
			var client = s[Symbol.for("scramjet client global")];
			if (!client) return say(when + "|no client");
			say(when + "|client.url|" + String(client.url && client.url.href));
			var h = client.history || [];
			say(when + "|history entries|" + h.length);
			for (var i = 0; i < h.length && i < 6; i++) {
				say(
					when +
						"|history[" +
						i +
						"]|policy=" +
						String(h[i] && h[i].refererPolicy) +
						"|" +
						String(h[i] && h[i].url)
				);
			}
			say(
				when +
					"|meta.referrerPolicy|" +
					String(client.meta && client.meta.referrerPolicy)
			);
		} catch (err) {
			say(when + "|threw reading the client: " + (err && err.message));
		}
	};

	report("enter");
	try {
		s.setTimeout(function () {
			report("t1");
		}, 2000);
	} catch (err) {
		/* no timers */
	}
})();
