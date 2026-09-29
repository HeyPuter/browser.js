import { GlobalScope, ScramjetClient } from "@client/index";
import {
	Arguments,
	Constructor,
	idlDOMString,
	idlUSVString,
	Returns,
	Type,
} from "@client/webidl";
import {
	carriedHeaderName,
	REFERRER_FALLBACK_HEADER,
	uncarriedHeaderName,
} from "@/shared/headers";
import { iswindow } from "@client/entry";
import type { NativeErrorSite } from "@client/nativeerror";
import { QP } from "@/fetch/parse";
import { MAX_REFERRER_LENGTH, referrerFallback } from "@rewriters/url";
import {
	Object_create,
	Reflect_apply,
	Reflect_get,
	String_startsWith,
	_URL,
	drain,
} from "@/shared/snapshot";

/** The init members a string-input `fetch()` / `new Request()` reads, sorted. */
const URL_INIT_MEMBERS = ["credentials", "headers", "mode"] as const;
/** The only one anything else has to look at. */
const HEADERS_INIT_MEMBER = ["headers"] as const;

/**
 * Capture the page's intended `init.mode` / `init.credentials` and forward
 * them to `rewriteUrl` so they get stamped onto the proxy URL as `sj$mode` /
 * `sj$cred`. The service-side handler reads those back when computing
 * Sec-Fetch-Mode / Sec-Fetch-Storage-Access, since `event.request.mode` and
 * `event.request.credentials` from the SW are derived against the rewritten
 * same-origin URL and don't reflect the page's actual intent.
 *
 * Takes the members as {@link readInit} read them, not the page's object.
 */
function rewriteUrlOptionsForFetch(members: Record<string, unknown>) {
	return {
		// `fetch()` and `new Request()` both default mode to "cors" per spec.
		mode: (members.mode as string | undefined) ?? "cors",
		credentials: members.credentials === "include" ? "include" : undefined,
	};
}

