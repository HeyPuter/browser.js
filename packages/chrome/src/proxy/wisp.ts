import {
	BareCompatibleClient,
	type ProxyTransport,
} from "@mercuryworkshop/proxy-transports";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";

import EpoxyTransport from "./epoxy";

export let bare: BareCompatibleClient;
export let transport: ProxyTransport;
export let wispUrl: string;

import {
	EitherSocketProvider,
	WispSocketProvider,
	WebSocketJsProvider,
	JsSocketProvider,
	EpoxyClient,
	init,
} from "@mercuryworkshop/epoxy-tls/full/bundled";
import { anonPeerToken } from "..";

let useEpoxy = true;

export async function setWispUrl(wispurl: string) {
	wispUrl = wispurl;

	const isLoopback = (host: string) =>
		host === "127.0.0.1" ||
		host === "::1" ||
		host === "[::1]" ||
		host === "localhost" ||
		host.endsWith(".localhost");

	if (useEpoxy) {
		await init();
		const custom = new JsSocketProvider(async (host, port) => {
			const socket = await puter.peer.connect(undefined, {
				port,
				anonToken: anonPeerToken,
			});

			await new Promise<void>((resolve, reject) => {
				socket.addEventListener("open", () => {
					resolve();
				});
				socket.addEventListener("error", (ev: ErrorEvent) => {
					reject(ev.error);
				});
			});

			return [
				new ReadableStream({
					start(controller) {
						socket.addEventListener("message", (ev: MessageEvent) => {
							controller.enqueue(new Uint8Array(ev.data));
						});
					},
				}),
				new WritableStream({
					write(chunk) {
						console.log(chunk, socket);
						socket.send(chunk);
					},
				}),
			];
		});

		const wisp = new WispSocketProvider(new WebSocketJsProvider(), wispurl);
		const backend = new EitherSocketProvider(
			(host) =>
				typeof puter !== "undefined" && isLoopback(host) ? "left" : "right",
			custom,
			wisp
		);

		const client = new EpoxyClient(backend);
		transport = new EpoxyTransport(client);
	} else {
		transport = new LibcurlClient({
			wisp: wispurl,
		});
	}
	bare = new BareCompatibleClient(transport);
}
