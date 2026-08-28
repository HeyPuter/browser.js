import { type BareCompatibleWebSocket } from "@mercuryworkshop/proxy-transports";
import { ScramjetClient } from "@client/index";
import { Object_setPrototypeOf, Reflect_get, _URL } from "@/shared/snapshot";
import { Arguments, Constructor, Type } from "@client/webidl";

export type FakeWebSocketState = {
	protocol: string;
	extensions: string;
	url: string;
	binaryType: BinaryType;
	barews: BareCompatibleWebSocket;

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
			fakeWebSocket.constructor = WebSocket;

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

			const trustEvent = (ev: Event) =>
				new Proxy(ev, {
					get(target, prop) {
						if (prop === "isTrusted") return true;

						return Reflect_get(target, prop);
					},
				});

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

				onopen: null,
				onmessage: null,
				onclose: null,
				onerror: null,
			};

			function fakeEventSend(fakeev: Event) {
				state["on" + fakeev.type]?.(trustEvent(fakeev));
				fakeWebSocket.dispatchEvent(fakeev);
			}

			barews.addEventListener("open", () => {
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

			return ws.barews.send(data);
		}

		@Arguments("optional [Clamp] unsigned short", "optional USVString")
		close(code?: number, reason?: string) {
			const ws = socketmap.get(this);
			if (!ws) return super.close(code, reason);

			return ws.barews.close(code ?? 1000, reason ?? "");
		}
	});
}
