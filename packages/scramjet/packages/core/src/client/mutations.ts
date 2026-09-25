/**
 * The mutation layer: what a MutationObserver is allowed to see.
 *
 * The attribute and text layers keep scramjet's own state in the document -
 * the `scramjet-attr-*` mirror of every rewritten attribute, the script source
 * attribute, the rewritten program in a script's first Text child, the probe
 * node that re-prepares a connected script - and every one of those writes is
 * a DOM mutation. An observer would get records under internal names, old
 * values carrying proxy URLs and rewritten code, and records for changes the
 * page never made; an observer that re-applies a style from its callback
 * would never settle.
 *
 * Two mechanisms, for two costs:
 *
 *   - Attribute records are fixed up at delivery, in {@link present}. Every
 *     write to a rewritten attribute is its mirror's write and the real
 *     attribute's, back to back in every observer's queue, so the pair is
 *     folded into the one record the page made - under the page's name, with
 *     the old value out of the mirror. Nothing is done on the write path,
 *     which is every `img.src` and every CSSOM write in an animation loop.
 *   - The text layer's writes are rare, and there is nothing left in its
 *     records to recover the page's view from - the rewritten whole lands in a
 *     node the page may not even have touched. So its internal writes are
 *     *hidden*: every observer's queue is emptied into the page's queue
 *     before the write and whatever the write added is thrown away after it
 *     ({@link hide}). The record the page is owed is then made for real, by
 *     a zero-length write to the node the page changed ({@link echo}), and
 *     handed the page's old value.
 *
 * Records taken out of an observer's native queue leave it empty, and the
 * browser does not call back an observer with nothing queued. So each
 * observer also watches a detached Text node of its own, which is written -
 * {@link wake} - whenever its records are held here. That queues the
 * observer in the browser's own mutation observer microtask, in its own
 * place among the others, exactly when the page's change would have; the
 * wake record is dropped again on delivery.
 *
 * Shared by every client in the box: a node can be observed from another
 * frame, and a write in this one has to be hidden from that observer too.
 *
 * https://dom.spec.whatwg.org/#mutation-observers
 */

import type { ScramjetClient } from "@client/index";
import {
	isInternalAttribute,
	localPart,
	mirroredAttributeName,
	XLINK_NAMESPACE,
} from "@client/attributes";
import { unrewriteCss } from "@rewriters/css";
import {
	Array_of,
	Reflect_apply,
	String_indexOf,
	String_startsWith,
	WeakRef_deref,
	_WeakMap,
	_WeakRef,
} from "@/shared/snapshot";

/** What the layer keeps for one observer the page constructed. */
export type ObserverState = {
	observer: MutationObserver;
	/** the page's callback, which the native never sees */
	callback: (...args: any[]) => any;
	/** the client whose constructor made it, whose natives it is read with */
	client: ScramjetClient;
	/** the realm the page's callback belongs to, which its records array is made in */
	callbackClient: ScramjetClient;
	/** records taken out of the native queue, oldest first, not yet delivered */
	pending: MutationRecord[];
	/** the detached node only this observer watches - see {@link MutationLayer.wake} */
	wake: CharacterData;
	/** whether it has a registration, and so is in the layer's registry */
	observing: boolean;
};

/** The native `MutationRecord` getters, which see past the layer's overrides. */
type RecordNatives = {
	type: (record: MutationRecord) => string;
	target: (record: MutationRecord) => Node;
	name: (record: MutationRecord) => string | null;
	namespace: (record: MutationRecord) => string | null;
	oldValue: (record: MutationRecord) => string | null;
	added: (record: MutationRecord) => NodeList;
	removed: (record: MutationRecord) => NodeList;
};

export class MutationLayer {
	/** keyed by the observer the page holds */
	private readonly states = new _WeakMap<MutationObserver, ObserverState>();
	/**
	 * Every observer with a registration, in the order it first observed. Held
	 * weakly: the browser keeps an observer alive through the nodes it
	 * observes, and a strong list here would keep one alive after they have
	 * gone, along with everything its callback closes over.
	 */
	private active: WeakRef<ObserverState>[] = [];

	/**
	 * The attribute name and old value a record answers with in place of the
	 * native's. Shared, like the records: one can be read through another
	 * frame's `MutationRecord.prototype`.
	 */
	readonly names: _WeakMap<MutationRecord, string | null> = new _WeakMap();
	readonly oldValues: _WeakMap<MutationRecord, string | null> = new _WeakMap();

	/** One client's native `MutationRecord` getters, for {@link present}. */
	private natives(client: ScramjetClient): RecordNatives {
		const d = client.nativeStore.get("MutationRecord")!;
		const get =
			(key: string) =>
			(record: MutationRecord): any =>
				Reflect_apply(d[key].get!, record, []);

		return {
			type: get("type"),
			target: get("target"),
			name: get("attributeName"),
			namespace: get("attributeNamespace"),
			oldValue: get("oldValue"),
			added: get("addedNodes"),
			removed: get("removedNodes"),
		};
	}
	private readonly nativesByClient = new _WeakMap<
		ScramjetClient,
		RecordNatives
	>();
	private recordNatives(client: ScramjetClient): RecordNatives {
		let natives = this.nativesByClient.get(client);
		if (!natives) {
			natives = this.natives(client);
			this.nativesByClient.set(client, natives);
		}

		return natives;
	}