export default function (client: ScramjetClient, self: Self) {
	const nativeGlobal = new client.native.window(self);

	const toNativeHeaders = (headers: Headers) => {
		const nGlobal = new client.native.window(self);
		const newHeaders = new nGlobal.Headers();
		const nNew = new client.native.Headers(newHeaders);

		// `forEach`, which the native drives itself, rather than
		// `for (const [key, value] of nHeaders.entries())`. Reaching the
		// headers through `client.native` bought nothing there, because the
		// iteration never touched the native: the loop read @@iterator off the
		// iterator, which resolves to the page-replaceable `%IteratorPrototype%`,
		// and the destructuring read `Array.prototype[@@iterator]`. A page could
		// therefore choose what the restored view contained - and that view is
		// what `new Headers(init)`, `new Request(url, {headers})` and
		// `new Response(body, {headers})` are filled from
		new client.native.Headers(headers).forEach((value: string, key: string) => {
			const original = uncarriedHeaderName(key);
			if (original !== null) nNew.set(original, value);
		});

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

	/**
	 * A `RequestInit.referrer`, parsed, as the native constructor should see it.
	 *
	 * The native parses it against the proxy's URL and turns anything not
	 * same-origin with the proxy into `about:client`, so the site's URL has to
	 * be judged against the site's origin here and handed over as the proxy's.
	 * The service worker reads it back off the request.
	 *
	 * https://fetch.spec.whatwg.org/#dom-request (the `referrer` steps)
	 */
	const referrerFor = (parsed: URL): string => {
		if (parsed.protocol === "about:" && parsed.pathname === "client") {
			return "about:client";
		}
		if (parsed.origin !== client.siteOrigin) return "about:client";

		return client.rewriteUrl(parsed.href);
	};

	/**
	 * The member the native reads last in converting a `RequestInit`, found by
	 * watching it convert one - which, member for member, is the order it reads
	 * the page's in.
	 */
	let lastInitMember: string | symbol | undefined;
	const lastRequestInitMember = (): string | symbol | undefined => {
		if (lastInitMember === undefined) {
			new nativeGlobal.Request(
				"about:blank",
				new Proxy(Object_create(null), {
					get: (_, key) => {
						lastInitMember = key;
						return undefined;
					},
				})
			);
		}

		return lastInitMember;
	};

	/**
	 * What the native left undone when handed a view from {@link readInit}:
	 * the page's `referrer`, resolved, and whether `referrerPolicy` was given
	 * at all.
	 */
	type PendingReferrer = {
		referrer?: string;
		resolved?: string;
		policy?: boolean;
	};

	/**
	 * A `RequestInit` / `ResponseInit` with the members named by `keys` read
	 * exactly once, and a tagged `headers` swapped for the corrected view.
	 *
	 * The native converts the whole dictionary itself, so reading a member here
	 * and then handing the page's object on runs that member's getter twice.
	 * Nor can the object be copied: a member may be inherited, including off a
	 * platform object - `new Response(body, response)` reads `status` and
	 * `statusText` from `Response.prototype`, which an own-property copy drops,
	 * leaving a 200 OK.
	 *
	 * So the native is handed a view that answers the members read here from
	 * what they read as, and sends every other `[[Get]]` to the page's object
	 * with the page's object as the receiver, which is what keeps a platform
	 * getter's brand check passing. The view is not a proxy *of* the page's
	 * object: a frozen one's members could then only ever read as they are,
	 * and a proxy that answers otherwise throws. `mode` and `credentials` go
	 * through `ToString` here too, so the native converts a primitive and runs
	 * no page code a second time. What this cannot keep is WebIDL's
	 * lexicographic order: these members are read before the native reads the
	 * rest.
	 *
	 * `referrer`, which nothing here needs to know ahead of the native, is not
	 * one of them. With `site` given it is read and converted where the
	 * native reads it, so it keeps its place in that order - but it is only
	 * resolved once the whole dictionary has been read, as the constructor
	 * steps do, since a later member's getter can still move `<base>`. That is
	 * as the native reads its last member, and before it can take a body: one
	 * that does not parse then is refused there, with the native's TypeError.
	 * The native itself sees none, and {@link settleReferrer} hands it over
	 * afterwards.
	 */
	const readInit = <T>(
		init: T,
		keys: readonly string[],
		site?: NativeErrorSite
	): {
		init: T;
		members: Record<string, unknown>;
		pending: PendingReferrer;
	} => {
		const members: Record<string, unknown> = Object_create(null);
		const pending: PendingReferrer = Object_create(null);

		// undefined and null are the empty dictionary and anything else that is
		// not an object is the native's TypeError to raise, so neither has a
		// member to read
		if (
			init === null ||
			(typeof init !== "object" && typeof init !== "function")
		) {
			return { init, members, pending };
		}

		for (const key of drain(keys)) {
			members[key] = (init as Record<string, unknown>)[key];
		}

		if (members.mode !== undefined) members.mode = idlDOMString(members.mode);
		if (members.credentials !== undefined) {
			members.credentials = idlDOMString(members.credentials);
		}
		if (client.box.taggedHeaders.has(members.headers as Headers)) {
			members.headers = toNativeHeaders(members.headers as Headers);
		}

		const view = new Proxy(Object_create(null), {
			get: (_, key) => {
				if (key in members) return members[key as string];

				const value = Reflect_get(init as object, key, init);
				if (!site) return value;

				let result = value;
				if (key === "referrerPolicy" && value !== undefined) {
					pending.policy = true;
				}
				if (key === "referrer" && value !== undefined) {
					const string = idlUSVString(value);
					// an empty one has nothing to resolve
					if (string === "") {
						result = string;
					} else {
						pending.referrer = string;
						result = undefined;
					}
				}
				if (key === lastRequestInitMember()) {
					// converted here, an enum, so that no page code runs after
					if (key === "targetAddressSpace" && value !== undefined) {
						result = idlDOMString(value);
					}
					resolveReferrer(pending, site);
				}

				return result;
			},
		});

		return { init: view as T, members, pending };
	};

	const resolveReferrer = (pending: PendingReferrer, site: NativeErrorSite) => {
		if (pending.referrer === undefined) return;

		let parsed: URL;
		try {
			parsed = new _URL(pending.referrer, client.meta.base);
		} catch {
			throw client.errors.typeError({
				...site,
				detail: `Referrer '${pending.referrer}' is not a valid URL.`,
			});
		}
		pending.resolved = referrerFor(parsed);
	};

	/**
	 * `request` with the referrer {@link readInit} held back from the native.
	 *
	 * Rebuilt from `request` with only `referrer` - and the `referrerPolicy`
	 * that any non-empty init resets - which copies everything
	 * else across, the body included. `request` is never handed to the page,
	 * so its body being taken does not matter. Nor is what the native reset or
	 * not in building it: an init of nothing but `referrer` read as empty
	 * there, and this one is not.
	 */
	const settleReferrer = <R extends Request>(
		request: R,
		pending: PendingReferrer,
		Ctor: new (input: RequestInfo, init?: RequestInit) => R
	): R => {
		if (pending.resolved === undefined) return request;

		const init: RequestInit = Object_create(null);
		init.referrer = pending.resolved;
		if (pending.policy) {
			init.referrerPolicy = new client.native.Request(request).referrerPolicy;
		}

		return new Ctor(request, init);
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
	const rewriteRequestObject = async (request: Request): Promise<Request> => {
		const n = new client.native.Request(request);
		const url: string = n.url;

		if (String_startsWith(url, client.context.prefix.href)) return request;
		if (!String_startsWith(url, "http:") && !String_startsWith(url, "https:")) {
			return request;
		}
		// a disturbed body is the native's to refuse, with its own TypeError
		if (n.bodyUsed) return request;

		return copyRequest(
			request,
			n,
			client.rewriteUrl(url, {
				mode: n.mode === "navigate" ? "cors" : n.mode,
				credentials: n.credentials === "include" ? "include" : undefined,
			})
		);
	};

	/**
	 * `request` - read through the native, as `n` - at another URL.
	 *
	 * Or `request` itself when its signal has already been aborted, for the
	 * native to reject with the reason before reading any of the body - which
	 * an open stream would otherwise never finish giving up.
	 */
	const copyRequest = async (
		request: Request,
		n: Request,
		url: string
	): Promise<Request> => {
		if (new client.native.AbortSignal(n.signal).aborted) return request;

		const init: RequestInit = {
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
		// buffered rather than handed over as a stream: a stream body needs
		// `duplex: "half"`, which a keepalive request refuses outright and which
		// Firefox does not support at all
		if (n.body !== null) init.body = await n.blob();

		return new nativeGlobal.Request(url, init);
	};

	/**
	 * `request`, or a copy, telling the service worker what its referrer is
	 * where the browser would send that as nothing but an origin for the
	 * length of the proxy's URL for it alone.
	 *
	 * The URL a request is made for is stamped with that, for the page it was
	 * made in (see `referrerFallback`) - which is not the referrer when the
	 * request has one of its own, nor when it is sent from a page that has
	 * changed its URL since. So it is worked out again here, as the request is
	 * sent, and given to the service worker in a header that takes the stamp's
	 * place. `owned` is a request the page never sees, which can be given the
	 * header itself; a page's is copied first, which takes its body the way
	 * sending it does. A `no-cors` request cannot carry the header, and has its
	 * URL restamped instead.
	 */
	const withReferrerFallback = async (
		request: Request,
		owned: boolean
	): Promise<Request> => {
		const n = new client.native.Request(request);
		const referrer: string = n.referrer;

		let fallback: string | undefined;
		if (referrer === "about:client") {
			fallback = client.meta.referrerFallback;
		} else if (
			referrer.length > MAX_REFERRER_LENGTH &&
			String_startsWith(referrer, client.context.prefix.href)
		) {
			fallback = referrerFallback(
				referrer,
				new _URL(client.unrewriteUrl(referrer))
			);
		} else {
			// none, or one short enough to reach the service worker whole
			return request;
		}

		const url = new _URL(n.url);
		if ((fallback ?? null) === url.searchParams.get(QP.referrerFallback)) {
			return request;
		}

		if (n.mode === "no-cors") {
			if (fallback) url.searchParams.set(QP.referrerFallback, fallback);
			else url.searchParams.delete(QP.referrerFallback);

			return copyRequest(request, n, url.href);
		}

		const sent = owned ? request : new nativeGlobal.Request(request);
		new client.native.Headers(new client.native.Request(sent).headers).set(
			REFERRER_FALLBACK_HEADER,
			fallback ?? ""
		);

		return sent;
	};

	client.Intercept(class extends GlobalScope {
		// RequestInfo is the Fetch typedef `(Request or USVString)`.
		// https://fetch.spec.whatwg.org/#requestinfo
		@Arguments("(Request or USVString)", "optional RequestInit")
		@Returns("Promise<Response>")
		static async fetch(input: RequestInfo, requestInit?: RequestInit) {
			const { init, members, pending } = readInit(
				requestInit,
				typeof input === "string" ? URL_INIT_MEMBERS : HEADERS_INIT_MEMBER,
				{ execute: "fetch", on: iswindow ? "Window" : "WorkerGlobalScope" }
			);
			const page = input;
			input =
				typeof input === "string"
					? client.rewriteUrl(input, rewriteUrlOptionsForFetch(members))
					: await rewriteRequestObject(input);

			// through `this` rather than a saved global, so the native's own
			// receiver check still sees what the page called it on
			const nativeThis = new client.native.window(this);
			// the referrer is only settled once the init has been read, so a
			// fetch with one is a Request first, as `fetch()` itself does it
			// https://fetch.spec.whatwg.org/#dom-global-fetch
			let response: Response;
			if (init === undefined || init === null) {
				if (typeof input !== "string") {
					input = await withReferrerFallback(input, input !== page);
				}
				response = await nativeThis.fetch(input, init);
			} else {
				const request = settleReferrer(
					new nativeGlobal.Request(input, init),
					pending,
					nativeGlobal.Request
				);
				response = await nativeThis.fetch(
					await withReferrerFallback(request, true)
				);
			}
			client.box.taggedResponses.add(response);

			return response;
		}
	});

	client.Intercept(class extends Request {
		@Constructor("(Request or USVString)", "optional RequestInit")
		static konstructor(input: RequestInfo, requestInit?: RequestInit) {
			const { init, members, pending } = readInit(
				requestInit,
				typeof input === "string" ? URL_INIT_MEMBERS : HEADERS_INIT_MEMBER,
				{ construct: "Request" }
			);
			if (typeof input === "string") {
				input = client.rewriteUrl(input, rewriteUrlOptionsForFetch(members));
			}

			return settleReferrer(new this(input, init), pending, this);
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

		// the referrer init was handed to the native as a proxy URL, and one
		// that is not (`about:client`, or none) is the same for the site
		@Type("USVString")
		get referrer() {
			const referrer = super.referrer;

			return String_startsWith(referrer, client.context.prefix.href)
				? client.unrewriteUrl(referrer)
				: referrer;
		}
	});
	client.Intercept(class extends Response {
		@Constructor("optional BodyInit?", "optional ResponseInit")
		static konstructor(body?: BodyInit | null, responseInit?: ResponseInit) {
			return new this(body, readInit(responseInit, HEADERS_INIT_MEMBER).init);
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

	/**
	 * Make the native reject a name the carrier prefix would otherwise rescue.
	 *
	 * `carriedHeaderName("")` is `x-scramjet-`, which is a perfectly good header
	 * name, so prefixing first turns the TypeError Fetch owes the page for an
	 * invalid name into a silent `null`. Asking the native about the page's own
	 * string is the only way to get its verdict without restating the token
	 * grammar here; `has` performs the same validation as `get` and does
	 * nothing else.
	 */
	const validateHeaderName = (headers: Headers, name: string) => {
		new client.native.Headers(headers).has(name);
	};

	/* eslint-disable scramjet-core/intercept-brand-check --
	   `keys`, `values`, `entries` and `forEach` both reach the native: the
	   untagged path through `super`, and the tagged path inside
	   `toNativeHeaders`, which calls `new client.native.Headers(this).forEach`.
	   The rule does not follow the helper call, so it sees a return that skips
	   `super` and reports it. */
	client.Intercept(class extends Headers {
		@Constructor("optional HeadersInit")
		static konstructor(init?: HeadersInit) {
			return new this(restoreHeadersInit(init) as HeadersInit);
		}

		@Arguments("ByteString")
		@Returns("ByteString?")
		get(name: string): string | null {
			if (!client.box.taggedHeaders.has(this)) return super.get(name);

			validateHeaderName(this, name);

			return super.get(carriedHeaderName(name));
		}
		@Arguments("ByteString")
		@Returns("boolean")
		has(name: string): boolean {
			if (!client.box.taggedHeaders.has(this)) return super.has(name);

			validateHeaderName(this, name);

			return super.has(carriedHeaderName(name));
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
			// a non-callable is the native's TypeError to raise, before any pair
			if (
				!client.box.taggedHeaders.has(this) ||
				typeof callbackfn !== "function"
			) {
				return super.forEach(callbackfn, thisArg);
			}

			// the callback's third argument is the Headers being iterated, so it
			// has to be the page's object and not the corrected copy
			toNativeHeaders(this).forEach((value, key) => {
				Reflect_apply(callbackfn, thisArg, [value, key, this]);
			});
		}
	});
	self.Headers.prototype[self.Symbol.iterator] = self.Headers.prototype.entries;
}
