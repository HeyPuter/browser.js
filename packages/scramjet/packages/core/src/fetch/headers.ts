import {
	rewriteUrl,
	ScramjetContext,
	carriedHeaderName,
	ScramjetHeaders,
	unrewriteUrl,
	URLMeta,
} from "@/shared";
import {
	ScramjetFetchHandler,
	ScramjetFetchParsed,
	ScramjetFetchRequest,
} from ".";
import { RawHeaders } from "@mercuryworkshop/proxy-transports";
import { _URL, _Set } from "@/shared/snapshot";
import { createReferrerString } from "./util";
import { applyClientHints } from "./clienthints";

/**
 * Headers for security policy features that haven't been emulated yet
 */
const SEC_HEADERS = new _Set([
	"cross-origin-embedder-policy",
	"cross-origin-opener-policy",
	"cross-origin-resource-policy",
	"content-security-policy",
	"content-security-policy-report-only",
	"expect-ct",
	"feature-policy",
	"origin-isolation",
	"strict-transport-security",
	"upgrade-insecure-requests",
	"x-content-type-options",
	"x-download-options",
	"x-frame-options",
	"x-permitted-cross-domain-policies",
	"x-powered-by",
	"x-xss-protection",
	// This needs to be emulated, but for right now it isn't that important of a feature to be worried about
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data
	"clear-site-data",
]);

/**
 * Headers that are actually URLs that need to be rewritten
 */
const URL_HEADERS = new _Set(["location", "content-location", "referer"]);

function rewriteLinkHeader(
	link: string,
	context: ScramjetContext,
	meta: URLMeta
) {
	return link.replace(/<([^>]+)>/gi, (_match, p1) => {
		return `<${rewriteUrl(p1, context, meta)}>`;
	});
}

export function attachCarriedHeaders(
	headers: ScramjetHeaders,
	rawHeaders: RawHeaders
) {
	for (const [key, value] of rawHeaders) {
		if (key.toLowerCase().startsWith("set-cookie")) {
			// this is purely for browser consumption via Headers.get, and set-cookie is always hidden from js
			continue;
		}
		headers.append(carriedHeaderName(key), value);
	}
}

export async function rewriteResponseHeaders(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	rawHeaders: RawHeaders
): Promise<ScramjetHeaders> {
	const headers = ScramjetHeaders.fromRawHeaders(rawHeaders);
	attachCarriedHeaders(headers, rawHeaders);

	for (const cspHeader of SEC_HEADERS) {
		headers.delete(cspHeader);
	}

	for (const urlHeader of URL_HEADERS) {
		if (headers.has(urlHeader)) {
			const url = headers.get(urlHeader)!;
			const rewrittenUrl = rewriteUrl(url, handler.context, parsed.meta);
			headers.set(urlHeader, rewrittenUrl);
		}
	}

	if (headers.has("link")) {
		const link = headers.get("link")!;
		const rewritten = rewriteLinkHeader(link, handler.context, parsed.meta);
		headers.set("link", rewritten);
	}

	if (headers.get("accept") === "text/event-stream") {
		headers.set("content-type", "text/event-stream");
	}

	// scramjet runtime can use features that permissions-policy blocks
	headers.delete("permissions-policy");

	// we handle this ourselves
	headers.delete("set-cookie");

	if (
		handler.crossOriginIsolated &&
		[
			"document",
			"iframe",
			"worker",
			"sharedworker",
			"style",
			"script",
		].includes(parsed.destination)
	) {
		headers.set("Cross-Origin-Embedder-Policy", "require-corp");
		headers.set("Cross-Origin-Opener-Policy", "same-origin");
	}

	if (parsed.destination === "document" || parsed.destination === "iframe") {
		headers.set("Referrer-Policy", "unsafe-url");
	}

	return headers;
}

