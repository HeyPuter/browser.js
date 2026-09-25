/**
 * Client hints: `Accept-CH`, `Critical-CH`, and the `Sec-CH-UA-*` request
 * headers.
 *
 * https://wicg.github.io/client-hints-infrastructure/
 *
 * A browser sends three low-entropy hints to everyone -- `Sec-CH-UA`,
 * `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` -- and the high-entropy ones only to
 * an origin that asked for them by name in an `Accept-CH` response header.
 *
 * If that response also names them in `Critical-CH`, the browser throws the
 * response away and reissues the request with the hints attached, so the server
 * never has to act on a reply it considers incomplete. rateyourmusic's
 * challenge does exactly this, which is why its recorded journey holds two 403s
 * for the same URL and not one.
 *
 * The low-entropy three arrive on their own: the guest's own fetch is made by
 * the browser, which attaches them, and they survive into `initialHeaders`. The
 * high-entropy ones never do, because the origin that asked for them is the
 * proxy's, not the target's -- so under the proxy an origin would ask, and be
 * answered by a client that appears to have ignored it, forever.
 *
 * Measured on rateyourmusic, which is behind a Cloudflare managed challenge:
 * the direct load answers `orchestrate/chl_page/v1` with nine `Sec-CH-UA-*`
 * headers and the proxied load with three. That request is where Cloudflare
 * chooses which checks to run, and the two loads were being given different
 * programs.
 *
 * The values come from `navigator.userAgentData.getHighEntropyValues()` in
 * whichever realm the fetch handler runs in -- a service worker has it too --
 * so they describe the browser that is actually running, and nothing has to be
 * kept in sync with the page.
 */
import { ScramjetHeaders } from "@/shared";
import {
	Array_isArray,
	Navigator_userAgentData,
	Object_entries,
	Object_values,
	Promise_resolve,
	String,
	_Map,
	_Set,
} from "@/shared/snapshot";

/**
 * Hint name -> the key `getHighEntropyValues` answers it with, and how that
 * value is serialised as a structured-header item.
 *
 * Low-entropy hints are deliberately absent: the browser has already put them
 * on the request, and rewriting them here would only be a chance to disagree
 * with it.
 */
const HIGH_ENTROPY: Record<
	string,
	{ key: string; kind: "string" | "boolean" | "list" }
> = {
	"sec-ch-ua-arch": { key: "architecture", kind: "string" },
	"sec-ch-ua-bitness": { key: "bitness", kind: "string" },
	"sec-ch-ua-form-factors": { key: "formFactors", kind: "list" },
	"sec-ch-ua-full-version": { key: "uaFullVersion", kind: "string" },
	"sec-ch-ua-full-version-list": { key: "fullVersionList", kind: "list" },
	"sec-ch-ua-model": { key: "model", kind: "string" },
	"sec-ch-ua-platform-version": { key: "platformVersion", kind: "string" },
	"sec-ch-ua-wow64": { key: "wow64", kind: "boolean" },
};

