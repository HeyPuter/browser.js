import { IncrementalHtmlRewriter } from "@/shared";
import { ScramjetClient } from "./client";
import { SourceMaps } from "./shared/sourcemaps";
import {
	Object_getOwnPropertyNames,
	Object_getOwnPropertyDescriptor,
	_WeakMap,
	_Map,
	_WeakSet,
} from "@/shared/snapshot";
import { FakeWebSocketState } from "./shared/requests/WebSocket";
import { FakeWebSocketStreamState } from "./shared/requests/WebSocketStream";

export class SingletonBox {
	clients: ScramjetClient[] = [];
	globals: _Map<Self, ScramjetClient> = new _Map([]);
	documents: _Map<Document, ScramjetClient> = new _Map([]);
	histories: _Map<History, ScramjetClient> = new _Map([]);
	/**
	 * Keyed on each realm's `Object.prototype`, which every object created in
	 * that realm reaches at the end of its prototype chain. One entry per realm
	 * rather than one per interface.
	 */
	realms: _Map<object, ScramjetClient> = new _Map([]);
	locations: _Map<Location, ScramjetClient> = new _Map([]);
	functions: _Map<typeof Function, ScramjetClient> = new _Map([]);
	writeRewriters: _WeakMap<Document, IncrementalHtmlRewriter> = new _WeakMap(
		[]
	);
	taggedHeaders: _WeakSet<Headers> = new _WeakSet([]);
	taggedResponses: _WeakSet<Response> = new _WeakSet([]);
	/**
	 * The directory handles handed back in place of an origin's real OPFS root.
	 *
	 * Tracked rather than patched per object: the root's `name` is `""`, and
	 * `FileSystemHandle.prototype.name` is a prototype getter, so defining an own
	 * `name` on the directory shadows the getter with a data property that the
	 * real thing does not have. A page reading
	 * `Object.getOwnPropertyDescriptor(root, "name")` gets a descriptor where a
	 * browser gives it null, and because `defineProperty` defaults to
	 * `configurable: false` the tell cannot even be removed afterwards.
	 *
	 * Shared rather than per-client because a handle is structured-cloneable and
	 * postMessage-able, so the realm that reads `name` off one need not be the
	 * realm that called `getDirectory()`. Kept on a client, a root that crossed a
	 * frame boundary would report its scoped name instead of `""`.
	 */
	scopedOpfsRoots: _WeakSet<FileSystemHandle> = new _WeakSet();
	/**
	 * The wrapper handed back in place of each style declaration.
	 *
	 * `style` is `[SameObject]` on every interface that has one, so
	 * `el.style === el.style` has to hold and a fresh Proxy per read is a
	 * one-expression tell. Keyed on the declaration, which the browser already
	 * guarantees is the same object for the same element or rule.
	 *
	 * Shared rather than per-client because [SameObject] is a property of the
	 * declaration and not of the realm reading it: a declaration reached from a
	 * second frame has to come back as the same wrapper it did in the first.
	 * The wrapper closes over the rewriters of whichever client created it,
	 * which is the declaration's own realm for every read that goes through the
	 * prototype chain - only a deliberately borrowed accessor can pin it to
	 * another realm's base URL.
	 */
	styleDeclarations: _WeakMap<CSSStyleDeclaration, CSSStyleDeclaration> =
		new _WeakMap();
	/**
	 * The wrapper installed for each (target, type, capture, callback) listener,
	 * which is the DOM's own listener identity.
	 *
	 * Shared rather than per-client because it is keyed on the EventTarget, and
	 * one target is reachable from every realm that can see it. Kept on a client
	 * it would mint a second wrapper for the same listener registered through a
	 * different realm, and the DOM's dedup - which is what this table exists to
	 * preserve - would silently stop working across frames.
	 *
	 * Weak at both ends that hold page objects. This was a `Map` of arrays
	 * scanned linearly, which retained every target that had ever had a listener
	 * added - and its callbacks - for the lifetime of the box, and cost O(n) per
	 * add on a target with n listeners. Nesting the (type, capture) key in the
	 * middle keeps the callbacks collectable and the lookup O(1); the middle
	 * `Map` holds only event-type strings and dies with its target.
	 *
	 * The middle key is `capture` as "0"/"1" followed by the type, so that the
	 * two halves cannot be confused for one another whatever the page names its
	 * events. It has to be a `Map` rather than an object: a type is a
	 * page-controlled string, and `"__proto__"` is a legal event name.
	 */
	eventcallbacks: _WeakMap<
		EventTarget,
		// callable rather than `Function`, which has no call signature and so
		// cannot be handed to anything typed as a listener
		_Map<string, _WeakMap<(...args: any) => any, (...args: any) => any>>
	> = new _WeakMap();

	wrappedEvents: _WeakMap<Event, Event> = new _WeakMap();
	eventhandlers: _WeakMap<object, _Map<string, (...args: any) => any>> =
		new _WeakMap();

	unproxy: _Map<any, any> = new _Map([]);

	socketmap: _WeakMap<WebSocket, FakeWebSocketState> = new _WeakMap([]);
	socketstreammap: _WeakMap<WebSocketStream, FakeWebSocketStreamState> =
		new _WeakMap([]);

	ctors: Record<string, Function[]> = {};

	sourcemaps: SourceMaps = {};

	constructor(public ownerclient: ScramjetClient) {}

	registerClient(client: ScramjetClient, global: Self) {
		this.clients.push(client);
		this.globals.set(global, client);
		this.documents.set(global.document, client);
		this.locations.set(global.location, client);
		this.histories.set(global.history, client);
		this.functions.set(global.Function, client);
		this.realms.set(global.Object.prototype, client);

		Object_getOwnPropertyNames(global).forEach((prop) => {
			const desc = Object_getOwnPropertyDescriptor(global, prop);
			if (desc && typeof desc.value === "function") {
				if (!this.ctors[prop]) this.ctors[prop] = [];
				this.ctors[prop].push(desc.value);
			}
		});
	}

	instanceof(obj: any, name: string): boolean {
		const ctors = this.ctors[name];
		if (!ctors) {
			dbg.error(`No constructors for ${name} found`);
			return false;
		}
		for (const ctor of ctors) {
			// eslint-disable-next-line scramjet-core/no-instanceof
			if (obj instanceof ctor) return true;
		}
		return false;
	}
}