export function rewriteRequestHeaders(
	request: ScramjetFetchRequest,
	handler: ScramjetFetchHandler,
	parsed: ScramjetFetchParsed
): ScramjetHeaders {
	const headers = request.initialHeaders.clone();

	// avoid leaking the scramjet referer
	headers.delete("Referer");

	// The browser's own referrer, when it gave a full one, outranks
	// `rawClientUrl` -- because it is the only correctly TIMED answer.
	//
	// Blink fixes a request's referrer when the request is CREATED.
	// `rawClientUrl` is `client.url`, read by `await clients.get()` inside the
	// fetch handler, which runs afterwards. Any same-document URL change in
	// that window -- a `history.replaceState` -- silently rewrites the Referer
	// of a request that was already on its way.
	//
	// Measured on rateyourmusic, where it costs the challenge: the interstitial
	// replaceStates itself to `/?__cf_chl_rt_tk=<token>`, loads
	// `orchestrate/chl_page/v1`, and replaceStates the token back off. The
	// oracle's request carries `referer: https://rateyourmusic.com/?__cf_chl_rt_tk=...`
	// and the sandbox's carried `referer: https://rateyourmusic.com/` -- the
	// token gone, on the one request whose response carries the served
	// challenge configuration (RULES.md #201). Neither side ever REQUESTS a URL
	// with that token, so the URL only ever exists in place.
	//
	// Only when it is a full URL under the prefix. A policy that trims the
	// referrer to an origin gives something that does not unrewrite to a target
	// URL at all, and there `rawClientUrl` is still the better answer -- so the
	// old order is kept for every case except the one it gets wrong.
	const timedReferrer =
		request.rawReferrer &&
		request.rawReferrer.startsWith(handler.context.prefix.href)
			? new _URL(request.rawReferrer)
			: undefined;
	const rawOriginUrl =
		parsed.referrerSourceUrl !== undefined
			? parsed.referrerSourceUrl
			: timedReferrer ||
				request.rawClientUrl ||
				(request.rawReferrer ? new _URL(request.rawReferrer) : undefined);
	const originUrl =
		rawOriginUrl &&
		rawOriginUrl.pathname.startsWith(handler.context.prefix.pathname)
			? new _URL(unrewriteUrl(rawOriginUrl, handler.context))
			: rawOriginUrl;

	if (
		rawOriginUrl &&
		rawOriginUrl.pathname.startsWith(handler.context.prefix.pathname)
	) {
		// https://fetch.spec.whatwg.org/#origin-header
		//
		// "If request's method is neither GET nor HEAD, or request's mode is
		// websocket or cors" -- a plain GET for a script, an image or a
		// document carries no Origin at all. This was setting one on every
		// request that had an initiator under the prefix, so the proxy
		// announced an origin where a browser announces nothing.
		//
		// Measured at the wire against a live direct load: three URLs --
		// `orchestrate/chl_page/v1`, `favicon.ico`, and the Turnstile widget --
		// had `origin: https://rateyourmusic.com` from the sandbox and no
		// Origin at all from the oracle.
		//
		// `computeFetchMode` rather than `request.mode`, for the reason the
		// Sec-Fetch-Mode comment below gives: the service worker reports the
		// mode against the PROXY's URL space.
		const method = (request.method || "GET").toUpperCase();
		const originMode = computeFetchMode(request, parsed);
		if (method !== "GET" && method !== "HEAD") {
			headers.set("Origin", originUrl.origin);
		} else if (originMode === "cors" || originMode === "websocket") {
			headers.set("Origin", originUrl.origin);
		}

		const referer = createReferrerString(
			originUrl,
			parsed.url,
			parsed.referrerPolicy ?? null
		);
		if (referer) headers.set("Referer", referer);
	}

	const sameSiteContext = computeSameSiteContext(request, parsed, originUrl);
	const cookies = handler.context.cookieJar.getCookies(
		parsed.url,
		false,
		sameSiteContext
	);

	if (cookies.length) {
		headers.set("Cookie", cookies);
	}

	applyFetchMetadataHeaders(headers, request, parsed, handler);
	// After everything else, and keyed on the TARGET origin: the browser put
	// the low-entropy three on this request for the PROXY's origin, and the
	// high-entropy ones are owed to whoever asked for them by name.
	applyClientHints(headers, parsed.url);

	return headers;
}

/**
 * Compute and attach the Sec-Fetch-* request metadata headers, per
 * https://w3c.github.io/webappsec-fetch-metadata/.
 *
 * Browsers compute these based on the proxy URL space (page → service worker),
 * which is meaningless to the destination. We strip those values and recompute
 * based on the logical (unrewritten) URLs so that the destination sees
 * realistic Sec-Fetch-Site / -Mode / -Dest / -User values.
 *
 * These headers are only attached when the destination URL is a "potentially
 * trustworthy" URL — matching Chrome's behaviour of omitting them when sending
 * to plain http:// non-loopback destinations.
 */
