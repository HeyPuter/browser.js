/**
 * `MutationObserver` and `MutationRecord`, over the mutation layer
 * (`client/mutations.ts`, `client.box.mutations`), which decides what an
 * observer sees of scramjet's own writes to the document.
 *
 * https://dom.spec.whatwg.org/#interface-mutationobserver
 */

import { ScramjetClient } from "@client/index";
import {
	Arguments,
	Constructor,
	Returns,
	Type,
	idlDOMString,
} from "@client/webidl";
import { isInternalAttribute, mirrorAttributeName } from "@client/attributes";
import {
	Array_isArray,
	Object_create,
	Object_defineProperty,
	Reflect_apply,
	Symbol_iterator,
	drain,
} from "@/shared/snapshot";

/**
 * MutationObserverInit's members, in the order WebIDL reads them.
 * https://dom.spec.whatwg.org/#dictdef-mutationobserverinit
 */
const INIT_MEMBERS = [
	"attributeFilter",
	"attributeOldValue",
	"attributes",
	"characterData",
	"characterDataOldValue",
	"childList",
	"subtree",
];

export default function (client: ScramjetClient, _self: Self) {
	const layer = client.box.mutations;

	/**
	 * The page's `attributeFilter`, as the native should have it: without
	 * scramjet's own names - an attribute the page can never write matches
	 * nothing in a browser either - and with the mirror of every name it does
	 * list, so that the mirror's half of a rewritten attribute's write, and the
	 * whole of a stripped one's, reaches {@link MutationLayer.present}.
	 *
	 * Iterated here, once, the way the native would have: the page's iterable
	 * is read exactly where and as often as it would be. Anything that is not
	 * a sequence goes to the native as it is, to be refused there.
	 */
	const widenFilter = (value: unknown): unknown => {
		if (
			(typeof value !== "object" && typeof value !== "function") ||
			value === null
		) {
			return value;
		}
		const names: string[] = [];
		const add = (entry: unknown) => {
			const name = idlDOMString(entry);
			if (isInternalAttribute(name)) return;
			names[names.length] = name;
			names[names.length] = mirrorAttributeName(name);
			// the legacy SVG spelling is mirrored under its qualified name
			names[names.length] = mirrorAttributeName("xlink:" + name);
		};

		// Blink converts a JS array by index, never asking for its iterator -
		// even one the page replaced
		if (Array_isArray(value)) {
			const list = value as unknown[];
			for (let i = 0; i < list.length; i++) add(list[i]);

			return drain(names);
		}

		const method = (value as any)[Symbol_iterator];
		if (typeof method !== "function") return value;

		const iterator: Iterator<unknown> = Reflect_apply(method, value, []);
		const next = iterator.next;
		for (;;) {
			const step: IteratorResult<unknown> = Reflect_apply(next, iterator, []);
			if (step.done) break;
			add(step.value);
		}

		// an iterable of our own, rather than an array whose iterator a page
		// may have replaced
		return drain(names);
	};

	/**
	 * What the native `observe()` is handed in place of the page's options:
	 * an object that reads each member off them as the native asks for it,
	 * once and in its own order, and widens the filter on the way through.
	 */
	const forwardInit = (options: unknown): unknown => {
		if (
			(typeof options !== "object" && typeof options !== "function") ||
			options === null
		) {
			return options;
		}

		const forwarded = Object_create(null);
		for (let i = 0; i < INIT_MEMBERS.length; i++) {
			const key = INIT_MEMBERS[i];
			Object_defineProperty(forwarded, key, {
				get:
					key === "attributeFilter"
						? () => widenFilter((options as any)[key])
						: () => (options as any)[key],
				enumerable: true,
			});
		}

		return forwarded;
	};

	client.Intercept(class extends MutationObserver {
		@Constructor("MutationCallback")
		static konstructor(callback: MutationCallback) {
			// a callback that is not one is the native's TypeError to throw
			if (typeof callback !== "function") return new this(callback);

			// what the native calls: the page's callback, with the page's records
			const deliver = (records: MutationRecord[]) => {
				const state = layer.state(observer);
				if (!state) return;
				// Blink makes the array in the callback's realm, not the
				// observer's
				const list = layer.present(state, records, state.callbackClient);
				// every record was scramjet's own, and a browser calls back an
				// observer only when something is queued for it
				if (list.length === 0) return;

				Reflect_apply(callback, observer, [list, observer]);
			};
			const observer: MutationObserver = new this(deliver);
			layer.register(
				client,
				observer,
				callback,
				client.relevantClient(callback)
			);

			return observer;
		}

		@Arguments("Node", "optional MutationObserverInit")
		@Returns("undefined")
		observe(target: Node, options?: MutationObserverInit): void {
			const state = layer.state(this);
			if (!state) return super.observe(target, options);

			super.observe(target, forwardInit(options) as MutationObserverInit);
			layer.observed(state);
		}

		@Arguments()
		@Returns("undefined")
		disconnect(): void {
			super.disconnect();
			const state = layer.state(this);
			if (state) layer.disconnected(state);
		}

		@Arguments()
		@Returns("sequence<MutationRecord>")
		takeRecords(): MutationRecord[] {
			const records = super.takeRecords();
			const state = layer.state(this);

			return state ? layer.present(state, records, client) : records;
		}
	});

	// https://dom.spec.whatwg.org/#interface-mutationrecord
	client.Intercept(class extends MutationRecord {
		@Type("DOMString?")
		get attributeName(): string | null {
			const native = super.attributeName;
			const names = layer.names;

			return names.has(this) ? names.get(this)! : native;
		}

		@Type("DOMString?")
		get oldValue(): string | null {
			const native = super.oldValue;
			const oldValues = layer.oldValues;

			return oldValues.has(this) ? oldValues.get(this)! : native;
		}
	});
}
