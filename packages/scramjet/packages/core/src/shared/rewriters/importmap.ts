/**
 * Import maps.
 *
 * An import map is a JSON document of URLs the module loader resolves against
 * the document's base URL - which, proxied, is the proxy's. Each URL in it has
 * to be rewritten the way the module loader would have seen it, or the map
 * points the page at the real origin and matches none of the rewritten URLs
 * the page actually imports from.
 *
 * Known hole: `integrity` is passed through untouched. Its keys are real
 * URLs, which match none of the rewritten ones, so the browser never checks a
 * digest - a module with the wrong one loads. Enforcing it would mean hashing
 * the original bytes ourselves: the body the browser sees is the rewritten
 * module, which no digest the page computed will ever match. `<script
 * integrity>` has the same hole, by the rule that blanks it.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#import-maps
 */

import { ScramjetContext } from "@/shared";
import { URLMeta, rewriteUrl } from "@rewriters/url";
import {
	JSON_parse,
	JSON_stringify,
	Object_keys,
	String_endsWith,
	String_startsWith,
	String_substring,
	_URL,
} from "@/shared/snapshot";

type SpecifierMap = Record<string, unknown>;

/** A specifier map's addresses, which are module URLs. */
function rewriteSpecifierMap(
	map: SpecifierMap,
	context: ScramjetContext,
	meta: URLMeta
) {
	const specifiers = Object_keys(map);
	for (let i = 0; i < specifiers.length; i++) {
		const url = map[specifiers[i]];
		if (typeof url === "string") {
			map[specifiers[i]] = rewriteUrl(url, context, meta, { isModule: true });
		}
	}
}

/**
 * A scope, which the loader matches as a *prefix* of the importing module's
 * URL. So it is rewritten to the start of a proxy URL only - the encoded
 * address with none of the query the proxy appends after it, which would sit
 * in the middle of every URL the scope has to match.
 */
