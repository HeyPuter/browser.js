/**
 * The name of the emulated top-level traversable.
 *
 * A proxied site's top-level document is really an iframe in its embedder -
 * the frame a `ScramjetFrame` holds, or a tab in the browser UI - and the
 * page has to see a top-level traversable's name there, not the iframe's.
 * Everything below is only for that one navigable. A subframe's name and a
 * popup's are the browser's own: nothing needs hiding, and the named
 * properties on `window` and `frames` only work off the real name.
 *
 * The real name of the frame is scramjet's: a random one, drawn the first time
 * a document loads into it, that the page never reads or writes. It is what
 * the rewritten targets in its subframes name (see `targets.ts`), so a
 * `_top` link two frames down reaches this frame and not the embedder - and
 * not a second tab beside it, which a fixed name would, because a browser
 * resolves a name to the first frame in the embedder with it.
 *
 * The name the page sees is kept separately, per session history entry, the
 * way the spec keeps it:
 *
 *   https://html.spec.whatwg.org/multipage/document-sequences.html#nav-target
 *   "A navigable's target name is its active session history entry's document
 *   state's navigable target name."
 *
 * A cross-document navigation starts the new entry off with the current name
 * (navigate, step 24), and a top-level one that changes origin clears it
 * (finalize a cross-document navigation, step 4). A traversal brings back
 * whatever name the entry it lands on had. Entries made in the same document
 * - `pushState`, a fragment - share its document state, so they share one name.
 *
 * It lives in the session storage area of the proxy's own origin, under a key
 * no site's namespace can reach (`dom/storage.ts` only ever hands a page the
 * keys under its own `origin@` prefix, and the storage event is filtered the
 * same way). Session storage is per tab, survives every navigation the frame
 * makes, and is reachable from the frame whatever origin its embedder is on -
 * the embedder's element is not, when it is cross-origin.
 */

import type { ScramjetClient } from "./client";
import {
	Array_indexOf,
	Crypto_getRandomValues,
	JSON_parse,
	JSON_stringify,
	Number_toString,
	Object_create,
	Object_hasOwn,
	Object_keys,
	Reflect_apply,
	String,
	String_startsWith,
	_Set,
	_Uint8Array,
	drain,
} from "@/shared/snapshot";

/** What every real name scramjet gives a frame starts with. */
const REAL_NAME_PREFIX = "scramjet-frame-";
const REAL_NAME_LENGTH = REAL_NAME_PREFIX.length + 24;

/** The session storage key the frame's state is kept under. No `@`, so no site's. */
const STORE_PREFIX = "scramjet frame name ";

type Store = {
	/** the name of the document state that was active last */
	name: string;
	/**
	 * the site origin of the document that was active last - null for an
	 * opaque one, absent before any document has been
	 */
	origin?: string | null;
	/** each session history entry's name, by the entry's key */
	entries: Record<string, string>;
};

function drawRealName(): string {
	const bytes = new _Uint8Array(24);
	Crypto_getRandomValues(bytes);
	let name = REAL_NAME_PREFIX;
	for (let i = 0; i < bytes.length; i++) {
		name += Number_toString(bytes[i] % 36, 36);
	}

	return name;
}

function isRealName(name: string): boolean {
	return (
		name.length === REAL_NAME_LENGTH && String_startsWith(name, REAL_NAME_PREFIX)
	);
}

export class TopFrameName {
	/** The frame's real name - what a target has to say to reach it. */
	readonly realName: string;

	/** The name the page sees: this document state's navigable target name. */
	private name: string;

	/** The session history entries this document's state belongs to. */
	private readonly entryKeys: string[] = [];

	/**
	 * Popups opened from this tree. A link in one that names this frame has to
	 * be told when this frame's name changes - see `targets.ts`.
	 */
	readonly popups: Window[] = [];

	constructor(private readonly client: ScramjetClient) {
		const nWin = new client.native.window(client.global);

		let realName: string = nWin.name;
		let store: Store | null = null;
		if (isRealName(realName)) {
			store = this.load(realName);
		} else {
			// a frame no document has loaded into yet - or one whose name the
			// embedder chose. Either way it has no name the page gave it
			realName = drawRealName();
			nWin.name = realName;
		}
		this.realName = realName;
		store ??= { name: "", entries: Object_create(null) };

		const key = this.currentEntryKey();
		if (this.navigationType() === "back_forward") {
			// a traversal is not a navigation: step 4 never runs for it, and the
			// entry comes back with the name it was left with
			this.name =
				key !== null && Object_hasOwn(store.entries, key)
					? store.entries[key]
					: store.name;
		} else {
			// https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation
			//
			//   4. If all of the following are true:
			//        - navigable's parent is null;
			//        - historyEntry's document's browsing context is not an
			//          auxiliary browsing context whose opener browsing context
			//          is non-null; and
			//        - historyEntry's document's origin is not navigable's active
			//          document's origin,
			//      then set historyEntry's document state's navigable target
			//      name to the empty string.
			//
			// The emulated top-level has no parent and is never auxiliary. An
			// opaque origin is only ever its own, so null on either side is a
			// change
			const origin = client.siteOrigin;
			const changed =
				store.origin !== undefined &&
				(origin === null || store.origin === null || origin !== store.origin);
			this.name = changed ? "" : store.name;
		}

		this.addEntryKey(key);
		this.save(store);

		this.listen();
	}