function applyFetchMetadataHeaders(
	headers: ScramjetHeaders,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	handler: ScramjetFetchHandler
) {
	// Strip browser-attached Sec-Fetch-* (computed from the proxy URL space).
	headers.delete("sec-fetch-site");
	headers.delete("sec-fetch-mode");
	headers.delete("sec-fetch-dest");
	headers.delete("sec-fetch-user");
	headers.delete("sec-fetch-storage-access");

	if (!isPotentiallyTrustworthy(parsed.url)) {
		return;
	}

	// Determine the request initiator's origin. Unlike the Referer header,
	// this never gets stripped by referrer policy: it's the page that actually
	// initiated the chain. Prefer the propagated initiator origin for
	// post-redirect requests; otherwise fall back to rawClientUrl/rawReferrer.
	const initiatorUrl = resolveFetchInitiatorUrl(request, parsed, handler);

	// Sec-Fetch-Site: relationship between request initiator's origin and the URL.
	let site: "none" | "same-origin" | "same-site" | "cross-site";
	if (!initiatorUrl) {
		// No initiator (e.g., user typed URL, or browser-initiated request).
		site = "none";
	} else {
		const immediate = computeFetchSite(initiatorUrl, parsed.url);
		site = parsed.fetchSiteState
			? worstFetchSite(parsed.fetchSiteState, immediate)
			: immediate;
	}
	headers.set("Sec-Fetch-Site", site);

	// Sec-Fetch-Mode: the request's mode. `event.request.mode` from the SW is
	// computed against the proxy URL space (always same-origin to the page) so
	// it's not safe to trust for fetch / Request API calls; we prefer the
	// `sj$mode` value the client-side proxy stamped onto the URL when present
	// and fall back to a destination-based default for everything else.
	headers.set("Sec-Fetch-Mode", computeFetchMode(request, parsed));

	let emulatedTopLevel = false;
	if (parsed.destination === "iframe") {
		if (!parsed.isIframe) {
			// emulate a top-level navigation
			headers.set("Sec-Fetch-Dest", "document");
			emulatedTopLevel = true;
		} else {
			headers.set("Sec-Fetch-Dest", "iframe");
		}
	} else {
		headers.set("Sec-Fetch-Dest", parsed.destination || "empty");
	}

	// Sec-Fetch-User: sent as "?1" only on user-activated navigation requests
	// (top-level documents, iframes, frames, and embedded objects). The browser
	// already attaches this header to the page→SW request when the navigation
	// originates from a user gesture, so we forward that signal for any
	// navigation destination.
	const isNavigationDestination =
		parsed.destination === "document" ||
		parsed.destination === "iframe" ||
		parsed.destination === "frame" ||
		parsed.destination === "embed" ||
		parsed.destination === "object";
	if (
		isNavigationDestination &&
		request.initialHeaders.get("sec-fetch-user") === "?1"
	) {
		headers.set("Sec-Fetch-User", "?1");
	} else if (emulatedTopLevel && site === "none") {
		// The Dest emulation two blocks up is only half of the lie. Measured
		// against Chromium 155, a browser attaches `Sec-Fetch-User` to a
		// navigation if and only if
		// transient user activation is live -- the same frame, the same URL,
		// navigated from a click sends `?1` and navigated from a timer six
		// seconds later does not.
		//
		// `Sec-Fetch-Site: none` means browser-initiated: a typed URL, a
		// bookmark, a new tab. Every way of producing one is a user acting, so
		// Chrome never sends this combination without `?1`, and claiming
		// `Dest: document` + `Mode: navigate` + `Site: none` while withholding
		// it produces a request no browser makes. That is worse than either
		// lie alone, because it is the ENTRY navigation -- the request an
		// anti-bot decides on before a line of the page's JavaScript runs.
		//
		// Only here. A scripted `location.href` inside the guest computes a
		// real site of same-origin or cross-site, takes neither branch, and
		// keeps correctly saying nothing.
		headers.set("Sec-Fetch-User", "?1");
	}

	// Sec-Fetch-Storage-Access: per https://privacycg.github.io/storage-access-headers/.
	// Sent on cross-site credentialed requests so the destination knows whether
	// unpartitioned storage access has been granted. We never grant storage
	// access through the proxy, so the value is always "none" when sent.
	//
	// `event.request.credentials` inside a service worker isn't reliable, so we
	// rely on signals propagated from the page (the `sj$cred` URL param set by
	// the client-side fetch proxy) plus destination-based defaults for request
	// types that always include credentials.
	if (site === "cross-site" && requestIncludesCredentials(request, parsed)) {
		headers.set("Sec-Fetch-Storage-Access", "none");
	}

	applyPriorityHeader(headers, parsed, emulatedTopLevel);

	// No `accept-encoding`: it is the transport's to send, because the
	// transport is what decodes the response. Chromium offers `gzip, deflate,
	// br, zstd`, but a server takes whichever it likes best, and a transport
	// offered an encoding it cannot decode fails the request outright -
	// libcurl answers zstd with "Unrecognized or bad HTTP Content or
	// Transfer-Encoding".
}

