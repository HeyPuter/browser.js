import { Object_setPrototypeOf } from "@/shared/snapshot";
import { ScramjetClient } from "@client/client";
import { Arguments, Constructor, Type } from "@client/webidl";
import { type BareCompatibleWebSocket } from "@mercuryworkshop/proxy-transports";

export type FakeWebSocketStreamState = {
	protocol: string;
	extensions: string;
	url: string;
	barews: BareCompatibleWebSocket;

	opened: Promise<WebSocketOpenInfo>;
	closed: Promise<WebSocketCloseInfo>;
	readable: ReadableStream;
	writable: WritableStream;
};

export const enabled = (client: ScramjetClient, self: Self) =>
	"WebSocketStream" in self;
export default function (client: ScramjetClient, self: Self) {
	const { ArrayBuffer, Promise, ReadableStream, WritableStream } = self;
	const map = client.box.socketstreammap;
	client.Intercept(class extends WebSocketStream {
		@Constructor("USVString", "optional WebSocketStreamOptions")
		static konstructor(url: string, options?: WebSocketStreamOptions) {
			const fakeWebSocketStream = {};
			Object_setPrototypeOf(fakeWebSocketStream, this.prototype);
			fakeWebSocketStream.constructor = this;

			const barews = client.bare.createWebSocket(url, options?.protocols, [
				["User-Agent", self.navigator.userAgent],
				["Origin", client.scopeOrigin],
			]);
			options?.signal?.addEventListener("abort", () => {
				barews.close(1000, "");
			});

			const state: FakeWebSocketStreamState = {
				protocol: "",
				extensions: "",
				url,
				barews,

				opened: new Promise((resolve, reject) => {
					barews.addEventListener("open", () => {
						resolve({
							readable: state.readable,
							writable: state.writable,
							protocol: state.protocol,
							extensions: state.extensions,
						});
					});
					barews.addEventListener("error", (ev: Event) => {
						reject(ev);
					});
				}),
				closed: new Promise((resolve) => {
					barews.addEventListener("close", (ev: CloseEvent) => {
						resolve({ closeCode: ev.code, reason: ev.reason });
					});
				}),
				readable: new ReadableStream({
					start(controller) {
						barews.addEventListener("message", async (ev: MessageEvent) => {
							let payload = ev.data;
							// TODO: this needs to be changed to uint8array later
							// chrome isnt following spec though so we are just going to do this
							if (typeof payload === "string") {
								// DO NOTHING
							} else if ("byteLength" in payload) {
								// arraybuffer, set the realms prototype so its recognized
								Object_setPrototypeOf(payload, ArrayBuffer.prototype);
							} else if ("arrayBuffer" in payload) {
								// blob, convert to arraybuffer
								payload = await payload.arrayBuffer();
								Object_setPrototypeOf(payload, ArrayBuffer.prototype);
							}
							controller.enqueue(payload);
						});
					},
					cancel(info) {
						barews.close(info?.closeCode ?? 1000, info?.reason ?? "");
					},
				}),
				writable: new WritableStream({
					write(chunk) {
						barews.send(chunk);
					},
					abort() {
						barews.close(1000, "");
					},
					close() {
						barews.close(1000, "");
					},
				}),
			};

			map.set(fakeWebSocketStream as WebSocketStream, state);

			return fakeWebSocketStream;
		}

		@Type("USVString")
		get url() {
			const ws = map.get(this);
			if (!ws) return super.url;

			return ws.url;
		}

		@Type("Promise<WebSocketOpenInfo>")
		get opened() {
			const ws = map.get(this);
			if (!ws) return super.opened;

			return ws.opened;
		}

		@Type("Promise<WebSocketCloseInfo>")
		get closed() {
			const ws = map.get(this);
			if (!ws) return super.closed;

			return ws.closed;
		}

		@Arguments("optional WebSocketCloseInfo")
		close(closeInfo?: WebSocketCloseInfo) {
			const ws = map.get(this);
			if (!ws) return super.close(closeInfo);

			return ws.barews.close(
				closeInfo?.closeCode ?? 1000,
				closeInfo?.reason ?? ""
			);
		}
	});
}
