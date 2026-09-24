// Cache original upstream bytes, then run the normal rewrite pipeline on hits.
// All tabs share this private HTTP cache; frame-specific rewritten URLs never
// enter storage. Policy follows RFC 9111 and Fetch's request cache modes.
import {
	Plugin,
	type ScramjetFetchHandler,
	type ScramjetFetchRequest,
} from "@mercuryworkshop/scramjet/bundled";
import { BareResponse } from "@mercuryworkshop/proxy-transports";
import {
	canReuse,
	initialAge,
	parseCacheControl,
	responseIsStorable,
} from "./cachePolicy";

// v2 entries did not record corrected age and could contain empty HEAD bodies.
export const CACHE_NAME = "scramjet-http-cache-v3";
const STORED_AT_HEADER = "x-sj-cached-at";
const INITIAL_AGE_HEADER = "x-sj-initial-age";
const VARY_VALUES_HEADER = "x-sj-vary-values";
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
const CONDITIONAL_HEADERS = [
	"if-match",
	"if-none-match",
	"if-modified-since",
	"if-unmodified-since",
	"if-range",
];

function keyFor(url: string): Request {
	const canonical = new URL(url);
	canonical.hash = "";
	return new Request(
		"https://sj-cache.invalid/" + encodeURIComponent(canonical.href)
	);
}

const ALL_VARIANTS = { ignoreSearch: true, ignoreVary: true };

function matchesVariant(stored: Response, headers: Headers): boolean {
	try {
		const values: [string, string | null][] = JSON.parse(
			stored.headers.get(VARY_VALUES_HEADER) ?? "null"
		);
		return (
			Array.isArray(values) &&
			values.every(([name, value]) => headers.get(name) === value)
		);
	} catch {
		return false;
	}
}

async function variantKey(
	key: Request,
	response: Headers,
	request: Headers
): Promise<Request> {
	const names = [
		...new Set(
			(response.get("vary") ?? "")
				.toLowerCase()
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean)
		),
	].sort();
	const values = JSON.stringify(names.map((name) => [name, request.get(name)]));
	response.set(VARY_VALUES_HEADER, values);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(values)
	);
	const url = new URL(key.url);
	url.searchParams.set(
		"variant",
		[...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("")
	);
	return new Request(url);
}

function responseHeaders(stored: Response): Headers {
	const headers = new Headers(stored.headers);
	headers.delete(STORED_AT_HEADER);
	headers.delete(INITIAL_AGE_HEADER);
	headers.delete(VARY_VALUES_HEADER);
	// A cache hit must not reapply a cookie that the user/site has since changed.
	headers.delete("set-cookie");
	return headers;
}

type RequestState = {
	key: Request;
	headers: Headers;
	started: number;
	generation: number;
	noStore: boolean;
	cacheHit?: boolean;
	revalidation?: { stored: Response; retry: () => Promise<BareResponse> };
};

export interface HttpCachePluginOptions {
	cacheName?: string;
}

export class CacheMissError extends Error {
	constructor() {
		super("No matching response in the HTTP cache");
	}
}

export class HttpCachePlugin extends Plugin {
	readonly cacheName: string;
	private cachePromise: Promise<Cache> | null = null;
	private clearing: Promise<boolean> | null = null;
	private generation = 0;
	private requests = new WeakMap<ScramjetFetchRequest, RequestState>();

	constructor(options: HttpCachePluginOptions = {}) {
		super("scramjet-http-cache");
		this.cacheName = options.cacheName ?? CACHE_NAME;
	}

	private openCache(): Promise<Cache> {
		if (this.clearing) return this.clearing.then(() => this.openCache());
		return (this.cachePromise ??= caches.open(this.cacheName).catch((error) => {
			this.cachePromise = null;
			throw error;
		}));
	}

