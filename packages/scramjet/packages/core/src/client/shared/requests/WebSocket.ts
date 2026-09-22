/* eslint-disable scramjet-core/intercept-brand-check --
   Every member here is `const s = socketmap.get(this); if (!s) return super.x;`.
   Membership in that table *is* the brand check, and it is one a page cannot
   forge: the key is the object the constructor handed out. The rule cannot see
   that, because the safe path is the one that does not reach the native - and
   it cannot: these receivers are not real WebSocket objects, so `super.x` on one
   would throw the very error the fallback exists to raise for everything else.
   A receiver that is not ours misses the table and takes `super`, which
   brand-checks natively. */
import { type BareCompatibleWebSocket } from "@mercuryworkshop/proxy-transports";
import { ScramjetClient } from "@client/index";
import {
	Object_setPrototypeOf,
	Reflect_apply,
	TextEncoder_encode,
	TypedArray_prototype_byteLength,
	_URL,
} from "@/shared/snapshot";
import { Arguments, Constructor, Type } from "@client/webidl";

// https://websockets.spec.whatwg.org/#dom-websocket-connecting — named rather
// than read off `WebSocket.CONNECTING`, which is page-writable
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_CLOSING = 2;
const WEBSOCKET_CLOSED = 3;

/** The length of `reason` as it travels in the close frame: UTF-8 bytes. */
const utf8Length = (reason: string): number =>
	Reflect_apply(
		TypedArray_prototype_byteLength,
		TextEncoder_encode(reason),
		[]
	);