	get(): string {
		this.noteCurrentEntry();

		return this.name;
	}

	set(value: string) {
		this.noteCurrentEntry();
		if (value === this.name) return;
		this.name = value;
	}

	/** The key of the session history entry that is current, or null without the Navigation API. */
	private currentEntryKey(): string | null {
		try {
			const navigation = new this.client.native.window(this.client.global)
				.navigation;
			if (!navigation) return null;
			const entry = new this.client.native.Navigation(navigation).currentEntry;
			if (!entry) return null;

			return new this.client.native.NavigationHistoryEntry(entry).key;
		} catch {
			return null;
		}
	}

	/** Every entry made while this document is active shares its document state. */
	private noteCurrentEntry() {
		this.addEntryKey(this.currentEntryKey());
	}

	private addEntryKey(key: string | null) {
		if (key !== null && Array_indexOf(this.entryKeys, key) === -1)
			this.entryKeys[this.entryKeys.length] = key;
	}

	/** How this document was arrived at - `navigate`, `reload` or `back_forward`. */
	private navigationType(): string {
		try {
			const performance = new this.client.native.window(this.client.global)
				.performance;
			const entries = new this.client.native.Performance(
				performance
			).getEntriesByType("navigation");
			const entry = entries[0];
			if (!entry) return "navigate";

			return new this.client.native.PerformanceNavigationTiming(entry).type;
		} catch {
			return "navigate";
		}
	}

	private storage(): Storage | null {
		try {
			return new this.client.native.window(this.client.global).sessionStorage;
		} catch {
			// storage is off, or the document is sandboxed into an opaque origin
			return null;
		}
	}

	private load(realName: string): Store | null {
		const storage = this.storage();
		if (!storage) return null;
		try {
			const raw = new this.client.native.Storage(storage).getItem(
				STORE_PREFIX + realName
			);
			if (raw === null) return null;
			const parsed = JSON_parse(raw);
			if (!parsed || typeof parsed.name !== "string") return null;
			const entries = Object_create(null);
			if (parsed.entries && typeof parsed.entries === "object") {
				for (const key of drain(Object_keys(parsed.entries))) {
					if (typeof parsed.entries[key] === "string")
						entries[key] = parsed.entries[key];
				}
			}

			return {
				name: parsed.name,
				// written by a document, so always there - null is an opaque one
				origin: parsed.origin === null ? null : String(parsed.origin),
				entries,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Record this document as the active one: its name, its origin, and the
	 * entries its document state belongs to. The entries of documents that
	 * are no longer in the session history are let go.
	 */
	private save(store?: Store) {
		const storage = this.storage();
		if (!storage) return;
		const nStorage = new this.client.native.Storage(storage);
		const key = STORE_PREFIX + this.realName;

		try {
			store ??= this.load(this.realName) ?? {
				name: "",
				entries: Object_create(null),
			};
			for (const entry of drain(this.entryKeys)) {
				store.entries[entry] = this.name;
			}

			const live = this.liveEntryKeys();
			if (live) {
				for (const entry of drain(Object_keys(store.entries))) {
					if (!live.has(entry)) delete store.entries[entry];
				}
			}

			nStorage.setItem(
				key,
				JSON_stringify({
					name: this.name,
					origin: this.client.siteOrigin,
					entries: store.entries,
				})
			);
		} catch {
			// over quota - a page can make its name as long as it likes. The
			// name still holds for this document; only a later one loses it
		}
	}

	/** The keys of every entry still in the frame's session history, when that can be asked. */
	private liveEntryKeys(): _Set<string> | null {
		try {
			const navigation = new this.client.native.window(this.client.global)
				.navigation;
			if (!navigation) return null;
			const entries = new this.client.native.Navigation(navigation).entries();
			const keys = new _Set<string>();
			for (let i = 0; i < entries.length; i++) {
				keys.add(new this.client.native.NavigationHistoryEntry(entries[i]).key);
			}

			return keys;
		} catch {
			return null;
		}
	}

	/**
	 * Keep the stored state current across the document's lifetime.
	 *
	 * Through the native `addEventListener`, not the page's: a listener
	 * registered that way is not one the page can see, reorder or remove, and
	 * it never reaches the event interceptor.
	 */
	private listen() {
		const add = this.client.nativeStore.get("EventTarget").addEventListener
			.value as EventTarget["addEventListener"];
		const global = this.client.global as unknown as EventTarget;

		// leaving: the document state's name is final for the entries it has
		Reflect_apply(add, global, [
			"pagehide",
			() => {
				this.noteCurrentEntry();
				this.save();
			},
		]);
		// coming back out of the back/forward cache: this document is the
		// active one again, with the name it was left with
		Reflect_apply(add, global, [
			"pageshow",
			(event: PageTransitionEvent) => {
				if (event.persisted) this.save();
			},
		]);

		try {
			const navigation = new this.client.native.window(this.client.global)
				.navigation;
			if (navigation) {
				Reflect_apply(add, navigation, [
					"currententrychange",
					() => this.noteCurrentEntry(),
				]);
			}
		} catch {}
	}
}
