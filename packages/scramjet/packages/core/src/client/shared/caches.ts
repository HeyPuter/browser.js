import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";
import {
	Promise_all,
	String_startsWith,
	String_substring,
} from "@/shared/snapshot";

export default function (client: ScramjetClient, self: Self) {
	const scopedName = (name: string) => `${client.url.origin}@${name}`;
	const rewriteRequest = (request: RequestInfo): RequestInfo =>
		typeof request === "string"
			? client.rewriteUrl(request, { mode: "cors" })
			: request;

	const realUrl = (request: RequestInfo): string =>
		typeof request === "string"
			? request
			: client.unrewriteUrl(new client.native.Request(request).url);

	client.Intercept(
		class extends Cache {
			@Returns("Promise<(Response or undefined)>")
			@Arguments("(Request or USVString)", "optional CacheQueryOptions")
			match(
				request: RequestInfo,
				options: CacheQueryOptions = {}
			): Promise<Response | undefined> {
				return client.relevantPromise(this, async () => {
					const matched = await super.match(rewriteRequest(request), options);
					client.box.taggedResponses.add(matched);
					return matched;
				});
			}

			@Returns("Promise<sequence<Response>>")
			@Arguments(
				"optional (Request or USVString)",
				"optional CacheQueryOptions"
			)
			matchAll(
				request?: RequestInfo,
				options: CacheQueryOptions = {}
			): Promise<readonly Response[]> {
				return client.relevantPromise(this, async () => {
					request = request === undefined ? undefined : rewriteRequest(request);
					const matches = await super.matchAll(request, options);
					for (const match of matches) {
						client.box.taggedResponses.add(match);
					}
					return matches;
				});
			}

			@Returns("Promise<undefined>")
			@Arguments("(Request or USVString)")
			add(request: RequestInfo): Promise<void> {
				return client.relevantPromise(this, async () => {
					const response = await client.native
						.window(self)
						.fetch(rewriteRequest(request));
					await super.put(realUrl(request), response);
				});
			}

			@Returns("Promise<undefined>")
			@Arguments("sequence<(Request or USVString)>")
			addAll(requests: RequestInfo[]): Promise<void> {
				const promises: Promise<void>[] = [];
				for (const request of requests) {
					promises.push(
						(async () => {
							const response = await client.native
								.window(self)
								.fetch(rewriteRequest(request));
							await super.put(realUrl(request), response);
						})()
					);
				}
				return client.relevantPromise(this, async () => {
					return await Promise_all(promises);
				});
			}

			@Returns("Promise<undefined>")
			@Arguments("(Request or USVString)", "Response")
			put(request: RequestInfo, response: Response): Promise<void> {
				return super.put(realUrl(request), response);
			}

			@Returns("Promise<boolean>")
			@Arguments("(Request or USVString)", "optional CacheQueryOptions")
			delete(
				request: RequestInfo,
				options: CacheQueryOptions = {}
			): Promise<boolean> {
				return super.delete(realUrl(request), options);
			}

			@Returns("Promise<sequence<Request>>")
			@Arguments(
				"optional (Request or USVString)",
				"optional CacheQueryOptions"
			)
			keys(
				request?: RequestInfo,
				options: CacheQueryOptions = {}
			): Promise<readonly Request[]> {
				if (request === undefined) return super.keys(undefined, options);
				return super.keys(realUrl(request), options);
			}
		}
	);

	client.Intercept(
		class extends CacheStorage {
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
			match(
				request: RequestInfo,
				options: MultiCacheQueryOptions = {}
			): Promise<Response | undefined> {
				request = realUrl(request);

				if (options !== null && typeof options === "object") {
					const ignoreMethod = options.ignoreMethod;
					const ignoreSearch = options.ignoreSearch;
					const ignoreVary = options.ignoreVary;
					const rawCacheName = options.cacheName;
					const cacheName =
						rawCacheName === undefined ? undefined : scopedName(rawCacheName);
					const translatedOptions: MultiCacheQueryOptions = {
						ignoreMethod:
							ignoreMethod === undefined ? undefined : !!ignoreMethod,
						ignoreSearch:
							ignoreSearch === undefined ? undefined : !!ignoreSearch,
						ignoreVary: ignoreVary === undefined ? undefined : !!ignoreVary,
					};
					if (cacheName !== undefined) {
						translatedOptions.cacheName = cacheName;
					}
					options = translatedOptions;
				}

				// TODO: this leaks across origins but i don't care
				return client.relevantPromise(this, async () => {
					const match = await super.match(request, options);
					client.box.taggedResponses.add(match);
					return match;
				});
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
		}
	);
}