export type FakeWebSocketState = {
	protocol: string;
	extensions: string;
	url: string;
	binaryType: BinaryType;
	barews: BareCompatibleWebSocket;
	/**
	 * A `close()` that arrived before the handshake finished.
	 *
	 * The transport has no socket to close until then - calling through threw
	 * `TypeError: this._close is not a function` straight at the page - while
	 * the spec says a close during CONNECTING fails the connection and reports
	 * CLOSING from that moment. So it is remembered here and applied when the
	 * socket opens, and the `open` event is never fired.
	 */
	pendingClose: { code: number; reason: string } | null;

	onopen: ((ev: Event) => any) | null;
	onmessage: ((ev: MessageEvent) => any) | null;
	onclose: ((ev: CloseEvent) => any) | null;
	onerror: ((ev: Event) => any) | null;
};
export default function (client: ScramjetClient, self: GlobalThis) {
	const {
		WebSocket,
		EventTarget,
		CloseEvent,
		Event,
		Blob,
		ArrayBuffer,
		MessageEvent,
	} = self;

	const socketmap = client.box.socketmap;

	client.Intercept(class extends WebSocket {
		@Constructor("USVString", "optional (DOMString or sequence<DOMString>)")
		static konstructor(url: string, protocols: string | string[] = []) {
			const fakeWebSocket = new EventTarget();
			// both prototypes are tainted - intentional
			// but we must not resolve WebSocket->prototype at runtime, since it can be redirected
			Object_setPrototypeOf(fakeWebSocket, WebSocket.prototype);
			// no own `constructor`: it used to be assigned here, which left an
			// own property on every instance where a real WebSocket has none,
			// so `Object.getOwnPropertyNames(ws)` answered ["constructor"].
			// `WebSocket.prototype.constructor` already names the interface
			// object, and this object's prototype *is* that prototype

			// normalize url
			let rawurl = new _URL(url, client.url.href);

			if (rawurl.protocol === "http:") {
				rawurl = new _URL(
					"ws:" + rawurl.href.substring(rawurl.protocol.length)
				);
			} else if (rawurl.protocol === "https:") {
				rawurl = new _URL(
					"wss:" + rawurl.href.substring(rawurl.protocol.length)
				);
			}
			url = rawurl.href;

			// the platform dispatched these, as far as the page is concerned, so
			// they have to read back as trusted - through the box rather than a
			// wrapper, so that the object a listener gets and the object an
			// `on*` handler gets are one and the same
			const trust = <T extends Event>(ev: T): T => {
				client.box.trustedEvents.add(ev);

				return ev;
			};

			const barews = client.bare.createWebSocket(url, protocols, [
				["User-Agent", self.navigator.userAgent],
				["Origin", client.scopeOrigin],
				["Cookie", client.context.cookieJar.getCookies(client.url, false)],
			]);

			const state: FakeWebSocketState = {
				protocol: "",
				extensions: "",
				url,
				binaryType: "blob",
				barews,
				pendingClose: null,

				onopen: null,
				onmessage: null,
				onclose: null,
				onerror: null,
			};

			function fakeEventSend(fakeev: Event) {
				// the `on*` handler is not called by hand: it is registered as
				// an ordinary listener below, so that it sees the same stand-in
				// the page's own listeners do - with `isTrusted` answering true
				// and `target` already set, neither of which was true when it
				// was invoked before the dispatch
				trust(fakeev);
				fakeWebSocket.dispatchEvent(fakeev);
			}

			// registered here, at construction, so it runs ahead of anything
			// the page adds - which is the order a handler set before any
			// listener fires in natively
			for (const type of ["open", "message", "close", "error"]) {
				fakeWebSocket.addEventListener(type, (ev: Event) => {
					state["on" + type]?.call(fakeWebSocket, ev);
				});
			}

			barews.addEventListener("open", () => {
				// a close that arrived while connecting: the handshake is
				// complete, so there is finally something to close, and the
				// page must not see an `open` for a socket it already closed
				const pending = state.pendingClose;
				if (pending) {
					state.pendingClose = null;
					barews.close(pending.code, pending.reason);

					return;
				}

				fakeEventSend(new Event("open"));
			});
			barews.addEventListener("close", (ev) => {
				fakeEventSend(new CloseEvent("close", ev));
			});
			barews.addEventListener("message", async (ev) => {
				let payload = ev.data;
				if (typeof payload === "string") {
					// DO NOTHING
				} else if ("byteLength" in payload) {
					// arraybuffer, convert to blob if needed or set the proper prototype
					if (state.binaryType === "blob") {
						payload = new Blob([payload]);
					} else {
						Object_setPrototypeOf(payload, ArrayBuffer.prototype);
					}
				} else if ("arrayBuffer" in payload) {
					// blob, convert to arraybuffer if neccesary.
					if (state.binaryType === "arraybuffer") {
						payload = await payload.arrayBuffer();
						Object_setPrototypeOf(payload, ArrayBuffer.prototype);
					}
				}

				const fakeev = new MessageEvent("message", {
					data: payload,
					origin: ev.origin,
					lastEventId: ev.lastEventId,
					source: ev.source,
					ports: ev.ports,
				});

				fakeEventSend(fakeev);
			});
			barews.addEventListener("error", () => {
				fakeEventSend(new Event("error"));
			});

			socketmap.set(fakeWebSocket as unknown as WebSocket, state);

			return fakeWebSocket;
		}

		@Type("USVString")
		get url() {
			const ws = socketmap.get(this);
			if (!ws) return super.url;

			return ws.url;
		}

		@Type("unsigned short")
		get readyState() {
			const ws = socketmap.get(this);
			if (!ws) return super.readyState;

			// a close during CONNECTING puts the socket in CLOSING immediately,
			// even though the transport is still finishing the handshake
			if (ws.pendingClose) return WEBSOCKET_CLOSING;

			return ws.barews.readyState;
		}

		@Type("unsigned long long")
		get bufferedAmount() {
			const ws = socketmap.get(this);
			if (!ws) return super.bufferedAmount;

			return 0;
		}

		@Type("DOMString")
		get extensions() {
			const ws = socketmap.get(this);
			if (!ws) return super.extensions;

			return ws.extensions;
		}

		@Type("DOMString")
		get protocol() {
			const ws = socketmap.get(this);
			if (!ws) return super.protocol;

			return ws.protocol;
		}

		@Type("BinaryType")
		get binaryType() {
			const ws = socketmap.get(this);
			if (!ws) return super.binaryType;

			return ws.binaryType;
		}

		@Type("BinaryType")
		set binaryType(v: BinaryType) {
			const ws = socketmap.get(this);
			if (!ws) {
				super.binaryType = v;

				return;
			}

			// anything outside the enum is ignored rather than thrown on, which
			// is what the native setter does for a non-nullable enum attribute
			if (v === "blob" || v === "arraybuffer") ws.binaryType = v;
		}

		@Type("EventHandler")
		get onopen() {
			const ws = socketmap.get(this);
			if (!ws) return super.onopen;

			return ws.onopen;
		}

		@Type("EventHandler")
		set onopen(v: ((ev: Event) => any) | null) {
			const ws = socketmap.get(this);
			if (!ws) {
				super.onopen = v;

				return;
			}

			ws.onopen = v;
		}

		@Type("EventHandler")
		get onmessage() {
			const ws = socketmap.get(this);
			if (!ws) return super.onmessage;

			return ws.onmessage;
		}

		@Type("EventHandler")
		set onmessage(v: ((ev: MessageEvent) => any) | null) {
			const ws = socketmap.get(this);
			if (!ws) {
				super.onmessage = v;

				return;
			}

			ws.onmessage = v;
		}

		@Type("EventHandler")
		get onclose() {
			const ws = socketmap.get(this);
			if (!ws) return super.onclose;

			return ws.onclose;
		}

		@Type("EventHandler")
		set onclose(v: ((ev: CloseEvent) => any) | null) {
			const ws = socketmap.get(this);
			if (!ws) {
				super.onclose = v;

				return;
			}

			ws.onclose = v;
		}

		@Type("EventHandler")
		get onerror() {
			const ws = socketmap.get(this);
			if (!ws) return super.onerror;

			return ws.onerror;
		}

		@Type("EventHandler")
		set onerror(v: ((ev: Event) => any) | null) {
			const ws = socketmap.get(this);
			if (!ws) {
				super.onerror = v;

				return;
			}

			ws.onerror = v;
		}

		@Arguments("(BufferSource or Blob or USVString)")
		send(data) {
			const ws = socketmap.get(this);
			if (!ws) return super.send(data);

			// https://websockets.spec.whatwg.org/#dom-websocket-send step 1.
			// Only CONNECTING throws; a send on a CLOSING or CLOSED socket is
			// discarded silently. This is how a page finds out it raced its own
			// handshake, and without it that race just vanished
			if (ws.barews.readyState === WEBSOCKET_CONNECTING) {
				throw client.errors.domException("InvalidStateError", {
					execute: "send",
					on: "WebSocket",
					detail: "Still in CONNECTING state.",
				});
			}

			return ws.barews.send(data);
		}

		// https://websockets.spec.whatwg.org/#dom-websocket-close
		@Arguments("optional [Clamp] unsigned short", "optional USVString")
		close(code?: number, reason?: string) {
			const ws = socketmap.get(this);
			if (!ws) return super.close(code, reason);

			// step 1: the code is either absent, 1000, or in the registered
			// private range. `[Clamp]` has already pinned it to 0..65535, so
			// this is the whole of the check
			if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
				throw client.errors.domException("InvalidAccessError", {
					execute: "close",
					on: "WebSocket",
					detail: `The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
				});
			}

			// step 2: the reason travels in the close frame, which has 125
			// bytes for the code and the reason together
			if (reason !== undefined && utf8Length(reason) > 123) {
				throw client.errors.domException("SyntaxError", {
					execute: "close",
					on: "WebSocket",
					detail: "The message must not be greater than 123 bytes.",
				});
			}

			const state = ws.barews.readyState;

			// step 3.1: already closing or closed, so there is nothing to do -
			// and in particular no error to raise
			if (
				ws.pendingClose ||
				state === WEBSOCKET_CLOSING ||
				state === WEBSOCKET_CLOSED
			) {
				return;
			}

			// step 3.2: closing during the handshake. The transport has no
			// socket yet, and reaching into it threw a TypeError naming its own
			// private field at the page, so remember the close and apply it on
			// open. `readyState` reports CLOSING from here on, as the spec asks
			if (state === WEBSOCKET_CONNECTING) {
				ws.pendingClose = { code: code ?? 1000, reason: reason ?? "" };

				return;
			}

			return ws.barews.close(code ?? 1000, reason ?? "");
		}
	});
}
