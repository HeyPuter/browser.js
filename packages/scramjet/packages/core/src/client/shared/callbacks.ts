import { ScramjetClient } from "@client/index";
import { Object_create, Reflect_get, _WeakMap } from "@/shared/snapshot";
import { incumbencyMode } from "@/shared/incumbency";
import {
	backupIncumbencyMode,
	backupIncumbentCallback,
	callWithBackupIncumbent,
	incumbentFor,
	proxyDepth,
} from "./incumbency";
import {
	CALLBACK_DICTIONARIES,
	CALLBACK_MEMBERS,
	type CallbackEntry,
} from "@client/callbacks.generated";

/**
 * `backupIncumbency: "full"`: capture the incumbent in every Web IDL member
 * that converts a callback, and run the callback with it pushed.
 *
 * https://webidl.spec.whatwg.org/#js-callback-function
 * https://webidl.spec.whatwg.org/#js-callback-interface
 *
 *   An ECMAScript value V is converted to an IDL callback function type value
 *   by [...] returning the IDL callback function type value that represents a
 *   reference to the same object that V represents, with the incumbent
 *   settings object as the callback context.
 *
 * and "call a user object's operation" / "invoke a callback function" run it
 * under "prepare to run a callback" with that callback context, which pushes
 * it onto the backup incumbent settings object stack. The members are every
 * one the IDL declares - `callbacks.generated.ts`, expanded at build time - so
 * the capture happens in the binding the page actually called, whatever that
 * is.
 *
 * What a member converts is patched with a stand-in that pushes the entry;
 * what hands a callback back - an `on*` getter, `TreeWalker.filter` - answers
 * with the page's own. A member some other module already intercepts is left
 * to it: those - `setTimeout`, `addEventListener`, the `on*` handlers
 * `event.ts` rewrites events for - capture the incumbent themselves.
 *
 * Promise reactions are not callbacks here, and deliberately. HTML has
 * HostMakeJobCallback record the incumbent when `then` is called, but
 * Chromium runs a reaction under the handler's own realm instead - for a
 * bound native, its target's. That is the answer an empty stack already gives
 * (the realm whose member is running), so the reaction is left alone to match
 * the browser rather than the spec.
 */
export const enabled = (client: ScramjetClient) => {
	const mode = incumbencyMode(client.context, client.url);

	return mode !== "none" && backupIncumbencyMode(client) === "full";
};

/** after every module that intercepts a callback member of its own */
export const order = 1000;

