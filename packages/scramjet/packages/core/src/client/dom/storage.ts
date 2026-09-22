import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import {
	Object_getPrototypeOf,
	Object_keys,
	Reflect_defineProperty,
	Reflect_deleteProperty,
	Reflect_get,
	Reflect_getOwnPropertyDescriptor,
	Reflect_ownKeys,
	Reflect_set,
	String_startsWith,
	String_substring,
	_Set,
	_WeakMap,
} from "@/shared/snapshot";

export const enabled = (_client: ScramjetClient, self: Self) =>
	"Storage" in self && "localStorage" in self;

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

	/**
	 * The real storage area behind a receiver.
	 *
	 * The page never holds one directly - it holds the wrapper below - and the
	 * native members brand-check, so a wrapper has to be mapped back before it
	 * is handed to one. Anything else is passed through untouched so that the
	 * native raises its own "Illegal invocation".
	 */
	const areaOf = (that: any): any => client.box.unproxy.get(that) ?? that;

	/** This site's keys, as they are stored - namespace included. */
	const scopedKeys = (area: Storage) => {
		const scope = prefix();

		return Object_keys(area).filter((key) => String_startsWith(key, scope));
	};

	// https://html.spec.whatwg.org/multipage/webstorage.html#the-storage-interface
	//
	// The members live on `Storage.prototype` because that is where a browser
	// keeps them. They used to be minted by the wrapper's `get` trap instead,
	// one fresh arrow per read, which is three separate tells at once:
	// `localStorage.getItem !== localStorage.getItem`, a `name` of "", and a
	// `Function.prototype.toString` that renders scramjet's own source - naming
	// `scopeUrl` in it. Installed here they are ordinary intercepted members,
	// indistinguishable from every other one.
	/* eslint-disable scramjet-core/intercept-brand-check --
	   Every member reaches the native through `new client.native.Storage(
	   areaOf(this))`. `areaOf` maps the wrapper the page holds back to the real
	   area and passes anything else straight through, so a receiver that is not
	   a Storage still reaches the native and still gets its "Illegal
	   invocation" - the rule just cannot see a receiver that went through a
	   helper, because it only recognises a literal `this` as the argument. */
	client.Intercept(class extends Storage {
		@Type("unsigned long")
		get length(): number {
			const area = areaOf(this);
			// reached on every path, so a receiver that is not a Storage gets
			// the native's own "Illegal invocation" rather than a count
			void new client.native.Storage(area).length;

			return scopedKeys(area).length;
		}

		@Arguments("unsigned long")
		@Returns("DOMString?")
		key(index: number): string | null {
			const area = areaOf(this);
			// the *name*, not the value, and with the namespace taken off -
			// this is what a page iterating `localStorage.key(i)` and feeding
			// the result back to `getItem` needs. Out of range is null
			const keys = scopedKeys(area);
			if (index < 0 || index >= keys.length) {
				// reached on every path, so a receiver that is not a Storage
				// gets the native's own error rather than a null
				void new client.native.Storage(area).length;

				return null;
			}

			return String_substring(keys[index], prefix().length);
		}

		@Arguments("DOMString")
		@Returns("DOMString?")
		getItem(key: string): string | null {
			return new client.native.Storage(areaOf(this)).getItem(prefix() + key);
		}

		@Arguments("DOMString", "DOMString")
		@Returns("undefined")
		setItem(key: string, value: string): void {
			new client.native.Storage(areaOf(this)).setItem(prefix() + key, value);
		}

		@Arguments("DOMString")
		@Returns("undefined")
		removeItem(key: string): void {
			new client.native.Storage(areaOf(this)).removeItem(prefix() + key);
		}

		@Arguments()
		@Returns("undefined")
		clear(): void {
			const area = areaOf(this);
			const nArea = new client.native.Storage(area);

			// `for...in` over `Object_keys(area)` walked the *indices* of the
			// returned array - "0", "1", ... - none of which start with the
			// namespace, so `clear()` removed nothing and silently left every
			// entry in place. `Object_keys` snapshots, so removing while
			// iterating is safe
			for (const key of scopedKeys(area)) {
				nArea.removeItem(key);
			}
		}
	});
	/* eslint-enable scramjet-core/intercept-brand-check */

	/**
	 * Whether `prop` is a member of the interface rather than a stored item.
	 *
	 * `Storage` has no `[LegacyOverrideBuiltIns]`, so a named property never
	 * shadows a built-in: `localStorage.getItem` is the method even when an
	 * item of that name exists. Taken from the prototype chain once, so the
	 * list cannot drift.
	 */
	const memberNames = new _Set<string>();
	for (
		let proto = self.Storage.prototype as any;
		proto;
		proto = Object_getPrototypeOf(proto)
	) {
		const keys = Reflect_ownKeys(proto);
		for (let i = 0; i < keys.length; i++) {
			if (typeof keys[i] === "string") memberNames.add(keys[i] as string);
		}
	}

	const isMember = (prop: string | symbol): boolean =>
		typeof prop === "symbol" || memberNames.has(prop);

	const item = (area: Storage, prop: string): string | null =>
		new client.native.Storage(area).getItem(prefix() + prop);

	/**
	 * The named-property half of `Storage`, which has no prototype member to
	 * intercept: `localStorage.foo` is the item "foo".
	 */
	const handler: ProxyHandler<Storage> = {
		get(target, prop) {
			if (isMember(prop)) return Reflect_get(target, prop);

			return item(target, prop as string);
		},

		set(target, prop, value) {
			if (isMember(prop)) return Reflect_set(target, prop, value);

			new client.native.Storage(target).setItem(
				prefix() + (prop as string),
				value
			);

			return true;
		},

		has(target, prop) {
			if (isMember(prop)) return prop in target;

			return item(target, prop as string) !== null;
		},

		deleteProperty(target, prop) {
			// `Storage` has a deleter, so `delete localStorage.x` removes the
			// item. Without this the delete went to the *unscoped* key, which
			// never exists, so it answered true and removed nothing
			if (isMember(prop)) return Reflect_deleteProperty(target, prop);

			new client.native.Storage(target).removeItem(prefix() + (prop as string));

			return true;
		},

		ownKeys(target) {
			const scope = prefix();
			const keys: string[] = [];
			const own = Reflect_ownKeys(target);

			for (let i = 0; i < own.length; i++) {
				const key = own[i];
				if (typeof key !== "string" || !String_startsWith(key, scope)) continue;
				keys[keys.length] = String_substring(key, scope.length);
			}

			return keys;
		},

		getOwnPropertyDescriptor(target, property) {
			if (isMember(property)) {
				return Reflect_getOwnPropertyDescriptor(target, property);
			}

			const value = item(target, property as string);
			if (value === null) return undefined;

			return {
				value,
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			if (!("value" in attributes)) {
				return Reflect_defineProperty(target, property, attributes);
			}

			new client.native.Storage(target).setItem(
				prefix() + (property as string),
				attributes.value
			);

			return true;
		},
	};

	/**
	 * One wrapper per area, minted on the first read and kept.
	 *
	 * `localStorage === localStorage` has to hold, and the wrapper also has to
	 * be findable from a receiver - see {@link areaOf} - which is what the
	 * `unproxy` entry is for.
	 */
	const wrappers = new _WeakMap<Storage, Storage>();
	const wrap = (area: Storage): Storage => {
		const existing = wrappers.get(area);
		if (existing) return existing;

		const proxy = new Proxy(area, handler);
		wrappers.set(area, proxy);
		client.box.unproxy.set(proxy, area);

		return proxy;
	};

	// Through `Trap`, not `delete self.localStorage` followed by an
	// assignment. That turned a readonly attribute into a data property - so
	// `Object.getOwnPropertyDescriptor(window, "localStorage").get` was
	// undefined where a browser has a getter - and the `delete` moved the key
	// to the end of the window's own key order, which is observable through
	// `Object.getOwnPropertyNames`. `ctx.get()` also keeps the native's brand
	// check and its SecurityError for a document that may not use storage.
	client.Trap(["localStorage", "sessionStorage"], {
		get(ctx) {
			return wrap(ctx.get() as Storage);
		},
	});
}