/** `"` and `\` are the only characters escaped inside a structured string. */
function sfString(value: string): string {
	return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * `fullVersionList` is a list of `{ brand, version }`, serialised as
 * `"Brand";v="1.2.3", ...`. `formFactors` is a plain list of strings.
 */
function sfList(value: unknown): string | null {
	if (!Array_isArray(value)) return null;
	if (value.length === 0) return "";

	return value
		.map((entry) =>
			entry && typeof entry === "object" && "brand" in entry
				? `${sfString((entry as { brand: string }).brand)};v=${sfString(
						(entry as { version: string }).version
					)}`
				: sfString(String(entry))
		)
		.join(", ");
}

/** Which hints each origin has asked for, for as long as this realm lives. */
const accepted = new _Map<string, _Set<string>>();

let values: Record<string, string> | null = null;
let pending: Promise<void> | null = null;

/**
 * Ask the browser for its high-entropy values, once.
 *
 * Awaited on the fetch path rather than resolved at module load: a hint that is
 * not ready yet is a hint that silently does not get sent, and the request it
 * would have gone on is the one that matters.
 */
export function readyClientHints(): Promise<void> {
	if (values !== null) return Promise_resolve();
	if (pending) return pending;

	const uaData = Navigator_userAgentData;
	if (!uaData?.getHighEntropyValues) {
		// Firefox and Safari have no client hints at all, and an origin asking
		// for them there is answered with nothing. Same here.
		values = {};

		return Promise_resolve();
	}

	pending = uaData
		.getHighEntropyValues(Object_values(HIGH_ENTROPY).map((h) => h.key))
		.then((raw) => {
			const out: Record<string, string> = {};
			for (const [header, { key, kind }] of Object_entries(HIGH_ENTROPY)) {
				if (!(key in raw)) continue;
				const value = raw[key];
				if (kind === "list") {
					const list = sfList(value);
					if (list !== null) out[header] = list;
				} else if (kind === "boolean") {
					out[header] = value ? "?1" : "?0";
				} else if (value !== undefined && value !== null) {
					out[header] = sfString(String(value));
				}
			}
			values = out;
		})
		.catch(() => {
			values = {};
		});

	return pending;
}

/**
 * Record an origin's `Accept-CH`. A response that carries the header at all
 * REPLACES the origin's set, including with the empty set -- that is how an
 * origin stops being sent hints.
 */
export function acceptClientHints(url: URL, headers: ScramjetHeaders) {
	const header = headers.get("accept-ch");
	if (header === null) return;

	const wanted = new _Set(
		header
			.split(",")
			.map((token) => token.trim().toLowerCase())
			.filter((token) => token in HIGH_ENTROPY)
	);
	accepted.set(url.origin, wanted);
}

/**
 * May this request carry HIGH-ENTROPY client hints at all?
 *
 * `Accept-CH` is not the only gate. Each hint is also governed by a permissions
 * policy whose default allowlist is `self`, so a hint reaches a cross-origin
 * destination only when the embedding document delegates it -- with `allow=` on
 * the iframe or a `Permissions-Policy` header. Nothing on rateyourmusic does.
 *
 * Without this the shim sent `Sec-CH-UA-Arch`, `-Bitness`, `-Model` and
 * `-Platform-Version` to challenges.cloudflare.com in a cross-origin iframe,
 * on the request for the challenge document itself, where an unmodified
 * browser sends none of them.
 *
 * And it made the shim RESTART. Chromium's `Critical-CH` throttle skips a hint
 * the policy does not allow rather than counting it missing
 * (`GetCriticalHintsMissingStatus`: `if (!IsClientHintAllowed(...)) continue;`),
 * so for a cross-origin frame every critical hint is not-allowed, nothing is
 * missing, and there is no restart. The shim counted them missing and asked for
 * the challenge document a SECOND time -- which the recorded journey has only
 * one response for, and which live means the challenge is issued twice.
 *
 * `$io` carries the origin that asked, so the default policy is expressible
 * here exactly: same origin allowed, cross origin not.
 */
export function clientHintsAllowed(
	url: URL,
	initiatorOrigin: string | undefined
): boolean {
	// No initiator is a top-level navigation: the document being fetched IS the
	// one the policy is `self` for.
	if (!initiatorOrigin) return true;

	return initiatorOrigin === url.origin;
}

/**
 * The hints this origin has asked for, if they are known yet.
 */
export function applyClientHints(
	headers: ScramjetHeaders,
	url: URL,
	allowed = true
) {
	if (!allowed) return;
	const wanted = accepted.get(url.origin);
	if (!wanted || values === null) return;

	for (const name of wanted) {
		const value = values[name];
		// A hint the browser would not answer is one the origin does not get,
		// rather than one it gets empty.
		if (value !== undefined) headers.set(name, value);
	}
}

/**
 * Does this response demand a hint the request did not carry?
 *
 * `Critical-CH` is the server saying "I cannot act on this request", so the
 * browser drops the response and sends the request again with the hints named.
 */
export function needsCriticalRestart(
	responseHeaders: ScramjetHeaders,
	requestHeaders: ScramjetHeaders,
	/**
	 * Whether the permissions policy lets this request carry the hints at all.
	 * A hint it does not allow is SKIPPED rather than counted missing, which is
	 * what stops a cross-origin frame restarting forever over a hint it is
	 * never going to be sent. See `clientHintsAllowed`.
	 */
	allowed = true
): boolean {
	if (!allowed) return false;
	const critical = responseHeaders.get("critical-ch");
	if (critical === null || values === null) return false;

	for (const raw of critical.split(",")) {
		const name = raw.trim().toLowerCase();
		if (!(name in HIGH_ENTROPY)) continue;
		// Only a hint we could actually have sent. Asking again for one this
		// browser does not have would loop forever.
		if (values[name] === undefined) continue;
		if (!requestHeaders.has(name)) return true;
	}

	return false;
}
