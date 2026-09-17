/**
 * Whose script is this, per side.
 *
 * The two sides need DIFFERENT predicates and that asymmetry is not a wart: on
 * the oracle there is no shim, so every web-origin script is the page's; in the
 * sandbox the page's scripts are the rewritten copies served under the proxy
 * prefix and everything else on the chrome origin is scramjet.
 *
 * They live here, in one file, because they were previously written inline at
 * the one call site in index.ts -- so a tool that wanted to ask the same
 * question (`coverage.ts`, `offline.ts`) had to copy them, and a copy that
 * drifts reports a blind spot as a clean run. See RULES: a predicate that is
 * wrong about what a guest URL looks like does not report a wrong answer, it
 * reports nothing.
 */

import {
	carriesAnAbsoluteUrl,
	classifyScripts,
	type Attribution,
} from "./diff.ts";
import type { Trace } from "./trace.ts";

/**
 * Oracle: everything that is not the browser's own UI.
 *
 * Not the target's origin. A page's own scripts are not the only guest code on
 * it -- Cloudflare's Turnstile widget is a realm of its own and builds the
 * `/fo/` payloads -- and an origin test classified all of it as "not guest",
 * which silently put every divergence it could have reported out of reach of
 * T0 and T1.
 */
export const oracleGuestUrl = (u: string): boolean =>
	!!u && !u.startsWith("chrome") && !u.startsWith("devtools");

/**
 * Sandbox: under the proxy prefix AND carrying an encoded absolute URL.
 *
 * The prefix alone is not enough -- scramjet serves some of its own assets
 * through it (`/~/sj/<ctx>/scramjet.wasm.js`) -- and the encoded-URL test has
 * its own history: it was once `%3A%2F%2F` spelled as `http%3A%2F%2F`, which
 * matches no HTTPS site, so no guest script was ever classified guest and every
 * rateyourmusic run reported "0 T0 leak(s)" because nothing could reach the
 * tier.
 */
export const sandboxGuestUrl = (u: string): boolean =>
	u.includes("/~/sj/") && carriesAnAbsoluteUrl(u);

export type SideKind = "oracle" | "sandbox";

/** The predicate for a side. A self-check's "sandbox" is a second oracle. */
export function guestUrlPredicate(kind: SideKind): (u: string) => boolean {
	return kind === "oracle" ? oracleGuestUrl : sandboxGuestUrl;
}

export function attributionFor(trace: Trace, kind: SideKind): Attribution {
	return { classes: classifyScripts(trace, guestUrlPredicate(kind)) };
}