	/** Start keeping `observer`, just constructed around the page's `callback`. */
	register(
		client: ScramjetClient,
		observer: MutationObserver,
		callback: (...args: any[]) => any,
		callbackClient: ScramjetClient
	): void {
		const wake = new client.native.Document(
			client.global.document
		).createTextNode("");
		this.states.set(observer, {
			observer,
			callback,
			client,
			callbackClient,
			pending: [],
			wake,
			observing: false,
		});
	}

	state(observer: MutationObserver): ObserverState | undefined {
		return this.states.get(observer);
	}

	/** After a successful `observe()`: it can now be handed records. */
	observed(state: ObserverState): void {
		if (state.observing) return;
		state.observing = true;
		// the wake node's registration, which `disconnect()` takes away with
		// the page's own
		new state.client.native.MutationObserver(state.observer).observe(
			state.wake,
			{ characterData: true }
		);
		this.active[this.active.length] = new _WeakRef(
			state
		) as WeakRef<ObserverState>;
	}

	/** After `disconnect()`: its queue is empty and it has no registrations. */
	disconnected(state: ObserverState): void {
		state.pending = [];
		if (!state.observing) return;
		state.observing = false;
		this.compact();
	}

	/** The observers that can currently receive records. */
	private live(): ObserverState[] {
		const out: ObserverState[] = [];
		for (let i = 0; i < this.active.length; i++) {
			const state = WeakRef_deref(this.active[i]);
			if (state && state.observing) out[out.length] = state;
		}
		if (out.length !== this.active.length) this.compact();

		return out;
	}

	private compact(): void {
		const kept: WeakRef<ObserverState>[] = [];
		for (let i = 0; i < this.active.length; i++) {
			const state = WeakRef_deref(this.active[i]);
			if (state && state.observing) kept[kept.length] = this.active[i];
		}
		this.active = kept;
	}

	private take(state: ObserverState): MutationRecord[] {
		return new state.client.native.MutationObserver(
			state.observer
		).takeRecords();
	}

	/** Move everything queued so far into the observers' own queues. */
	private flush(states: ObserverState[]): void {
		for (let i = 0; i < states.length; i++) {
			const state = states[i];
			const records = this.take(state);
			for (let j = 0; j < records.length; j++) {
				state.pending[state.pending.length] = records[j];
			}
		}
	}

	/**
	 * Queue each observer holding records here for delivery, by writing to the
	 * node only it watches. See the file comment.
	 */
	private wake(states: ObserverState[]): void {
		for (let i = 0; i < states.length; i++) {
			const state = states[i];
			if (state.pending.length === 0) continue;
			new state.client.native.CharacterData(state.wake).appendData("");
		}
	}

	/**
	 * Run `fn`, an internal write to `node`, where no observer can see it: a
	 * data write to it, or its insertion or removal. Anything else `fn` does -
	 * page code a script insertion ran - is left alone.
	 */
	hide<T>(client: ScramjetClient, node: Node, fn: () => T): T {
		const states = this.live();
		if (states.length === 0) return fn();

		this.flush(states);
		try {
			return fn();
		} finally {
			const natives = this.recordNatives(client);
			// the observers again: `fn` can run page code, and page code can
			// start observing
			const after = this.live();
			for (let i = 0; i < after.length; i++) {
				const state = after[i];
				const records = this.take(state);
				for (let j = 0; j < records.length; j++) {
					const record = records[j];
					if (this.mentions(natives, record, node)) continue;
					state.pending[state.pending.length] = record;
				}
			}
			this.wake(after);
		}
	}

	/** Whether `record` is about `node` itself. */
	private mentions(
		natives: RecordNatives,
		record: MutationRecord,
		node: Node
	): boolean {
		const type = natives.type(record);
		if (type === "characterData") return natives.target(record) === node;
		if (type !== "childList") return false;

		const added = natives.added(record);
		const removed = natives.removed(record);

		return (
			(added.length === 1 && added[0] === node) ||
			(removed.length === 1 && removed[0] === node)
		);
	}

	/**
	 * Run `fn`, internal writes nothing may see at all - no page code runs
	 * inside it.
	 */
	hideAll<T>(fn: () => T): T {
		const states = this.live();
		if (states.length === 0) return fn();

		this.flush(states);
		try {
			return fn();
		} finally {
			const after = this.live();
			for (let i = 0; i < after.length; i++) this.take(after[i]);
			this.wake(after);
		}
	}