/**
 * RFC 9218 extensible priorities, as Chrome sends them.
 *
 * Measured against Chromium 155 over HTTP/2, one page pulling one of each kind
 * against a throwaway h2 server. The numbers are recorded here because this is
 * where they are used:
 *
 *   document   u=0, i      iframe   u=0, i      style  u=0
 *   script     u=1         font     u=1         fetch  u=1, i
 *   image      u=2, i      favicon  u=1, i
 *   script defer/async     (no header at all)
 *   image from `new Image()` after parse      `i`
 *
 * The default is `u=3, i=0`, and Chrome omits whatever matches it -- which is
 * why a deferred script sends nothing and a late image sends `i` alone.
 *
 * Only the destinations whose value does not depend on something a service
 * worker cannot see. `script` and `image` are deliberately absent: the same
 * destination is `u=1` or nothing depending on `defer`/`async`, and `u=2, i`
 * or `i` depending on whether the parser or a script asked for it, and neither
 * distinction survives into `event.request`. Guessing one of the two would
 * replace "header missing" with "header wrong", which is the same size of
 * difference and harder to find later.
 *
 * Sent regardless of protocol because the protocol is not known here -- ALPN
 * settles it inside the transport, long after this. A browser sends none on
 * HTTP/1.1, so there it is one header more than Chromium's; only the transport
 * learns the protocol, so dropping it there is the transport's to do.
 */
function applyPriorityHeader(
	headers: ScramjetHeaders,
	parsed: ScramjetFetchParsed,
	emulatedTopLevel: boolean
) {
	// An iframe the proxy is presenting as a top-level document is still
	// `u=0, i` -- measured, a real iframe and a real document agree on this
	// one -- so the emulation costs nothing here.
	void emulatedTopLevel;

	const priority = {
		document: "u=0, i",
		iframe: "u=0, i",
		frame: "u=0, i",
		embed: "u=0, i",
		object: "u=0, i",
		style: "u=0",
		font: "u=1",
		empty: "u=1, i",
	}[parsed.destination || "empty"];

	if (priority) headers.set("Priority", priority);
}

/**
 * Whether this request will carry credentials to the destination. Used by
 * Sec-Fetch-Storage-Access. The browser's `event.request.credentials` value
 * can't be trusted in a service worker context, so we reconstruct the answer
 * from:
 *
 * - the `sj$cred` URL parameter, set by the client-side fetch proxy when the
 *   page used `fetch(url, { credentials: "include" })`; and
 * - destination-based defaults: most resource fetches (img, script, style,
 *   link, video, audio, track, document/iframe navigations, etc.) default to
 *   credentials mode "include" unless the page explicitly opts out via a
 *   `crossorigin` attribute we can't observe from here. fetch() / XHR
 *   default to "same-origin", so we treat them as non-credentialed unless
 *   `sj$cred` says otherwise.
 */
function requestIncludesCredentials(
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed
): boolean {
	if (parsed.fetchCredentialsInclude) return true;
	const dest = parsed.destination;
	// fetch(): destination is "" (empty). XHR / report: destination is
	// "report". Both default to credentials="same-origin", so cross-site
	// requests don't include credentials unless the page explicitly opts in.
	if (dest === "" || dest === "report") return false;
	// ES modules (including module scripts and module-typed workers) default
	// to credentials="same-origin", so cross-site fetches do not carry
	// credentials.
	if (parsed.isModule) return false;
	// Other destinations (image, classic-script, style, audio, video, track,
	// font, iframe, frame, document, embed, object, manifest, classic worker,
	// sharedworker, serviceworker, ...) default to credentials="include".
	return true;
}

