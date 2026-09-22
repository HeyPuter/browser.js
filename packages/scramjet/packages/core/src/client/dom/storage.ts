import { ScramjetClient } from "@client/index";
import {
	Object_keys,
	Reflect_get,
	Reflect_ownKeys,
	String_startsWith,
	String_substring,
} from "@/shared/snapshot";

export default function (client: ScramjetClient, self: Self) {
	// `scopeUrl.host` rather than `url.host`: an about:blank frame's storage area is
	// its creator's, and its own URL has no host to key on - so every one of
	// them on every site would otherwise share the single "" namespace, which is
	// a cross-site read and write of both storage areas.
	//
	// TODO: this is a host, so `http://x` and `https://x` still share an area
	// where a browser gives them one each. Keying on the whole origin is the
	// fix and it invalidates everything already stored, so it wants doing
	// deliberately rather than as a side effect of this.
	//
	// The full separator, never the bare host. `startsWith(host)` also matches
	// another site's keys whenever one host is a prefix of the other -
	// "a.com" against "a.com.evil@secret" - and every one of them then had
	// `host.length + 1` characters chopped off and was handed over as this
	// site's own. The "@" is what makes the boundary unambiguous, because a
	// host cannot contain one.
	const prefix = () => client.scopeUrl.host + "@";

	/** This site's keys, as they are stored - namespace included. */
	const scopedKeys = (target: Storage) => {
		const scope = prefix();

		return Object_keys(target).filter((key) => String_startsWith(key, scope));
	};

	const handler: ProxyHandler<Storage> = {
		get(target, prop) {
			switch (prop) {
				case "getItem":
					return (key: string) => {
						return target.getItem(prefix() + key);
					};

				case "setItem":
					return (key: string, value: string) => {
						return target.setItem(prefix() + key, value);
					};

				case "removeItem":
					return (key: string) => {
						return target.removeItem(prefix() + key);
					};

				case "clear":
					return () => {
						// `for...in` over `Object_keys(target)` walked the *indices*
						// of the returned array - "0", "1", ... - none of which
						// start with the namespace, so `clear()` removed nothing
						// and silently left every entry in place.
						// `Object_keys` snapshots, so removing while iterating is
						// safe
						for (const key of scopedKeys(target)) {
							target.removeItem(key);
						}
					};

				case "key":
					return (index: number) => {
						// the *name*, not the value, and with the namespace taken
						// off - this is what a page iterating
						// `localStorage.key(i)` and feeding the result back to
						// `getItem` needs. Out of range is null, not undefined
						const keys = scopedKeys(target);
						if (index < 0 || index >= keys.length) return null;

						return String_substring(keys[index], prefix().length);
					};

				case "length":
					return scopedKeys(target).length;

				default:
					if (prop in Object.prototype || typeof prop === "symbol") {
						return Reflect_get(target, prop);
					}

					return target.getItem(prefix() + (prop as string));
			}
		},

		set(target, prop, value) {
			target.setItem(prefix() + (prop as string), value);

			return true;
		},

		has(target, prop) {
			return target.getItem(prefix() + (prop as string)) !== null;
		},

		ownKeys(target) {
			const scope = prefix();

			return Reflect_ownKeys(target)
				.filter((f) => typeof f === "string" && String_startsWith(f, scope))
				.map((f) => String_substring(f as string, scope.length));
		},

		getOwnPropertyDescriptor(target, property) {
			// TODO: probably not right
			if (target.getItem(prefix() + (property as string)) === null) {
				return undefined;
			}

			return {
				value: target.getItem(prefix() + (property as string)),
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			target.setItem(prefix() + (property as string), attributes.value);

			return true;
		},
	};

	const localStorageProxy = new Proxy(self.localStorage, handler);
	const sessionStorageProxy = new Proxy(self.sessionStorage, handler);

	delete self.localStorage;
	delete self.sessionStorage;

	self.localStorage = localStorageProxy;
	self.sessionStorage = sessionStorageProxy;
}