	install(target: { fetchHandler: ScramjetFetchHandler }): void {
		const hooks = target.fetchHandler.hooks.fetch;
		this.tap(hooks.request, async (ctx, props) => {
			const req = ctx.request;
			const cacheOnly = req.cache === "only-if-cached";
			if (props.earlyResponse) return;
			if (cacheOnly) {
				const origin =
					ctx.parsed.fetchInitiatorOrigin ?? ctx.parsed.clientUrl?.origin;
				// Native same-origin checks compare proxy URLs. Preserve the
				// original origin across cached redirects as required by Fetch.
				if (req.mode !== "same-origin" || origin !== ctx.parsed.url.origin)
					throw new CacheMissError();
			}
			// Vary compares the headers actually sent upstream, including cookies.
			const headers = new Headers(props.init.headers);
			const cc = parseCacheControl(headers.get("cache-control"));
			const special =
				headers.has("range") ||
				CONDITIONAL_HEADERS.some((name) => headers.has(name));
			const state: RequestState = {
				key: keyFor(ctx.parsed.url.href),
				headers,
				started: Date.now(),
				generation: this.generation,
				noStore: req.cache === "no-store" || cc.has("no-store") || special,
			};
			this.requests.set(req, state);
			if (
				(req.method !== "GET" && req.method !== "HEAD") ||
				state.noStore ||
				req.cache === "reload"
			) {
				if (cacheOnly) throw new CacheMissError();
				return;
			}
			try {
				const cache = await this.openCache();
				// Chromium's Cache.put replaces by URL; synthetic variant keys also
				// avoid Request's forbidden-header filtering (notably Cookie).
				const stored = [...(await cache.matchAll(state.key, ALL_VARIANTS))]
					.reverse()
					.find((entry) => matchesVariant(entry, headers));
				if (!stored) {
					if (cacheOnly) throw new CacheMissError();
					return;
				}
				const received = Number(stored.headers.get(STORED_AT_HEADER));
				const age =
					Number(stored.headers.get(INITIAL_AGE_HEADER)) +
					Math.max(0, (Date.now() - received) / 1000);
				if (!canReuse(stored.headers, headers, req.cache, age, received)) {
					if (cacheOnly) throw new CacheMissError();
					const etag = stored.headers.get("etag");
					const modified = stored.headers.get("last-modified");
					if (req.method === "GET" && (etag || modified)) {
						const originalInit = { ...props.init, headers: [...headers] };
						state.revalidation = {
							stored,
							retry: () => ctx.client.fetch(props.url, originalInit),
						};
						const conditional = new Headers(headers);
						if (etag) conditional.set("if-none-match", etag);
						if (modified) conditional.set("if-modified-since", modified);
						props.init.headers = [...conditional];
					}
					return;
				}
				const resultHeaders = responseHeaders(stored);
				resultHeaders.set("age", String(Math.floor(age)));
				props.earlyResponse = BareResponse.fromNativeResponse(
					new Response(
						req.method === "HEAD" || NULL_BODY_STATUSES.has(stored.status)
							? null
							: stored.body,
						{
							status: stored.status,
							statusText: stored.statusText,
							headers: resultHeaders,
						}
					)
				);
				state.cacheHit = true;
			} catch (error) {
				// Storage failures cannot turn an explicitly offline request into
				// a network request. The controller forwards this as Response.error().
				if (cacheOnly) throw new CacheMissError();
				// Storage being unavailable must not turn a working network into an error.
				console.warn("[scramjet-http-cache] lookup failed:", error);
			}
		});

		this.tap(hooks.preresponse, async (ctx, props) => {
			const req = ctx.request;
			const state = this.requests.get(req);
			this.requests.delete(req);
			if (!state || state.cacheHit) return;
			let received = Date.now();
			if (state.revalidation && props.response.status === 304) {
				const { stored, retry } = state.revalidation;
				const update = new Headers(props.response.rawHeaders);
				const etag = update.get("etag");
				const modified = update.get("last-modified");
				// RFC 9111 §4.3.4: a validator must identify the representation
				// being refreshed. A mismatched 304 cannot supply a usable body.
				const matches = etag
					? etag.startsWith("W/")
						? etag.slice(2) === stored.headers.get("etag")?.replace(/^W\//, "")
						: etag === stored.headers.get("etag")
					: modified !== null &&
						modified === stored.headers.get("last-modified");
				if (matches) {
					const merged = responseHeaders(stored);
					merged.delete("age");
					merged.set("date", new Date(received).toUTCString());
					for (const [name, value] of update) {
						// §3.2: retain the stored body's length and decoded encoding.
						if (
							!["content-length", "content-encoding", "set-cookie"].includes(
								name
							)
						)
							merged.set(name, value);
					}
					for (const [name, value] of props.response.rawHeaders)
						if (name.toLowerCase() === "set-cookie") merged.append(name, value);
					props.response = BareResponse.fromNativeResponse(
						new Response(stored.body, {
							status: stored.status,
							statusText: stored.statusText,
							headers: merged,
						})
					);
					// Native Response filters Set-Cookie. Preserve the fresh 304
					// headers for the proxy's cookie processing, per Fetch's guard:
					// https://fetch.spec.whatwg.org/#headers-validate
					props.response.rawHeaders = [...merged];
				} else {
					props.response = await retry();
					received = Date.now();
				}
			}
			const response = props.response;
			const headers = new Headers(response.rawHeaders);
			// A concurrent clear prevents storage, but a pending conditional
			// response still needs its body resolved for the active request.
			if (state.generation !== this.generation) return;
			try {
				// RFC 9111 §4.4: successful unsafe methods invalidate every variant.
				if (
					!SAFE_METHODS.has(req.method) &&
					response.status >= 200 &&
					response.status < 400
				) {
					const cache = await this.openCache();
					await cache.delete(state.key, ALL_VARIANTS);
					for (const name of ["location", "content-location"]) {
						const value = headers.get(name);
						if (!value) continue;
						try {
							const related = new URL(value, ctx.parsed.url.href);
							if (related.origin === ctx.parsed.url.origin)
								await cache.delete(keyFor(related.href), ALL_VARIANTS);
						} catch {
							/* An invalid Location has no cache entry. */
						}
					}
					return;
				}
				// RFC 9111 §4.3.5 permits invalidation after a network HEAD. Never
				// replace a GET representation with HEAD's empty response body.
				if (req.method === "HEAD") {
					if (response.status === 200)
						await (await this.openCache()).delete(state.key, ALL_VARIANTS);
					return;
				}
				if (req.method !== "GET" || state.noStore) return;
				if (!responseIsStorable(response.status, headers)) {
					if (
						headers.has("cache-control") &&
						parseCacheControl(headers.get("cache-control")).has("no-store")
					)
						await (await this.openCache()).delete(state.key, ALL_VARIANTS);
					return;
				}
				const body = NULL_BODY_STATUSES.has(response.status)
					? null
					: await response.clone().arrayBuffer();
				if (state.generation !== this.generation) return;
				headers.set(STORED_AT_HEADER, String(received));
				headers.set(
					INITIAL_AGE_HEADER,
					String(initialAge(headers, state.started, received))
				);
				const cache = await this.openCache();
				if (state.generation !== this.generation) return;
				const key = await variantKey(state.key, headers, state.headers);
				if (state.generation !== this.generation) return;
				await cache.put(
					key,
					new Response(body, {
						status: response.status,
						statusText: response.statusText,
						headers,
					})
				);
			} catch (error) {
				console.warn("[scramjet-http-cache] update failed:", error);
			}
		});
	}

	async bust(): Promise<boolean> {
		// In-flight responses from before a clear must not repopulate the cache.
		this.generation++;
		const deletion = caches.delete(this.cacheName);
		this.cachePromise = null;
		this.clearing = deletion;
		try {
			return await deletion;
		} finally {
			if (this.clearing === deletion) this.clearing = null;
		}
	}
}
