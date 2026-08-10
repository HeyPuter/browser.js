import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";

export default function (client: ScramjetClient, _self: Self) {
	const scopedName = (name: string) => `${client.url.origin}@${name}`;

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

			// RequestInfo is the Fetch typedef `(Request or USVString)`. Spell it
			// out so Intercept can perform the union's Web IDL conversion once.
			// https://w3c.github.io/ServiceWorker/#dom-cachestorage-match
			@Returns("Promise<(Response or undefined)>")
			@Arguments("(Request or USVString)", "optional MultiCacheQueryOptions")
			match(
				request: RequestInfo,
				options: MultiCacheQueryOptions = {}
			): Promise<Response | undefined> {
				if (typeof request === "string") {
					request = client.rewriteUrl(request);
				}

				// Let the native binding reject non-dictionaries. null is the empty
				// dictionary per Web IDL, so it is valid and needs no translation.
				if (
					options === null ||
					(typeof options !== "object" && typeof options !== "function")
				) {
					return super.match(request, options);
				}

				// Snapshot the inherited dictionary members in Web IDL's sorted order.
				// This makes each page-controlled getter run once, and avoids mutating
				// the caller while translating the internal cache-name namespace.
				const rawCacheName = options.cacheName;
				const cacheName =
					rawCacheName === undefined ? undefined : scopedName(rawCacheName);
				const ignoreMethod = options.ignoreMethod;
				const ignoreSearch = options.ignoreSearch;
				const ignoreVary = options.ignoreVary;
				const translatedOptions: MultiCacheQueryOptions = {
					ignoreMethod: ignoreMethod === undefined ? undefined : !!ignoreMethod,
					ignoreSearch: ignoreSearch === undefined ? undefined : !!ignoreSearch,
					ignoreVary: ignoreVary === undefined ? undefined : !!ignoreVary,
				};
				if (cacheName !== undefined) {
					translatedOptions.cacheName = cacheName;
				}

				return super.match(request, translatedOptions);
			}

			@Returns("Promise<boolean>")
			@Arguments("DOMString")
			delete(cacheName: string): Promise<boolean> {
				return super.delete(scopedName(cacheName));
			}
		}
	);

	// TODO - check if this might leak things if Response from fetch is passed in and the url isn't properly being unrewritten
}
