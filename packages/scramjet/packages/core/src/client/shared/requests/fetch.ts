import { GlobalScope, ScramjetClient } from "@client/index";
import { Arguments, Constructor, Returns, Type } from "@client/webidl";
import { carriedHeaderName, uncarriedHeaderName } from "@/shared/headers";
import { Object_assign, String_startsWith } from "@/shared/snapshot";

/**
 * Capture the page's intended `init.mode` / `init.credentials` and forward
 * them to `rewriteUrl` so they get stamped onto the proxy URL as `sj$mode` /
 * `sj$cred`. The service-side handler reads those back when computing
 * Sec-Fetch-Mode / Sec-Fetch-Storage-Access, since `event.request.mode` and
 * `event.request.credentials` from the SW are derived against the rewritten
 * same-origin URL and don't reflect the page's actual intent.
 */
function rewriteUrlOptionsForFetch(init: RequestInit | undefined) {
	return {
		// `fetch()` and `new Request()` both default mode to "cors" per spec.
		mode: init?.mode ?? "cors",
		credentials: init?.credentials === "include" ? "include" : undefined,
	};
}

export default function (client: ScramjetClient, self: Self) {
	const nativeGlobal = new client.native.window(self);

	const toNativeHeaders = (headers: Headers) => {
		const nGlobal = new client.native.window(self);
		const nHeaders = new client.native.Headers(headers);
		const newHeaders = new nGlobal.Headers();
		for (const [key, value] of nHeaders.entries()) {
			const original = uncarriedHeaderName(key);
			if (original !== null) newHeaders.set(original, value);
		}
		return newHeaders;
	};

	/**
	 * A `HeadersInit` the native constructors can be handed safely.
	 *
	 * `new Headers(h)`, `new Request(u, {headers: h})` and
	 * `new Response(b, {headers: h})` all fill from `h` by walking its internal
	 * header list, not by calling the `entries()` we patched - so handing them a
	 * tagged Headers copies the `x-scramjet-` carriers straight through into a
	 * list nothing corrects afterwards. Substitute the corrected view.
	 */
	const restoreHeadersInit = (init: unknown): unknown =>
		client.box.taggedHeaders.has(init as Headers)
			? toNativeHeaders(init as Headers)
			: init;

	/** The same, for the `headers` member of a Request/Response init. */
	const withRestoredHeaders = <T>(init: T): T => {
		if (init === null || typeof init !== "object") return init;

		const headers = (init as { headers?: unknown }).headers;
		if (!client.box.taggedHeaders.has(headers as Headers)) return init;

		return Object_assign({}, init, {
			headers: toNativeHeaders(headers as Headers),
		});
	};

	/**
	 * A Request whose URL is the site's rather than the proxy's, rebuilt against
	 * the proxy URL.
	 *
	 * Anything built through our own constructor is already rewritten, but not
	 * every Request comes from there: a `cache.keys()` entry is keyed by the real
	 * URL by design, and one handed over from another realm never passed through
	 * us at all. Fetching either as-is goes straight at the origin and fails.
	 */
	const rewriteRequestObject = (request: Request): Request => {
		const n = new client.native.Request(request);
		const url: string = n.url;

		if (String_startsWith(url, client.context.prefix.href)) return request;
		if (!String_startsWith(url, "http:") && !String_startsWith(url, "https:")) {
			return request;
		}

		const init: RequestInit & { duplex?: string } = {
			method: n.method,
			headers: n.headers,
			// "navigate" cannot be reconstructed through the constructor, and a
			// fetch() of one is not something a page can do anyway
			mode: n.mode === "navigate" ? undefined : n.mode,
			credentials: n.credentials,
			cache: n.cache,
			redirect: n.redirect,
			referrer: n.referrer,
			referrerPolicy: n.referrerPolicy,
			integrity: n.integrity,
			keepalive: n.keepalive,
			signal: n.signal,
		};
		if (n.body) {
			init.body = n.body;
			init.duplex = "half";
		}

		return new nativeGlobal.Request(
			client.rewriteUrl(url, {
				mode: n.mode === "navigate" ? "cors" : n.mode,
				credentials: n.credentials === "include" ? "include" : undefined,
			}),
			init
		);
	};

	client.Intercept(class extends GlobalScope {
		// RequestInfo is the Fetch typedef `(Request or USVString)`.
		// https://fetch.spec.whatwg.org/#requestinfo
		@Arguments("(Request or USVString)", "optional RequestInit")
		@Returns("Promise<Response>")
		static async fetch(input: RequestInfo, requestInit: RequestInit = {}) {
			input =
				typeof input === "string"
					? client.rewriteUrl(input, rewriteUrlOptionsForFetch(requestInit))
					: rewriteRequestObject(input);

			const response = await nativeGlobal.fetch(
				input,
				withRestoredHeaders(requestInit)
			);
			client.box.taggedResponses.add(response);

			return response;
		}
	});

	client.Intercept(class extends Request {
		@Constructor("(Request or USVString)", "optional RequestInit")
		static konstructor(input: RequestInfo, requestInit: RequestInit = {}) {
			if (typeof input === "string") {
				input = client.rewriteUrl(
					input,
					rewriteUrlOptionsForFetch(requestInit)
				);
			}

			return new this(input, withRestoredHeaders(requestInit));
		}

		@Type("USVString")
		get url() {
			const url = super.url;
			// in almost every case, the URL is already rewritten
			// the exception is the request coming off a cache.keys()
			// worth looking into tagging this instead of the string match/

			return String_startsWith(url, client.context.prefix.href)
				? client.unrewriteUrl(url)
				: url;
		}
	});
	client.Intercept(class extends Response {
		@Constructor("optional BodyInit?", "optional ResponseInit")
		static konstructor(body?: BodyInit | null, responseInit?: ResponseInit) {
			return new this(body, withRestoredHeaders(responseInit));
		}

		@Type("USVString")
		get url(): string {
			if (client.box.taggedResponses.has(this)) {
				return client.unrewriteUrl(super.url);
			}
			return super.url;
		}
		@Type("Headers")
		get headers(): Headers {
			const headers = super.headers;
			if (client.box.taggedResponses.has(this)) {
				// this is a response object that came from a network request. tag it so that the headers can be replaced later
				client.box.taggedHeaders.add(headers);
			}
			return headers;
		}

		// the clone is a separate Response object, and an untagged one reads
		// back the *proxy's* URL and the wire's stripped header list. the tag
		// has to travel with it
		@Returns("Response")
		@Arguments()
		clone(): Response {
			const cloned = super.clone();
			if (client.box.taggedResponses.has(this)) {
				client.box.taggedResponses.add(cloned);
			}

			return cloned;
		}
	});

	client.Intercept(class extends Headers {
		@Constructor("optional HeadersInit")
		static konstructor(init?: HeadersInit) {
			return new this(restoreHeadersInit(init) as HeadersInit);
		}

		@Arguments("ByteString")
		@Returns("ByteString?")
		get(name: string): string | null {
			if (client.box.taggedHeaders.has(this)) {
				return super.get(carriedHeaderName(name));
			}

			return super.get(name);
		}
		@Arguments("ByteString")
		@Returns("boolean")
		has(name: string): boolean {
			if (client.box.taggedHeaders.has(this)) {
				return super.has(carriedHeaderName(name));
			}
			return super.has(name);
		}
		keys(): HeadersIterator<string> {
			if (client.box.taggedHeaders.has(this)) {
				return toNativeHeaders(this).keys();
			}
			return super.keys();
		}
		values(): HeadersIterator<string> {
			if (client.box.taggedHeaders.has(this)) {
				return toNativeHeaders(this).values();
			}
			return super.values();
		}
		entries(): HeadersIterator<[string, string]> {
			if (client.box.taggedHeaders.has(this)) {
				return toNativeHeaders(this).entries();
			}
			return super.entries();
		}
		forEach(callbackfn: any, thisArg?: any): void {
			if (client.box.taggedHeaders.has(this)) {
				return toNativeHeaders(this).forEach(callbackfn, thisArg);
			}
			return super.forEach(callbackfn, thisArg);
		}
	});
	self.Headers.prototype[self.Symbol.iterator] = self.Headers.prototype.entries;
}
