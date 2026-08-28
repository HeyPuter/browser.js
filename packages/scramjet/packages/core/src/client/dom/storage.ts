import { ScramjetClient } from "@client/index";
import { Object_keys, Reflect_get, Reflect_ownKeys } from "@/shared/snapshot";

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
	const handler: ProxyHandler<Storage> = {
		get(target, prop) {
			switch (prop) {
				case "getItem":
					return (key: string) => {
						return target.getItem(client.scopeUrl.host + "@" + key);
					};

				case "setItem":
					return (key: string, value: string) => {
						return target.setItem(client.scopeUrl.host + "@" + key, value);
					};

				case "removeItem":
					return (key: string) => {
						return target.removeItem(client.scopeUrl.host + "@" + key);
					};

				case "clear":
					return () => {
						for (const key in Object_keys(target)) {
							if (key.startsWith(client.scopeUrl.host)) {
								target.removeItem(key);
							}
						}
					};

				case "key":
					return (index: number) => {
						const keys = Object_keys(target).filter((key) =>
							key.startsWith(client.scopeUrl.host)
						);

						return target.getItem(keys[index]);
					};

				case "length":
					return Object_keys(target).filter((key) =>
						key.startsWith(client.scopeUrl.host)
					).length;

				default:
					if (prop in Object.prototype || typeof prop === "symbol") {
						return Reflect_get(target, prop);
					}

					return target.getItem(client.scopeUrl.host + "@" + (prop as string));
			}
		},

		set(target, prop, value) {
			target.setItem(client.scopeUrl.host + "@" + (prop as string), value);

			return true;
		},

		has(target, prop) {
			return (
				target.getItem(client.scopeUrl.host + "@" + (prop as string)) !== null
			);
		},

		ownKeys(target) {
			return Reflect_ownKeys(target)
				.filter(
					(f) => typeof f === "string" && f.startsWith(client.scopeUrl.host)
				)
				.map((f) =>
					typeof f === "string"
						? f.substring(client.scopeUrl.host.length + 1)
						: f
				);
		},

		getOwnPropertyDescriptor(target, property) {
			// TODO: probably not right
			if (
				target.getItem(client.scopeUrl.host + "@" + (property as string)) ===
				null
			) {
				return undefined;
			}

			return {
				value: target.getItem(
					client.scopeUrl.host + "@" + (property as string)
				),
				enumerable: true,
				configurable: true,
				writable: true,
			};
		},

		defineProperty(target, property, attributes) {
			target.setItem(
				client.scopeUrl.host + "@" + (property as string),
				attributes.value
			);

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
