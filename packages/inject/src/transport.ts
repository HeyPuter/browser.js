import type {
	ProxyTransport,
	TransferrableResponse,
	RawHeaders,
	WebSocketMessage,
} from "@mercuryworkshop/proxy-transports";
import type { RpcHelper } from "@mercuryworkshop/rpc";
import { ExecutionContextWrapper } from "./context";

const MessagePort_postMessage = MessagePort.prototype.postMessage;
const postMessage = (
	port: MessagePort,
	data: any,
	transfer?: Transferable[]
) => {
	MessagePort_postMessage.call(port, data, transfer as any);
};

export class RemoteTransport implements ProxyTransport {
	public ready = true;
	async init() {}

	constructor(public context: ExecutionContextWrapper) {}
	connect(
		url: URL,
		protocols: string[],
		requestHeaders: RawHeaders,
		onopen: (protocol: string, extensions: string) => void,
		onmessage: (data: Blob | ArrayBuffer | string) => void,
		onclose: (code: number, reason: string) => void,
		onerror: (error: string) => void
	): [
		(data: Blob | ArrayBuffer | string) => void,
		(code: number, reason: string) => void,
	] {
		const channel = new MessageChannel();
		const port = channel.port1;
		console.warn("connecting");
		this.context.rpc
			.call(
				"wsconnect",
				{
					url: url.href,
					protocols,
					requestHeaders,
					port: channel.port2,
				},
				[channel.port2]
			)
			.then((response) => {
				if (response.result === "success") {
					onopen(response.protocol, response.extensions);
				} else {
					onerror(response.error);
				}
			});
		port.onmessage = (ev) => {
			const message = ev.data as WebSocketMessage;
			if (message.type === "data") {
				onmessage(message.data);
			} else if (message.type === "close") {
				onclose(message.code, message.reason);
			}
		};
		port.onmessageerror = (ev) => {
			console.error("onmessageerror (this should never happen!)", ev);
			onerror("Message error in transport port");
		};

		return [
			(data) => {
				postMessage(
					port,
					{
						type: "data",
						data: data,
					},
					data instanceof ArrayBuffer ? [data] : []
				);
			},
			(code) => {
				postMessage(port, {
					type: "close",
					code: code,
				});
			},
		];
	}

	async request(
		remote: URL,
		method: string,
		body: BodyInit | null,
		headers: RawHeaders,
		_signal: AbortSignal | undefined
	): Promise<TransferrableResponse> {}
}
