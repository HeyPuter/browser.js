import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";
import {
	Promise_all,
	String_startsWith,
	String_substring,
	_Set,
	_URL,
} from "@/shared/snapshot";

export default function (client: ScramjetClient, self: Self) {
	const nGlobal = new client.native.window(self);
	const scopedName = (name: string) => `${client.url.origin}@${name}`;
	const rewriteRequest = (request: RequestInfo): RequestInfo =>
		typeof request === "string"
			? client.rewriteUrl(request, { mode: "cors" })
			: request;

	const realUrl = (request: RequestInfo): string =>
		typeof request === "string"
			? new _URL(request, client.url).href
			: client.unrewriteUrl(new client.native.Request(request).url);

	/**
	 * The key as something the native cache will accept.
	 *
	 * A Request has to stay a Request. The method is what `ignoreMethod`
	 * compares and what `put` rejects a non-GET on, and the headers are what
	 * `Vary` matches against — flattening it to a URL string throws both away.
	 * Mode, credentials and destination are dropped on purpose: none of them are
	 * part of a cache key, and all of them differ between two ways of asking for
	 * the same resource.
	 */
	const cacheKey = (request: RequestInfo): RequestInfo => {
		if (typeof request === "string") return realUrl(request);

		const nRequest = new client.native.Request(request);

		return new nGlobal.Request(realUrl(request), {
			method: nRequest.method,
			headers: nRequest.headers,
		});
	};

	const tag = <T>(response: T): T => {
		// are we getting a cache entry that came off a fetch(), or was it created by the user?
		// Response.url can't be faked, so this proves it
		const networkProvenance = String_startsWith(
			new client.native.Response(response).url,
			client.context.prefix.href
		);
		if (response && networkProvenance) {
			client.box.taggedResponses.add(response as Response);
		}

		return response;
	};

	/**
	 * https://w3c.github.io/ServiceWorker/#cache-addall, which `add` is defined
	 * as the one-element case of.
	 *
	 * Not delegable to the native: it would fetch whichever URL it was keyed
	 * with, and the key is the *site's*, which does not go through the proxy. So
	 * the fetch and every check that gates it happen here, in the spec's order —
	 * scheme, then every response, then the batch itself.
	 *
	 * `put` is passed in because `super` only resolves inside a class method.
	 */
	const runAddAll = async (
		requests: RequestInfo[],
		method: "add" | "addAll",
		put: (key: RequestInfo, response: Response) => Promise<void>
	): Promise<void> => {
		for (let i = 0; i < requests.length; i++) {
			const url = realUrl(requests[i]);
			if (
				!String_startsWith(url, "http:") &&
				!String_startsWith(url, "https:")
			) {
				throw client.errors.typeError({
					execute: method,
					on: "Cache",
					detail: "Request scheme must be http or https",
				});
			}
		}

		// every fetch has to land before anything is written, so a failure part
		// way through cannot leave half a batch behind
		const responses = await Promise_all(
			requests.map((request) => nGlobal.fetch(rewriteRequest(request)))
		);

		for (let i = 0; i < responses.length; i++) {
			if (!responses[i].ok) {
				throw client.errors.typeError({
					execute: method,
					on: "Cache",
					detail: "Request failed",
				});
			}
		}

		const seen = new _Set<string>();
		for (let i = 0; i < requests.length; i++) {
			const url = realUrl(requests[i]);
			if (seen.has(url)) {
				throw client.errors.domException("InvalidStateError", {
					execute: method,
					on: "Cache",
					detail: `duplicate requests (${url}).`,
				});
			}
			seen.add(url);
		}

		await Promise_all(
			requests.map((request, i) => put(cacheKey(request), responses[i]))
		);
	};

	client.Intercept(class extends Cache {
		@Returns("Promise<(Response or undefined)>")
		@Arguments("(Request or USVString)", "optional CacheQueryOptions")
		async match(
			request: RequestInfo,
			options: CacheQueryOptions = {}
		): Promise<Response | undefined> {
			return tag(await super.match(cacheKey(request), options));
		}

		@Returns("Promise<sequence<Response>>")
		@Arguments("optional (Request or USVString)", "optional CacheQueryOptions")
		async matchAll(
			request?: RequestInfo,
			options: CacheQueryOptions = {}
		): Promise<readonly Response[]> {
			const matches = await super.matchAll(
				request === undefined ? undefined : cacheKey(request),
				options
			);
			for (const match of matches) tag(match);

			return matches;
		}

		@Returns("Promise<undefined>")
		@Arguments("(Request or USVString)")
		async add(request: RequestInfo): Promise<void> {
			return runAddAll([request], "add", (key, response) =>
				super.put(key, response)
			);
		}

		@Returns("Promise<undefined>")
		@Arguments("sequence<(Request or USVString)>")
		async addAll(requests: RequestInfo[]): Promise<void> {
			return runAddAll(requests, "addAll", (key, response) =>
				super.put(key, response)
			);
		}

		@Returns("Promise<undefined>")
		@Arguments("(Request or USVString)", "Response")
		put(request: RequestInfo, response: Response): Promise<void> {
			return super.put(cacheKey(request), response);
		}

		@Returns("Promise<boolean>")
		@Arguments("(Request or USVString)", "optional CacheQueryOptions")
		delete(
			request: RequestInfo,
			options: CacheQueryOptions = {}
		): Promise<boolean> {
			return super.delete(cacheKey(request), options);
		}

		@Returns("Promise<sequence<Request>>")
		@Arguments("optional (Request or USVString)", "optional CacheQueryOptions")
		keys(
			request?: RequestInfo,
			options: CacheQueryOptions = {}
		): Promise<readonly Request[]> {
			if (request === undefined) return super.keys(undefined, options);
			return super.keys(cacheKey(request), options);
		}
	});

	client.Intercept(class extends CacheStorage {
		@Returns("Promise<Cache>")
		@Arguments("DOMString")
		open(cacheName: string): Promise<Cache> {
			return super.open(scopedName(cacheName));
		}

		@Returns("Promise<boolean>")
		@Arguments("DOMString")
		has(cacheName: string): Promise<boolean> {
			return super.has(scopedName(cacheName));
		}

		@Returns("Promise<(Response or undefined)>")
		@Arguments("(Request or USVString)", "optional MultiCacheQueryOptions")
		async match(
			request: RequestInfo,
			options: MultiCacheQueryOptions = {}
		): Promise<Response | undefined> {
			const key = cacheKey(request);

			if (options !== null && typeof options === "object") {
				const ignoreMethod = options.ignoreMethod;
				const ignoreSearch = options.ignoreSearch;
				const ignoreVary = options.ignoreVary;
				const rawCacheName = options.cacheName;
				const cacheName =
					rawCacheName === undefined ? undefined : scopedName(rawCacheName);
				const translatedOptions: MultiCacheQueryOptions = {
					ignoreMethod: ignoreMethod === undefined ? undefined : !!ignoreMethod,
					ignoreSearch: ignoreSearch === undefined ? undefined : !!ignoreSearch,
					ignoreVary: ignoreVary === undefined ? undefined : !!ignoreVary,
				};
				if (cacheName !== undefined) {
					translatedOptions.cacheName = cacheName;
				}
				options = translatedOptions;
			}

			// TODO: this leaks across origins but i don't care
			return tag(await super.match(key, options));
		}

		@Returns("Promise<boolean>")
		@Arguments("DOMString")
		delete(cacheName: string): Promise<boolean> {
			return super.delete(scopedName(cacheName));
		}

		@Returns("Promise<sequence<DOMString>>")
		@Arguments()
		async keys(): Promise<string[]> {
			const names = await super.keys();
			const prefix = `${client.url.origin}@`;
			const visible: string[] = [];

			for (let i = 0; i < names.length; i++) {
				if (String_startsWith(names[i], prefix)) {
					visible[visible.length] = String_substring(names[i], prefix.length);
				}
			}

			return visible;
		}
	});
}