export default function (client: ScramjetClient, self: Self) {
	const box = client.box;
	const global = self as any;

	/** a stand-in for a callback interface value that is not callable */
	const objectStandIn = (
		incumbent: ScramjetClient,
		value: object,
		operation: string
	) => {
		const standIn = {
			// https://webidl.spec.whatwg.org/#call-a-user-objects-operation -
			// looked up on every call, not once here
			[operation]: function (...args: any[]) {
				return callWithBackupIncumbent(
					client,
					incumbent,
					Reflect_get(value, operation),
					value,
					args
				);
			},
		};
		box.callbackOriginals.set(standIn, value);

		return standIn;
	};

	/** `value` as the host should be handed it, for one argument shape */
	const convert = (
		shape: string,
		value: any,
		incumbent: ScramjetClient
	): any => {
		// `fd`: a union of a callback and a dictionary, where a function is the
		// callback. A dictionary alone takes a function as a callable one
		const union = shape[0] === "f" && shape[1] === "d";

		if (typeof value === "function") {
			if (shape[0] === "d") return dictionary(shape.slice(2), value, incumbent);

			return backupIncumbentCallback(client, incumbent, value);
		}
		if (typeof value !== "object" || value === null) return value;

		if (shape[0] === "i")
			return objectStandIn(incumbent, value, shape.slice(2));
		if (shape[0] === "d") return dictionary(shape.slice(2), value, incumbent);
		if (union) return dictionary(shape.slice(3), value, incumbent);

		return value;
	};

	/**
	 * A copy of the dictionary `value`, with its callback members converted.
	 *
	 * Every member is read once, in the order Web IDL converts them - the
	 * generated list is already in it - so the page's getters run as they
	 * would natively, and the native reads the copy's plain data instead.
	 * https://webidl.spec.whatwg.org/#es-dictionary
	 */
	const dictionary = (
		name: string,
		value: object,
		incumbent: ScramjetClient
	) => {
		const members = CALLBACK_DICTIONARIES[name];
		// no prototype, so a setter the page put on `Object.prototype` under a
		// member's name is not handed the stand-in in place of the copy getting it
		const copy: Record<string, unknown> = Object_create(null);

		// indexed rather than destructured, here and below: this runs on every
		// call, long after the page could have replaced the array iterator
		for (let i = 0; i < members.length; i++) {
			const key = members[i][0];
			const shape = members[i][1];
			const member = Reflect_get(value, key);
			if (member === undefined) continue;

			copy[key] = shape ? convert(shape, member, incumbent) : member;
		}

		return copy;
	};

	/** the stand-in registered for `callback` on `receiver`, for a listener pair */
	const registration = (
		receiver: any,
		callback: object,
		create: () => object
	) => {
		let byCallback = box.callbackRegistrations.get(receiver);
		if (!byCallback) {
			byCallback = new _WeakMap();
			box.callbackRegistrations.set(receiver, byCallback);
		}

		let standIn = byCallback.get(callback);
		if (!standIn) {
			standIn = create();
			byCallback.set(callback, standIn);
		}

		return standIn;
	};

	const convertArguments = (
		entry: CallbackEntry,
		receiver: any,
		args: any[],
		incumbent: ScramjetClient | null
	) => {
		const positions = entry[4];
		const reg = entry[5];

		for (let i = 0; i < positions.length; i++) {
			const index = positions[i][0];
			const shape = positions[i][1];
			if (index >= args.length) continue;

			const value = args[index];
			if (
				typeof value !== "function" &&
				(typeof value !== "object" || value === null)
			)
				continue;

			if (reg === "remove") {
				const standIn = box.callbackRegistrations.get(receiver)?.get(value);
				if (standIn) args[index] = standIn;
				continue;
			}
			if (!incumbent) continue;

			// a receiver that is not an object is the native's to reject
			const registers =
				reg === "add" &&
				receiver !== null &&
				(typeof receiver === "object" || typeof receiver === "function");
			args[index] = registers
				? registration(receiver, value, () => convert(shape, value, incumbent))
				: convert(shape, value, incumbent);
		}
	};

	/** the page's own callback for whatever a getter is handing back */
	const unwrap = (value: any) =>
		(value !== null &&
			(typeof value === "object" || typeof value === "function") &&
			box.callbackOriginals.get(value)) ||
		value;

	for (let i = 0; i < CALLBACK_MEMBERS.length; i++) {
		const entry = CALLBACK_MEMBERS[i];
		const [iface, isGlobal, member, kind, args] = entry;

		const object = global[iface];
		// a [Global] interface's members live on the global itself - or up its
		// prototype chain, which `RawProxy` walks - and only when this realm is
		// one of that interface's
		if (isGlobal) {
			if (typeof object !== "function" || !box.instanceof(self, iface))
				continue;
		} else if (
			typeof object !== "function" &&
			(typeof object !== "object" || object === null)
		) {
			continue;
		}

		const debugname = `${iface}.${member}`;

		if (kind === "c") {
			if (client.isPatched(global, iface)) continue;

			client.ProxyInterfaceObject(iface, {
				construct(ctx) {
					const incumbent = incumbentFor(client, proxyDepth(client));
					// the argument list is the one the proxy's trap was handed,
					// which the engine builds in this realm, not the page's
					// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
					convertArguments(entry, null, ctx.args, incumbent);
				},
			});
			continue;
		}

		const target = isGlobal ? self : kind === "s" ? object : object.prototype;
		if (!target || client.isPatched(target, member)) continue;

		if (kind === "o" || kind === "s") {
			client.RawProxy(
				target,
				member,
				{
					apply(ctx) {
						// before anything is converted: a dictionary's getters are
						// page code, and a call they make is not this one's caller
						const incumbent =
							entry[5] === "remove"
								? null
								: incumbentFor(client, proxyDepth(client));
						// as for a constructor: the trap's own argument list
						// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
						convertArguments(entry, ctx.this, ctx.args, incumbent);
					},
				},
				debugname
			);
			continue;
		}

		const shape = args[0][1];
		client.RawTrap(
			target,
			member,
			kind === "a"
				? {
						get(ctx) {
							return unwrap(ctx.get());
						},
						set(ctx, value) {
							const incumbent = incumbentFor(client, proxyDepth(client));
							ctx.set(incumbent ? convert(shape, value, incumbent) : value);
						},
					}
				: {
						get(ctx) {
							return unwrap(ctx.get());
						},
					},
			debugname
		);
	}
}