/**
 * Determine the Sec-Fetch-Mode value for a request.
 *
 * The browser's `event.request.mode` reported in the SW is unsafe to trust
 * for `fetch()` / `new Request()` calls — those compute mode against the
 * request URL's relationship to the page, and scramjet has rewritten the URL
 * to be same-origin to the page, so the SW always sees "same-origin"
 * regardless of the page's actual `init.mode`. For HTML resource fetches
 * (`<script crossorigin>`, `<img crossorigin>`, …) the mode is derived from
 * the element's CORS attribute rather than URL origin, so the SW's reported
 * mode IS reliable there.
 *
 * Resolution order:
 *   1. `parsed.fetchMode` — set by the client-side fetch / Request proxy from
 *      `init.mode` (or fetch's "cors" default). Authoritative for
 *      page-initiated fetch / Request / XHR-style calls.
 *   2. Top-level navigations: always "navigate".
 *   3. Workers: classic → "same-origin", module → "cors".
 *   4. Everything else: trust the SW's `request.mode` (it reflects the
 *      element's CORS attribute), falling back to "no-cors" if it's missing
 *      or implausible (e.g. "same-origin" / "navigate" leaking in from a
 *      proxy-URL computation).
 */
function computeFetchMode(
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed
): string {
	if (parsed.fetchMode) return parsed.fetchMode;
	const dest = parsed.destination;
	if (
		dest === "document" ||
		dest === "iframe" ||
		dest === "frame" ||
		dest === "embed" ||
		dest === "object"
	) {
		return "navigate";
	}
	if (dest === "worker" || dest === "sharedworker") {
		// Classic workers default to same-origin; module workers default to cors.
		return parsed.isModule ? "cors" : "same-origin";
	}
	// HTML element fetches: the browser's `request.mode` here reflects the
	// element's CORS attribute (`<script crossorigin>` ⇒ "cors", plain
	// `<script>` ⇒ "no-cors"), so trust it. Reject "same-origin"/"navigate"
	// since those indicate the value came from URL-origin matching against
	// scramjet's proxy origin and is meaningless to the destination.
	if (request.mode === "cors" || request.mode === "no-cors") {
		return request.mode;
	}
	return "no-cors";
}

/**
 * Resolve the unrewritten URL of the page (or worker) that initiated this
 * request. Used by Sec-Fetch-Site, which always compares against the original
 * initiator regardless of Referer policy.
 */
function resolveFetchInitiatorUrl(
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	handler: ScramjetFetchHandler
): URL | undefined {
	// On any hop after the first, the propagated initiator origin is the
	// authoritative source. rawReferrer may have been replaced with the
	// previous hop's URL, and rawClientUrl is unset for top-level navigations.
	if (parsed.fetchInitiatorOrigin) {
		try {
			return new _URL(parsed.fetchInitiatorOrigin);
		} catch {
			// fall through to the fallbacks below
		}
	}
	const candidate =
		request.rawClientUrl ||
		(request.rawReferrer ? new _URL(request.rawReferrer) : undefined);
	if (!candidate) return undefined;
	if (candidate.pathname.startsWith(handler.context.prefix.pathname)) {
		return new _URL(unrewriteUrl(candidate, handler.context));
	}
	// The candidate URL is outside scramjet's logical space (e.g. the runway
	// harness wrapper page, or a chrome:// page kicking off a navigation).
	// There's no meaningful "initiator" in the proxied site's frame of
	// reference, so treat it as a browser-initiated request — Sec-Fetch-Site
	// will be "none".
	return undefined;
}

/**
 * Whether a URL is "potentially trustworthy" per
 * https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy.
 *
 * This is a slimmed-down implementation: HTTPS / WSS, file:, and the common
 * loopback hostnames (localhost, *.localhost, 127.0.0.0/8, ::1) are treated as
 * trustworthy. Everything else (including plain http:// to a real hostname) is
 * not.
 */
function isPotentiallyTrustworthy(url: URL): boolean {
	const protocol = url.protocol;
	if (protocol === "https:" || protocol === "wss:" || protocol === "file:") {
		return true;
	}
	if (protocol !== "http:" && protocol !== "ws:") {
		// data:, blob:, etc. – defer to the caller; treated as not trustworthy
		// for the purpose of attaching Sec-Fetch-* network headers.
		return false;
	}
	return isLoopbackHost(url.hostname);
}

