import { Cookie } from "@/shared";
const SAME_SITE = ["strict", "lax", "none"] as const;

import {
	Arguments,
	Returns,
	idlBoolean,
	idlDictionary,
	idlDouble,
	idlEnum,
	idlUSVString,
} from "@client/webidl";
import { parse as parseSetCookie } from "@/shared/set-cookie-parser";

import {
	_Date,
	_URL,
	Math_trunc,
	String_indexOf,
	String_startsWith,
	String_substring,
	String_toLowerCase,
	TypeError,
} from "@/shared/snapshot";
import { ScramjetClient } from "@client/client";

export const enabled = (client: ScramjetClient, self: Self) =>
	"CookieStore" in self;
export default function (client: ScramjetClient, self: Self) {
	/**
	 * A stored cookie as the Cookie Store API reports it.
	 *
	 * The jar keeps every domain dot-prefixed and tracks host-only separately;
	 * this API says a host-only cookie has a null domain and a domain cookie
	 * reports the bare domain.
	 */
	const toCookieListItem = (cookie: Cookie): CookieListItem => {
		const sameSite = String_toLowerCase(cookie.sameSite ?? "lax");

		return {
			name: cookie.name,
			value: cookie.value,
			domain: cookie.hostOnly ? null : String_substring(cookie.domain!, 1),
			path: cookie.path!,
			expires: cookie.expires ?? null,
			secure: !!cookie.secure,
			// the jar tolerates whatever a Set-Cookie header spelled; this API is
			// an enum, and its own default matches the jar's
			sameSite: (SAME_SITE.indexOf(sameSite as CookieSameSite) === -1
				? "lax"
				: sameSite) as CookieSameSite,
			partitioned: !!cookie.partitioned,
		};
	};

	/**
	 * https://cookiestore.spec.whatwg.org/#query-cookies
	 *
	 * `url` is only ever the current document's URL in a window — the spec
	 * reserves a different in-scope URL for service workers — so once it has
	 * been validated there is nothing left for it to select.
	 */
	const query = (name?: string, url?: string): CookieListItem[] => {
		if (url !== undefined) {
			const parsed = new _URL(url, client.url);
			// compared without the fragment, which is not part of a cookie's
			// scope and which the document's own URL may or may not carry
			parsed.hash = "";
			const current = new _URL(client.url.href);
			current.hash = "";

			if (parsed.href !== current.href) {
				throw new TypeError(
					"Cookies can only be read for the current document's URL."
				);
			}
		}

		const cookies = client.context.cookieJar.getCookieList(client.url, true);
		const items: CookieListItem[] = [];

		for (let i = 0; i < cookies.length; i++) {
			if (name !== undefined && cookies[i].name !== name) continue;
			items[items.length] = toCookieListItem(cookies[i]);
		}

		return items;
	};

	/**
	 * WebIDL overload resolution between a `(USVString)` and a `(dictionary)`
	 * overload of the same arity: an object — a function counts, null does not —
	 * picks the dictionary, and so does an absent or undefined argument.
	 * Everything else, a number included, is converted as a string.
	 * https://webidl.spec.whatwg.org/#es-overloads
	 */
	const isDictionaryArgument = (value: unknown): boolean =>
		value === undefined ||
		value === null ||
		typeof value === "object" ||
		typeof value === "function";

	const readGetOptions = (value: unknown): [string?, string?] => {
		const dict = idlDictionary(value, "CookieStoreGetOptions");

		const rawName = dict.name;
		const name = rawName === undefined ? undefined : idlUSVString(rawName);
		const rawUrl = dict.url;
		const url = rawUrl === undefined ? undefined : idlUSVString(rawUrl);

		return [name, url];
	};

	type WriteInit = {
		name: string;
		value: string;
		domain: string | null;
		path: string;
		expires: number | null;
		sameSite: CookieSameSite;
		partitioned: boolean;
	};

	/**
	 * https://cookiestore.spec.whatwg.org/#set-a-cookie
	 *
	 * The Set-Cookie text for a write, or null when the write is invalid.
	 *
	 * Null means "hand this to the native store", not "throw" — see
	 * {@link nativeInit}. Every rejection here is one the browser makes too, so
	 * the page gets the browser's own message instead of our approximation of
	 * it, which is the same bargain `compileIDLValidator` strikes for arguments.
	 *
	 * Writes are serialized rather than applied structurally so they go through
	 * the identical path as the `document.cookie` setter — one jar, mutually
	 * visible, one sync message. The jar's own parser is the authority on what
	 * that path accepts, so it does the pair-level checking; anything it drops
	 * would be a write that silently vanished.
	 */
	const serialize = (init: WriteInit): string | null => {
		const { name, value } = init;

		// these three have to come first, because they are the ones the parser
		// would not catch: a ';' reads back as an attribute boundary and an '='
		// as a name/value split, so the text would round-trip to a *different*
		// cookie rather than to nothing
		if (String_indexOf(name, ";") !== -1) return null;
		if (String_indexOf(name, "=") !== -1) return null;
		if (String_indexOf(value, ";") !== -1) return null;
		if (name === "" && String_indexOf(value, "=") !== -1) return null;

		let domain = init.domain;
		if (domain !== null) {
			domain = String_toLowerCase(domain);
			// the leading dot is a Set-Cookie spelling, not a value this API takes
			if (String_startsWith(domain, ".")) return null;

			// the one rejection that cannot be delegated. every other check here
			// is about the cookie alone, so the native reaches the same verdict —
			// but this one is about the *host*, and the native would compare
			// against the proxy's rather than the site's. handing it over could
			// mean a domain that happens to match the proxy, which the native
			// would accept and write for real
			const host = String_toLowerCase(client.url.hostname);
			const suffix = String_substring(host, host.length - domain.length - 1);
			if (domain !== host && suffix !== `.${domain}`) {
				throw new TypeError(
					"Cookie domain must domain-match the current host."
				);
			}
		}

		let path = init.path;
		if (!String_startsWith(path, "/")) return null;
		// the spec appends the slash, so `path: "/foo"` scopes to "/foo/" and
		// does not match "/foo" itself
		if (path[path.length - 1] !== "/") path += "/";

		// __Host- additionally requires Secure, which every write here is
		if (String_startsWith(String_toLowerCase(name), "__host-")) {
			if (domain !== null || path !== "/") return null;
		}

		let cookie = `${name}=${value}`;
		if (domain !== null) cookie += `; Domain=${domain}`;
		cookie += `; Path=${path}`;
		if (init.expires !== null) cookie += `; Max-Age=${toMaxAge(init.expires)}`;
		// this API only ever writes secure cookies
		cookie += `; Secure; SameSite=${init.sameSite}`;
		if (init.partitioned) cookie += "; Partitioned";

		// control characters, an oversized pair, an empty pair. the parser drops
		// those silently, which is right for a header off the wire and wrong
		// here, so ask it before committing rather than restating its rules
		if (parseSetCookie(cookie).length === 0) return null;

		return cookie;
	};

	const commit = async (cookie: string): Promise<void> => {
		client.context.cookieJar.setCookies(cookie, client.url);
		// unlike the `document.cookie` setter this awaits the sync: the returned
		// promise is what a caller sequences a following fetch() behind, so it
		// has to mean the cookie will actually be on that request
		await client.init.sendSetCookie([{ url: client.url, cookie }]);
	};

	/**
	 * The dictionary to hand the native store for a write {@link serialize}
	 * rejected, so that the page sees a real browser TypeError.
	 *
	 * Rebuilt from the values we already converted rather than forwarding the
	 * page's own object: its getters have run once, and running them a second
	 * time is exactly the fingerprint the IDL layer exists to prevent.
	 *
	 * The native cannot write as a side effect of this. We only get here for a
	 * cookie the browser rejects on its own terms — a ';' or '=' in the name, a
	 * dotted domain, a path with no leading slash, a __Host- violation, a pair
	 * the parser would not take — none of which depend on which origin is
	 * asking.
	 */
	const nativeInit = (init: WriteInit): CookieInit => ({
		name: init.name,
		value: init.value,
		domain: init.domain,
		path: init.path,
		expires: init.expires,
		sameSite: init.sameSite,
		partitioned: init.partitioned,
	});

	client.Intercept(class extends CookieStore {
		// `get`/`getAll`/`delete` are each two overloads taking one argument,
		// which the decorator layer spells as the union it resolves to: an
		// object picks the dictionary, anything else the name.
		@Returns("Promise<CookieListItem?>")
		@Arguments("optional (USVString or CookieStoreGetOptions)")
		async get(
			nameOrOptions?: string | CookieStoreGetOptions
		): Promise<CookieListItem | null> {
			const items = isDictionaryArgument(nameOrOptions)
				? query(...readGetOptions(nameOrOptions))
				: query(idlUSVString(nameOrOptions));

			return items.length ? items[0] : null;
		}

		@Returns("Promise<CookieList>")
		@Arguments("optional (USVString or CookieStoreGetOptions)")
		async getAll(
			nameOrOptions?: string | CookieStoreGetOptions
		): Promise<CookieList> {
			return isDictionaryArgument(nameOrOptions)
				? query(...readGetOptions(nameOrOptions))
				: query(idlUSVString(nameOrOptions));
		}

		// `set` is the one member whose overloads differ in arity rather than
		// in type, so the argument *count* picks it — `set("a", undefined)` is
		// the two-argument form with the value "undefined", while `set("a")` is
		// the dictionary form and fails to convert.
		@Returns("Promise<undefined>")
		@Arguments("(USVString or CookieInit)", "optional USVString")
		async set(
			nameOrOptions: string | CookieInit,
			value?: string
		): Promise<void> {
			if (arguments.length > 1) {
				const init: WriteInit = {
					name: idlUSVString(nameOrOptions),
					value: idlUSVString(value),
					domain: null,
					path: "/",
					expires: null,
					sameSite: "strict",
					partitioned: false,
				};
				const cookie = serialize(init);

				return cookie === null ? super.set(nativeInit(init)) : commit(cookie);
			}

			// members are read *and* converted one at a time in WebIDL's order —
			// lexicographic by name — because every one of them is a
			// page-controlled getter, and a missing required member has to
			// throw before the getters that sort after it ever run
			const dict = idlDictionary(nameOrOptions, "CookieInit");

			const rawDomain = dict.domain;
			const domain =
				rawDomain === undefined || rawDomain === null
					? null
					: idlUSVString(rawDomain);
			const rawExpires = dict.expires;
			const expires =
				rawExpires === undefined || rawExpires === null
					? null
					: idlDouble(rawExpires);
			const rawName = dict.name;
			if (rawName === undefined) {
				throw new TypeError("CookieInit requires the member 'name'.");
			}
			const name = idlUSVString(rawName);
			const rawPartitioned = dict.partitioned;
			const partitioned =
				rawPartitioned === undefined ? false : idlBoolean(rawPartitioned);
			const rawPath = dict.path;
			const path = rawPath === undefined ? "/" : idlUSVString(rawPath);
			const rawSameSite = dict.sameSite;
			const sameSite =
				rawSameSite === undefined
					? "strict"
					: idlEnum(rawSameSite, SAME_SITE, "CookieSameSite");
			const rawValue = dict.value;
			if (rawValue === undefined) {
				throw new TypeError("CookieInit requires the member 'value'.");
			}
			const cookieValue = idlUSVString(rawValue);

			const init: WriteInit = {
				name,
				value: cookieValue,
				domain,
				path,
				expires,
				sameSite,
				partitioned,
			};
			const cookie = serialize(init);

			return cookie === null ? super.set(nativeInit(init)) : commit(cookie);
		}

		/** A delete is a write of an empty value that already expired. */
		@Returns("Promise<undefined>")
		@Arguments("(USVString or CookieStoreDeleteOptions)")
		async delete(
			nameOrOptions: string | CookieStoreDeleteOptions
		): Promise<void> {
			const expired = {
				value: "",
				// the epoch is unconditionally in the past, which is the jar's
				// signal to drop the record rather than store a dead one
				expires: 0,
				sameSite: "strict" as const,
			};

			if (!isDictionaryArgument(nameOrOptions)) {
				const init: WriteInit = {
					...expired,
					name: idlUSVString(nameOrOptions),
					domain: null,
					path: "/",
					partitioned: false,
				};
				const cookie = serialize(init);

				return cookie === null
					? super.delete(nativeInit(init))
					: commit(cookie);
			}

			const dict = idlDictionary(nameOrOptions, "CookieStoreDeleteOptions");

			const rawDomain = dict.domain;
			const domain =
				rawDomain === undefined || rawDomain === null
					? null
					: idlUSVString(rawDomain);
			const rawName = dict.name;
			if (rawName === undefined) {
				throw new TypeError(
					"CookieStoreDeleteOptions requires the member 'name'."
				);
			}
			const name = idlUSVString(rawName);
			const rawPartitioned = dict.partitioned;
			const partitioned =
				rawPartitioned === undefined ? false : idlBoolean(rawPartitioned);
			const rawPath = dict.path;
			const path = rawPath === undefined ? "/" : idlUSVString(rawPath);

			const init: WriteInit = {
				...expired,
				name,
				domain,
				path,
				partitioned,
			};
			const cookie = serialize(init);

			return cookie === null ? super.delete(nativeInit(init)) : commit(cookie);
		}
	});
}

/**
 * An absolute expiry as a Max-Age. The jar is fed Set-Cookie text, and Max-Age
 * is the attribute that survives without a date format — a non-positive one is
 * already its signal to drop the cookie, which is what a past expiry means.
 */
function toMaxAge(expires: number): number {
	const seconds = (expires - _Date.now()) / 1000;
	if (seconds <= 0) return 0;

	// truncating a sub-second expiry to 0 would read as a deletion
	return seconds < 1 ? 1 : Math_trunc(seconds);
}