	/**
	 * Queue the characterData record the page is owed for a change to `node`,
	 * whose data was `oldValue` as the page saw it.
	 *
	 * Made by a real zero-length write, so the browser decides which observers
	 * see it and whether they asked for an old value - which is exactly what
	 * `characterDataOldValue` and the registrations on `node` and its
	 * ancestors say. Only the old value is the layer's.
	 */
	echo(client: ScramjetClient, node: CharacterData, oldValue: string): void {
		const states = this.live();
		if (states.length === 0) return;

		this.flush(states);
		new client.native.CharacterData(node).appendData("");

		const natives = this.recordNatives(client);
		for (let i = 0; i < states.length; i++) {
			const state = states[i];
			const records = this.take(state);
			for (let j = 0; j < records.length; j++) {
				const record = records[j];
				if (
					natives.type(record) === "characterData" &&
					natives.target(record) === node &&
					natives.oldValue(record) !== null
				) {
					this.oldValues.set(record, oldValue);
				}
				state.pending[state.pending.length] = record;
			}
		}
		this.wake(states);
	}

	/**
	 * The records `state`'s page callback or `takeRecords()` gets: its held
	 * records, then `native`, with scramjet's own taken out and the rest
	 * shown as the page made them - in an array of `realm`'s.
	 */
	present(
		state: ObserverState,
		native: MutationRecord[],
		realm: ScramjetClient
	): MutationRecord[] {
		const all = state.pending;
		state.pending = [];
		for (let i = 0; i < native.length; i++) all[all.length] = native[i];

		const natives = this.recordNatives(state.client);
		const out: MutationRecord[] = [];
		for (let i = 0; i < all.length; i++) {
			const record = all[i];
			const type = natives.type(record);

			if (type === "characterData") {
				if (natives.target(record) !== state.wake) out[out.length] = record;
				continue;
			}
			if (type !== "attributes") {
				out[out.length] = record;
				continue;
			}

			const name = natives.name(record)!;
			const mirrored =
				natives.namespace(record) === null ? mirroredAttributeName(name) : null;
			const next = i + 1 < all.length ? all[i + 1] : null;

			// internal, and standing in for nothing: the script source
			if (mirrored === "") continue;

			if (mirrored !== null) {
				// a mirror, and the real attribute's write right behind it: the
				// one change the page made, under its own name already
				if (next && this.halves(natives, next, record, mirrored)) {
					this.fold(state, natives, next, natives.oldValue(record));
					out[out.length] = next;
					i++;
					continue;
				}

				// a mirror on its own is an attribute its rule strips - the
				// document holds nothing else of it
				this.names.set(record, mirrored);
				out[out.length] = record;
				continue;
			}

			// the real attribute first, its mirror after: a CSSOM write, which
			// brings the `style` mirror into line once the engine has written
			if (next && natives.type(next) === "attributes") {
				const nextName = natives.name(next)!;
				const nextMirrored =
					natives.namespace(next) === null
						? mirroredAttributeName(nextName)
						: null;
				if (nextMirrored && this.halves(natives, record, next, nextMirrored)) {
					this.fold(state, natives, record, natives.oldValue(next));
					out[out.length] = record;
					i++;
					continue;
				}
			}

			// no mirror write: an ordinary attribute, or a rewritten one the
			// document changed without one
			const old = natives.oldValue(record);
			if (old !== null) {
				const visible = this.unrewrite(state.client, name, old);
				if (visible !== old) this.oldValues.set(record, visible);
			}
			out[out.length] = record;
		}

		return Reflect_apply(
			Array_of,
			realm.nativeStore.get("window")!.Array.value,
			out
		);
	}

	/** Whether `real` is the write to the attribute the mirror `mirror` keeps. */
	private halves(
		natives: RecordNatives,
		real: MutationRecord,
		mirror: MutationRecord,
		mirrored: string
	): boolean {
		if (natives.type(real) !== "attributes") return false;
		if (natives.target(real) !== natives.target(mirror)) return false;

		const name = natives.name(real)!;
		const namespace = natives.namespace(real);
		if (namespace === null)
			return !isInternalAttribute(name) && name === mirrored;

		// a mirror is keyed on the qualified name - `xlink:href`, or whatever
		// prefix the page chose - while the record carries the local name and
		// the namespace
		return (
			namespace === XLINK_NAMESPACE &&
			String_indexOf(mirrored, ":") !== -1 &&
			localPart(mirrored) === name
		);
	}

	/**
	 * Give `real` the old value the page is owed: the mirror's, or - where
	 * there was no mirror to hold one - its own, unrewritten.
	 */
	private fold(
		state: ObserverState,
		natives: RecordNatives,
		real: MutationRecord,
		mirrorOld: string | null
	): void {
		const old = natives.oldValue(real);
		if (mirrorOld !== null) {
			if (mirrorOld !== old) this.oldValues.set(real, mirrorOld);

			return;
		}
		if (old === null) return;

		const visible = this.unrewrite(state.client, natives.name(real)!, old);
		if (visible !== old) this.oldValues.set(real, visible);
	}

	/** A rewritten attribute value, as close to the page's as it can be recovered. */
	private unrewrite(client: ScramjetClient, name: string, value: string) {
		if (name === "style") return unrewriteCss(value, client.context);
		if (String_startsWith(value, client.context.prefix.href)) {
			return client.unrewriteUrl(value);
		}

		return value;
	}
}