function isLoopbackHost(hostname: string): boolean {
	if (hostname === "localhost" || hostname === "localhost.") return true;
	if (hostname.endsWith(".localhost") || hostname.endsWith(".localhost.")) {
		return true;
	}
	if (hostname === "[::1]" || hostname === "::1") return true;
	// Match 127.0.0.0/8 (any 127.x.y.z address).
	if (/^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(hostname)) {
		return true;
	}
	return false;
}

/**
 * Compute the immediate Sec-Fetch-Site relation between an initiator origin and
 * a destination URL.
 *
 * - "same-origin" if scheme + host + port match exactly.
 * - "same-site" if scheme matches and the registrable domains match.
 * - "cross-site" otherwise.
 */
export function computeFetchSite(
	originUrl: URL,
	destUrl: URL
): "same-origin" | "same-site" | "cross-site" {
	if (
		originUrl.protocol === destUrl.protocol &&
		originUrl.host === destUrl.host
	) {
		return "same-origin";
	}
	if (
		originUrl.protocol === destUrl.protocol &&
		registrableDomain(originUrl.hostname) ===
			registrableDomain(destUrl.hostname)
	) {
		return "same-site";
	}
	return "cross-site";
}

/**
 * Combine two Sec-Fetch-Site classifications, returning the "worst" (least
 * trusted) of the two. Used when propagating state through redirect chains.
 */
export function worstFetchSite(
	a: "none" | "same-origin" | "same-site" | "cross-site",
	b: "none" | "same-origin" | "same-site" | "cross-site"
): "none" | "same-origin" | "same-site" | "cross-site" {
	const order = { "cross-site": 0, "same-site": 1, "same-origin": 2, none: 3 };
	return order[a] <= order[b] ? a : b;
}

/**
 * Compute the SameSite enforcement context for a request.
 *
 * "strict"     – same-site or no known origin (allow all cookies)
 * "lax"        – cross-site top-level GET/HEAD navigation (block Strict)
 * "cross-site" – cross-site subresource or non-safe-method navigation (block Strict+Lax)
 */
function computeSameSiteContext(
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	rawOriginUrl: URL | undefined
): "strict" | "lax" | "cross-site" {
	// If a redirect chain previously passed through a cross-site origin, the
	// final request is always treated as cross-site regardless of its destination.
	if (parsed.crossSiteRedirect) {
		const isNavigation =
			parsed.destination === "document" || parsed.destination === "iframe";
		const isSafeMethod = request.method === "GET" || request.method === "HEAD";
		return isNavigation && isSafeMethod ? "lax" : "cross-site";
	}

	if (!rawOriginUrl) return "strict";

	const originSite = registrableDomain(rawOriginUrl.hostname);
	const targetSite = registrableDomain(parsed.url.hostname);

	// Same site → no SameSite restrictions
	if (originSite === targetSite) return "strict";

	// Cross-site request: check if it's a navigational GET/HEAD (lax) or subresource/POST (cross-site)
	const isNavigation =
		parsed.destination === "document" || parsed.destination === "iframe";
	const isSafeMethod = request.method === "GET" || request.method === "HEAD";

	if (isNavigation && isSafeMethod) return "lax";
	return "cross-site";
}

/**
 * Compute the "registrable domain" (eTLD+1) of a hostname for same-site comparison.
 * This is a simplified implementation that handles common test cases
 * (localhost, IPs, and typical domain structures) without a full PSL lookup.
 */
function registrableDomain(hostname: string): string {
	// IPv4 / IPv6: site = exact IP
	if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return hostname;

	const labels = hostname.split(".");
	if (labels.length <= 1) return hostname; // bare hostname like "localhost"

	// Strip a leading "www." for same-site comparison so that
	// www.example.com and example.com are treated as the same site.
	// More complex cases (e.g. s1.s2.example.co.uk) are not handled here
	// but are uncommon in test environments.
	if (labels[0] === "www") return labels.slice(1).join(".");

	// For two-label hostnames like "example.com", use as-is
	if (labels.length === 2) return hostname;

	// For longer hostnames, use the last two labels as a rough eTLD+1
	return labels.slice(-2).join(".");
}
