/**
 * A record of what a client changed about a realm's built-ins, which can undo
 * exactly that.
 *
 * Only needed for a realm hooked from outside - an initial about:blank that
 * `hookSubcontext` reached through `window.open` or `contentWindow`. When such
 * a window commits a same-origin document, the browser keeps its Window and
 * its realm, and the client installed by the other realm's code would stay on
 * it for good. Every interceptor would then be a function belonging to that
 * other realm, and Chrome drops the jobs and callbacks of a realm whose
 * document is gone: once the opener navigates away, an `await` inside the
 * popup's `fetch` never resumes, and wrapped listeners and timers never fire.
 * Undoing the hooks lets the document's own copy of scramjet hook the realm
 * instead.
 *
 * https://html.spec.whatwg.org/multipage/document-lifecycle.html#initialise-the-document-object
 */

import {
	Object_getOwnPropertyDescriptors,
	Object_getOwnPropertyDescriptor,
	Object_getPrototypeOf,
	Object_setPrototypeOf,
	Object_defineProperty,
	Object_hasOwn,
	Reflect_ownKeys,
	Reflect_deleteProperty,
	_Set,
	drain,
} from "@/shared/snapshot";

type Shape = {
	proto: object | null;
	descriptors: Record<string | symbol, PropertyDescriptor>;
};

type Entry = {
	object: object;
	before: Shape;
	after: Shape | null;
};

const shapeOf = (object: object): Shape => ({
	proto: Object_getPrototypeOf(object),
	descriptors: Object_getOwnPropertyDescriptors(object),
});

export class RealmSnapshot {
	private entries: Entry[] = [];

	/**
	 * Taken before the client touches anything. Everything a client installs
	 * through is reachable from the global in a few steps: a member of the
	 * global or of an object on its prototype chain (`fetch`,
	 * `Error.prepareStackTrace`), a member of a constructor's prototype chain
	 * (`Navigator.prototype.serviceWorker`), or a member of a namespace's
	 * constructor (`WebAssembly.Module.prototype`). Data properties only: a
	 * getter like `document` is never run, and what it returns belongs to the
	 * document being replaced anyway.
	 */
	constructor(global: object) {
		const seen = new _Set<object>();
		const entries = this.entries;
		const add = (object: unknown) => {
			if (
				(typeof object !== "object" && typeof object !== "function") ||
				object === null ||
				seen.has(object)
			)
				return false;
			seen.add(object);
			entries[entries.length] = {
				object,
				before: shapeOf(object),
				after: null,
			};

			return true;
		};
		const addChain = (object: unknown) => {
			while (add(object)) object = Object_getPrototypeOf(object);
		};
		const valuesOf = (object: object) => {
			const out: unknown[] = [];
			for (const key of drain(Reflect_ownKeys(object))) {
				const desc = Object_getOwnPropertyDescriptor(object, key);
				if (desc && "value" in desc) out[out.length] = desc.value;
			}

			return out;
		};
		const addMember = (value: unknown) => {
			addChain(value);
			if (typeof value === "function" && Object_hasOwn(value, "prototype"))
				addChain((value as any).prototype);
		};

		const scopes: object[] = [];
		for (let o: object | null = global; o; o = Object_getPrototypeOf(o))
			scopes[scopes.length] = o;
		addChain(global);
		for (const scope of drain(scopes)) {
			for (const value of drain(valuesOf(scope))) {
				const namespace =
					typeof value === "object" && value !== null && !seen.has(value);
				addMember(value);
				if (namespace)
					for (const inner of drain(valuesOf(value as object)))
						addMember(inner);
			}
		}
	}

	/** Taken once the client has finished hooking. */
	seal() {
		for (const entry of drain(this.entries))
			entry.after = shapeOf(entry.object);
	}

	/**
	 * Undo the client's changes. A member is put back only where it still
	 * holds what the client left there: anything a page has defined, replaced
	 * or deleted since is the page's own state, which a reused Window keeps.
	 */
	restore() {
		for (const { object, before, after } of drain(this.entries)) {
			if (!after) continue;

			const keys = Reflect_ownKeys(before.descriptors);
			for (const key of drain(Reflect_ownKeys(after.descriptors)))
				if (!Object_hasOwn(before.descriptors, key)) keys[keys.length] = key;

			for (const key of drain(keys)) {
				const was = own(before.descriptors, key);
				const hooked = own(after.descriptors, key);
				if (sameDescriptor(was, hooked)) continue;
				if (
					!sameDescriptor(Object_getOwnPropertyDescriptor(object, key), hooked)
				)
					continue;

				try {
					if (was) Object_defineProperty(object, key, was);
					else Reflect_deleteProperty(object, key);
				} catch {
					// non-configurable, so the client could not have changed it either
				}
			}

			if (
				before.proto !== after.proto &&
				Object_getPrototypeOf(object) === after.proto
			) {
				try {
					Object_setPrototypeOf(object, before.proto);
				} catch {
					// an immutable prototype exotic object
				}
			}
		}
	}
}

function own(
	descriptors: Record<string | symbol, PropertyDescriptor>,
	key: string | symbol
): PropertyDescriptor | undefined {
	return Object_hasOwn(descriptors, key) ? descriptors[key as any] : undefined;
}

function sameDescriptor(
	a: PropertyDescriptor | undefined,
	b: PropertyDescriptor | undefined
) {
	if (!a || !b) return a === b;

	return (
		a.value === b.value &&
		a.get === b.get &&
		a.set === b.set &&
		a.writable === b.writable &&
		a.enumerable === b.enumerable &&
		a.configurable === b.configurable
	);
}