function rewriteScope(
	scope: string,
	context: ScramjetContext,
	meta: URLMeta
): string {
	let url: _URL;
	try {
		url = new _URL(scope, meta.base);
	} catch {
		return scope;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return scope;
	url.hash = "";

	return context.prefix.href + context.interface.codecEncode(url.href);
}

/** Rewrite an import map's JSON. Throws what `JSON.parse` throws. */
export function rewriteImportMap(
	json: string,
	context: ScramjetContext,
	meta: URLMeta
): string {
	const map = JSON_parse(json);
	if (!map || typeof map !== "object") return json;

	if (map.imports && typeof map.imports === "object") {
		rewriteSpecifierMap(map.imports, context, meta);
	}

	if (map.scopes && typeof map.scopes === "object") {
		const scopes: Record<string, unknown> = {};
		const prefixes = Object_keys(map.scopes);
		for (let i = 0; i < prefixes.length; i++) {
			const specifiers = map.scopes[prefixes[i]];
			if (specifiers && typeof specifiers === "object") {
				rewriteSpecifierMap(specifiers, context, meta);
			}
			scopes[rewriteScope(prefixes[i], context, meta)] = specifiers;
		}
		map.scopes = scopes;
	}

	return JSON_stringify(map);
}

/**
 * A specifier map, normalized: its keys resolved where they are URL-like, its
 * addresses parsed (null for one that is invalid, which blocks the specifier),
 * longest key first.
 */
type NormalizedSpecifierMap = { key: string; address: _URL | null }[];

/** The import maps a document has registered, merged and normalized. */
export type ImportMapState = {
	imports: NormalizedSpecifierMap;
	scopes: { prefix: string; map: NormalizedSpecifierMap }[];
};

/** A resolution: the URL, "blocked" by a null or backtracking entry, or no match. */
export type ImportMapResolution = _URL | "blocked" | null;

/** https://html.spec.whatwg.org/multipage/webappapis.html#resolving-a-url-like-module-specifier */
function urlLike(specifier: string, base: string | _URL): _URL | null {
	const relative =
		String_startsWith(specifier, "/") ||
		String_startsWith(specifier, "./") ||
		String_startsWith(specifier, "../");
	try {
		return relative ? new _URL(specifier, base) : new _URL(specifier);
	} catch {
		return null;
	}
}

/**
 * Descending code unit order, which puts every key before the keys it is a
 * prefix of. By hand: `Array.prototype.sort` is the page's to replace.
 */
function sortDescending<T>(items: T[], key: (item: T) => string): T[] {
	for (let i = 1; i < items.length; i++) {
		const item = items[i];
		let j = i - 1;
		while (j >= 0 && key(items[j]) < key(item)) {
			items[j + 1] = items[j];
			j--;
		}
		items[j + 1] = item;
	}

	return items;
}

/** https://html.spec.whatwg.org/multipage/webappapis.html#sorting-and-normalizing-a-module-specifier-map */
function normalizeSpecifierMap(
	map: Record<string, unknown>,
	base: string | _URL,
	into: NormalizedSpecifierMap
) {
	const keys = Object_keys(map);
	for (let i = 0; i < keys.length; i++) {
		if (keys[i] === "") continue;
		const asURL = urlLike(keys[i], base);
		const key = asURL ? asURL.href : keys[i];
		// merged in registration order, and a later map cannot override an
		// entry an earlier one already has
		let seen = false;
		for (let j = 0; j < into.length; j++) {
			if (into[j].key === key) seen = true;
		}
		if (seen) continue;

		const value = map[keys[i]];
		let address = typeof value === "string" ? urlLike(value, base) : null;
		if (
			address &&
			String_endsWith(key, "/") &&
			!String_endsWith(address.href, "/")
		) {
			address = null;
		}
		into[into.length] = { key, address };
	}
	sortDescending(into, (entry) => entry.key);
}

/**
 * The import maps in `sources` - each the JSON a page wrote, in the order the
 * document registered them - merged into one, first registration winning.
 * A map that does not parse is skipped, the way the browser reports and
 * ignores it.
 */
export function parseImportMaps(
	sources: string[],
	base: string | _URL
): ImportMapState {
	const state: ImportMapState = { imports: [], scopes: [] };

	for (let i = 0; i < sources.length; i++) {
		let map: any;
		try {
			map = JSON_parse(sources[i]);
		} catch {
			continue;
		}
		if (!map || typeof map !== "object") continue;

		if (map.imports && typeof map.imports === "object") {
			normalizeSpecifierMap(map.imports, base, state.imports);
		}

		if (map.scopes && typeof map.scopes === "object") {
			const prefixes = Object_keys(map.scopes);
			for (let j = 0; j < prefixes.length; j++) {
				let prefixURL: _URL;
				try {
					prefixURL = new _URL(prefixes[j], base);
				} catch {
					continue;
				}
				const specifiers = map.scopes[prefixes[j]];
				if (!specifiers || typeof specifiers !== "object") continue;

				let scope: NormalizedSpecifierMap | null = null;
				for (let k = 0; k < state.scopes.length; k++) {
					if (state.scopes[k].prefix === prefixURL.href) {
						scope = state.scopes[k].map;
					}
				}
				if (!scope) {
					scope = [];
					state.scopes[state.scopes.length] = {
						prefix: prefixURL.href,
						map: scope,
					};
				}
				normalizeSpecifierMap(specifiers, base, scope);
			}
		}
	}
	sortDescending(state.scopes, (scope) => scope.prefix);

	return state;
}

/** https://html.spec.whatwg.org/multipage/webappapis.html#resolving-an-imports-match */
function matchSpecifierMap(
	normalized: string,
	asURL: _URL | null,
	map: NormalizedSpecifierMap
): ImportMapResolution {
	for (let i = 0; i < map.length; i++) {
		const { key, address } = map[i];
		if (key === normalized) return address ?? "blocked";

		if (
			String_endsWith(key, "/") &&
			String_startsWith(normalized, key) &&
			(asURL === null ||
				asURL.protocol === "http:" ||
				asURL.protocol === "https:")
		) {
			if (!address) return "blocked";
			let url: _URL;
			try {
				url = new _URL(String_substring(normalized, key.length), address);
			} catch {
				return "blocked";
			}
			// a backtracking `../` out of the mapped prefix
			if (!String_startsWith(url.href, address.href)) return "blocked";

			return url;
		}
	}

	return null;
}

/**
 * https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier
 * - the import map half of it, for a module whose URL is `referrer`. Null
 * when no map says anything about the specifier, and the caller resolves it
 * as the URL it is or lets the native refuse it.
 */
export function resolveWithImportMaps(
	state: ImportMapState,
	specifier: string,
	referrer: string
): ImportMapResolution {
	const asURL = urlLike(specifier, referrer);
	const normalized = asURL ? asURL.href : specifier;

	for (let i = 0; i < state.scopes.length; i++) {
		const { prefix, map } = state.scopes[i];
		if (
			prefix === referrer ||
			(String_endsWith(prefix, "/") && String_startsWith(referrer, prefix))
		) {
			const match = matchSpecifierMap(normalized, asURL, map);
			if (match !== null) return match;
		}
	}

	return matchSpecifierMap(normalized, asURL, state.imports);
}
