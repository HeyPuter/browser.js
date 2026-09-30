// The window and document proxies the `ppsc` rewriters hand the page.
//
// Those rewriters leave member accesses alone and wrap only the references to
// the window and the document themselves, so whatever is reached through one
// has to be answered here: `location`, `parent`, `top`, `eval` and the rest of
// the unsafe names, and a subframe reached by index. Natives that would reject
// a proxy as their receiver, or hand back the real object past it, are the
// unproxy layer's (`shared/unproxy.ts`).

import { iswindow } from "@client/entry";
import { SCRAMJETCLIENT } from "@/symbols";
import { ScramjetClient } from "@client/index";
import { getOwnPropertyDescriptorHandler } from "@client/helpers";
import {
	_Set,
	Number_isInteger,
	Reflect_set,
	Reflect_defineProperty,
} from "@/shared/snapshot";

/**
 * The names the proxy answers rather than reads. `get` fires on every property
 * read through the proxy, so membership is a hash lookup rather than a walk
 * over a list.
 */
const UNSAFE_GLOBALS = new _Set([
	"window",
	"self",
	"globalThis",
	"parent",
	"top",
	"location",
	"document",
	"eval",
	"frames",
]);

export function createGlobalProxy(
	client: ScramjetClient,
	self: typeof globalThis
): typeof globalThis {
	return new Proxy(self, {
		get(target, prop) {
			// `target[prop]` rather than `Reflect_get(target, prop)`: the two mean
			// exactly the same thing here, since a two argument `Reflect.get`
			// takes the target as the receiver, but the builtin does not inline
			// the way a property access does. Measured through a proxy over the
			// document: 45ns a read against 21ns, and 29ns a method lookup
			// against 18ns. This trap runs on every read the page makes through
			// the proxy, so it is most of what the design costs.
			const value = target[prop];

			// `window[0]` is a subframe's window, which has a proxy of its own.
			// `Number(prop)` on every string property doubled the cost of the
			// trap - 46ns against 20ns, where a direct read is 0.5ns - and a
			// frame index always starts with a digit.
			const first = typeof prop === "string" ? prop.charCodeAt(0) : -1;
			if (
				iswindow &&
				first >= 48 &&
				first <= 57 &&
				value &&
				Number_isInteger(+(prop as string))
			) {
				try {
					// an about:blank frame never navigated has no client yet
					if (!(SCRAMJETCLIENT in value)) client.init.hookSubcontext(value);

					return value[SCRAMJETCLIENT].globalProxy ?? value;
				} catch {
					// cross-origin, so there is no reaching into it
					return value;
				}
			}

			if (typeof prop === "string" && UNSAFE_GLOBALS.has(prop)) {
				return client.wrapfn(value);
			}

			return value;
		},

		set(target, prop, value) {
			if (prop === "location") {
				client.url = value;

				return true;
			}

			return Reflect_set(target, prop, value);
		},
		// `has` and `ownKeys` forwarded to `Reflect` unchanged, which is what a
		// missing trap does - only slower, since a declared trap takes the slow
		// path whatever it does
		defineProperty(target, property, attributes) {
			if (!attributes.get && !attributes.set) {
				attributes.writable = true;
			}
			attributes.configurable = true;

			return Reflect_defineProperty(target, property, attributes);
		},
		getOwnPropertyDescriptor: getOwnPropertyDescriptorHandler,
	});
}

export function createDocumentProxy(client: ScramjetClient, self: GlobalThis) {
	return new Proxy((self as Self).document, {
		get(target, prop) {
			if (prop === "location") return client.locationProxy;
			if (prop === "defaultView") return client.globalProxy;

			// see the note in `createGlobalProxy`
			return target[prop];
		},
		set(target, prop, newValue) {
			if (prop === "location") {
				client.url = newValue;

				return true;
			}

			return Reflect_set(target, prop, newValue);
		},
	});
}
