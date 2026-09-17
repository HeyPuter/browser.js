/**
 * Pairing a realm on one side with the same realm on the other.
 *
 * The default comparison looks at ONE realm per side, which on rateyourmusic
 * is 2% of the run -- Cloudflare's fingerprinting happens in the Turnstile
 * widget's realm and in a blob worker, and neither was ever compared.
 * `--all-realms` compares them, and it can only do that if it can tell that
 * these two names are the same document:
 *
 *   oracle   https://challenges.cloudflare.com/cdn-cgi/.../normal?lang=auto
 *   sandbox  http://localhost:4500/~/sj/<cfg>/<ctx>/https%3A%2F%2Fchallenges…
 *
 * Getting that wrong does not fail loudly: it pairs two unrelated documents
 * and reports the difference between them as a divergence. Both bugs below
 * did exactly that, against real trace data.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/realms.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { visibleRealmUrl } from "./diff.ts";

const PREFIX = "http://localhost:4500/~/sj/l105dq1z/cm0euskr/";

test("a direct URL keeps its origin and path", () => {
	assert.equal(
		visibleRealmUrl("https://rateyourmusic.com/"),
		"https://rateyourmusic.com/"
	);
});

test("the query is not part of the identity", () => {
	assert.equal(
		visibleRealmUrl("https://challenges.cloudflare.com/x/y?lang=auto"),
		"https://challenges.cloudflare.com/x/y"
	);
});

test("a proxied URL collapses onto the same key as the direct one", () => {
	const direct =
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0/rch/q7dlh/0x4AAAAAAADnPIDROrmt1Wwj/dark/fbE/new/normal?lang=auto";
	const proxied =
		PREFIX +
		"https%3A%2F%2Fchallenges.cloudflare.com%2Fcdn-cgi%2Fchallenge-platform%2Fh%2Fg%2Fturnstile%2Ff%2Fav0%2Frch%2Fq7dlh%2F0x4AAAAAAADnPIDROrmt1Wwj%2Fdark%2FfbE%2Fnew%2Fnormal%3Flang%3Dauto";

	assert.equal(visibleRealmUrl(proxied), visibleRealmUrl(direct));
});

test("scramjet's own query parameters do not decide the identity", () => {
	// `$io` is the INITIATOR, and it is an encoded absolute URL sitting after
	// the target. Reading the LAST encoded URL keyed the Turnstile widget as
	// `https://rateyourmusic.com/` -- the page that opened it -- so the widget
	// realm was never paired with the oracle's and its six T1 divergences
	// stayed invisible.
	const proxied =
		PREFIX +
		"https%3A%2F%2Fchallenges.cloudflare.com%2Fcdn-cgi%2Fchallenge-platform%2Fh%2Fg%2Fturnstile%2Ff%2Fav0" +
		"?%24rfp=same-origin&%24iframe=1&%24io=https%3A%2F%2Frateyourmusic.com";

	assert.equal(
		visibleRealmUrl(proxied),
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/av0"
	);
});

test("a proxied blob URL keeps only its origin", () => {
	// The UUID is minted per run and differs between the sides by
	// construction, so pairing on it would pair nothing.
	//
	// Two segments behind the prefix, not one: dropping one left
	// `cm0euskr/blob:https://…`, which is not a URL and could never match the
	// oracle's name for the same worker.
	assert.equal(
		visibleRealmUrl(
			PREFIX +
				"blob:https://challenges.cloudflare.com/9a1adbed-23da-40b0-91fd-dd8fcabf083f"
		),
		"blob:https://challenges.cloudflare.com"
	);
	assert.equal(
		visibleRealmUrl(
			"blob:https://challenges.cloudflare.com/f22ca6fa-b966-47c2-8822-8949a705ce22"
		),
		"blob:https://challenges.cloudflare.com"
	);
});

test("two different sites do not collapse together", () => {
	assert.notEqual(
		visibleRealmUrl(PREFIX + "https%3A%2F%2Frateyourmusic.com%2F"),
		visibleRealmUrl(PREFIX + "https%3A%2F%2Fchallenges.cloudflare.com%2F")
	);
});

test("about: URLs stay readable instead of becoming nullblank", () => {
	// `new URL("about:blank").origin` is "null" and its pathname is "blank",
	// so origin + pathname read "nullblank" -- unreadable in the output, and
	// every `about:` realm collided with every other.
	assert.equal(visibleRealmUrl("about:blank"), "about:blank");
	assert.equal(visibleRealmUrl("about:srcdoc"), "about:srcdoc");
	assert.notEqual(
		visibleRealmUrl("about:blank"),
		visibleRealmUrl("about:srcdoc")
	);
});

test("the harness's own page is not the guest's", () => {
	assert.equal(
		visibleRealmUrl("http://localhost:4500/?sbxdiffStore=4510#b64:aHR0cA=="),
		"http://localhost:4500/"
	);
});
