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
