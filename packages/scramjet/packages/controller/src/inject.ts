import type {
	RawHeaders,
	ProxyTransport,
	TransferrableResponse,
} from "@mercuryworkshop/proxy-transports";

import { RpcHelper } from "@mercuryworkshop/rpc";
import type { Config } from ".";
import { CONTROLLERFRAME } from "./symbols";
import type {
	SerializedCookieSyncEntry,
	ControllerToTransport,
	TransportToController,
	WebSocketMessage,
} from "./types";
import {
	bundleSource,
	CookieJar,
	getRewriter,
	hasRewriter,
	SCRAMJETCLIENT,
	ScramjetClient,
	setWasm,
	Tap,
	type CookieSyncOptions,
	type ScramjetConfig,
	type ScramjetContext,
	type TrackedHistoryState,
} from "@mercuryworkshop/scramjet";

// read while this bundle evaluates, before any page script: `hookOpenedWindow`
// builds the source it evaluates into a popup out of them
const JSON_stringify = JSON.stringify;
const Function_toString = Function.prototype.toString;

// the function the build wraps this bundle in (see `bundleWrapper` in
// rspack.config.ts), so a copy of it can be evaluated into a popup
declare const __controllerInjectBundle: ((...args: any[]) => any) | undefined;

const MessagePort_postMessage = MessagePort.prototype.postMessage;
const postMessage = (
	port: MessagePort,
	data: any,
	transfer?: Transferable[]
) => {
	MessagePort_postMessage.call(port, data, transfer as any);
};

class RemoteTransport implements ProxyTransport {
	private readyResolve!: () => void;
	private readyPromise: Promise<void> = new Promise((resolve) => {
		this.readyResolve = resolve;
	});

	public ready = false;
	async init() {
		await this.readyPromise;
		this.ready = true;
	}

	private rpc: RpcHelper<ControllerToTransport, TransportToController>;
	constructor(public port: MessagePort) {
		this.rpc = new RpcHelper<ControllerToTransport, TransportToController>(
			{
				ready: async () => {
					this.readyResolve();
				},
			},
			"transport",
			(data, transfer) => {
				postMessage(port, data, transfer);
			}
		);
		port.onmessageerror = (ev) => {
			console.error("onmessageerror (this should never happen!)", ev);
		};
		port.onmessage = (ev) => {
			this.rpc.recieve(ev.data);
		};
		port.start();
	}
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
		this.rpc
			.call(
				"connect",
				{
					url: url.href,
					protocols,
					requestHeaders,
					port: channel.port2,
				},
				[channel.port2]
			)
			.then((response) => {
				console.log(response);
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
	): Promise<TransferrableResponse> {
		return await this.rpc.call("request", {
			remote: remote.href,
			method,
			body,
			headers,
		});
	}

	async sendSetCookie(
		cookies: Array<{ url: URL; cookie: string }>,
		options: CookieSyncOptions = {}
	): Promise<void> {
		await this.rpc.call("sendSetCookie", {
			cookies: cookies.map(({ url, cookie }) => ({
				url: url.href,
				cookie,
			})),
			options,
		});
	}
}

const sw = navigator.serviceWorker?.controller;

type Init = {
	config: Config;
	sjconfig: ScramjetConfig;
	prefix: URL;
	cookies: string;
	yieldGetInjectScripts: (
		config: Config,
		sjconfig: ScramjetConfig,
		prefix: URL,
		cookieJar: CookieJar,
		codecEncode: (input: string) => string,
		codecDecode: (input: string) => string
	) => any;
	codecEncode: (input: string) => string;
	codecDecode: (input: string) => string;
	initHeaders: RawHeaders;
	history: TrackedHistoryState[];
};

export function load(init: Init) {
	if (SCRAMJETCLIENT in globalThis) {
		((globalThis as any)[SCRAMJETCLIENT] as ScramjetClient).syncDocumentInit({
			initHeaders: init.initHeaders,
			history: init.history,
			cookies: init.cookies,
		});
		return;
	}
	if ("WASM" in self) {
		const wasm = Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0));
		delete (self as any).WASM;
		setWasm(wasm);
	} else if (!hasRewriter()) {
		// a popup evaluated by `hookOpenedWindow` adopts its opener's rewriter
		// instead
		throw new Error("WASM not found in global scope!");
	}

	new ExecutionContextWrapper(globalThis, init);
}

/**
 * The argument `load` is called with, as source: what `getInjectScripts` in
 * index.ts writes into a document, so the realm evaluating it builds every
 * object and function in it for itself.
 */
function loadInitSource(init: Init, cookies: string): string {
	return `{
		config: ${JSON_stringify(init.config)},
		sjconfig: ${JSON_stringify(init.sjconfig)},
		prefix: new URL(${JSON_stringify(init.prefix.href)}),
		cookies: ${JSON_stringify(cookies)},
		yieldGetInjectScripts: ${Function_toString.call(init.yieldGetInjectScripts)},
		codecEncode: ${Function_toString.call(init.codecEncode)},
		codecDecode: ${Function_toString.call(init.codecDecode)},
		initHeaders: ${JSON_stringify(init.initHeaders)},
		history: ${JSON_stringify(init.history)},
	}`;
}

function createFrameId() {
	return `${Array(8)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join("")}`;
}

class ExecutionContextWrapper {
	client!: ScramjetClient;
	cookieJar: CookieJar;
	transport: RemoteTransport;
	private handleServiceWorkerCookieMessage: (event: MessageEvent) => void;

	constructor(
		public global: typeof globalThis,
		public init: Init
	) {
		const channel = new MessageChannel();
		this.transport = new RemoteTransport(channel.port1);
		sw?.postMessage(
			{
				$sw$initRemoteTransport: {
					port: channel.port2,
					prefix: this.init.prefix.href,
				},
			},
			[channel.port2]
		);

		this.cookieJar = new CookieJar();
		this.cookieJar.load(this.init.cookies);

		this.handleServiceWorkerCookieMessage = (event: MessageEvent) => {
			if (
				!event.data?.$controller$setCookie ||
				typeof event.data.$controller$setCookie !== "object"
			) {
				return;
			}

			const payload = event.data.$controller$setCookie as {
				cookies?: SerializedCookieSyncEntry[];
				options?: CookieSyncOptions;
				id?: string;
			};

			if (payload.options?.clear) {
				this.cookieJar.clear();
			}

			if (Array.isArray(payload.cookies)) {
				for (const cookie of payload.cookies) {
					if (
						typeof cookie?.url !== "string" ||
						typeof cookie.cookie !== "string"
					) {
						continue;
					}

					try {
						this.cookieJar.setCookies(cookie.cookie, new URL(cookie.url));
					} catch {
						console.error("Failed to set cookie", cookie);
					}
				}
			}

			if (typeof payload.id === "string") {
				const targetSw = navigator.serviceWorker?.controller ?? sw;
				targetSw?.postMessage({
					$sw$setCookieDone: {
						id: payload.id,
					},
				});
			}
		};

		navigator.serviceWorker?.addEventListener(
			"message",
			this.handleServiceWorkerCookieMessage
		);

		this.injectScramjet();
	}

	/** Hooks another window with this realm's code. */
	hookSubcontext(frameself: typeof globalThis): ScramjetClient {
		const context = new ExecutionContextWrapper(frameself, {
			...this.init,
			cookies: this.cookieJar.dump(),
		});
		return context.client;
	}

	/**
	 * Hooks a `window.open` popup by evaluating copies of scramjet and of this
	 * bundle into it, then loading them the way a fresh document does.
	 *
	 * `hookSubcontext` would leave every function in the popup's client
	 * belonging to this realm, and Chrome drops the jobs of a realm whose
	 * document is gone: once this page navigates away, an `await` in the
	 * popup's `fetch` never resumes, and its wrapped listeners and timers never
	 * fire. The copies belong to the popup. Only the rewriter is shared, which
	 * is only ever called synchronously.
	 */
	hookOpenedWindow(win: typeof globalThis): ScramjetClient {
		const core = bundleSource();
		const inject =
			typeof __controllerInjectBundle === "function"
				? Function_toString.call(__controllerInjectBundle)
				: null;
		if (!core || !inject) return this.hookSubcontext(win);

		const popup = win as any;
		// nothing has run in the popup yet, so its `eval` is still the native;
		// called bare, it evaluates in the popup's global scope. The sourceURLs
		// name the files this page loaded, so scramjet's frames are still
		// recognised as its own
		const evaluate = popup.eval as (source: string) => unknown;
		const here = this.global.location.href;
		const scramjetUrl = new URL(this.init.config.scramjetPath, here).href;
		const injectUrl = new URL(this.init.config.injectPath, here).href;

		try {
			evaluate(`(${core})();\n//# sourceURL=${scramjetUrl}`);
			popup.$scramjet.adoptRewriter(getRewriter);
			evaluate(`(${inject})();\n//# sourceURL=${injectUrl}`);
			evaluate(
				`$scramjetController.load(${loadInitSource(this.init, this.cookieJar.dump())});`
			);
		} catch (e) {
			console.error("failed to load scramjet into the popup", e);
		}

		// whatever went wrong, a popup without a client must not be handed back
		return popup[SCRAMJETCLIENT] ?? this.hookSubcontext(win);
	}

	injectScramjet() {
		const frame = this.global.frameElement as HTMLIFrameElement | null;
		if (frame && !frame.name) {
			window.name = frame.name = createFrameId();
		}
		let controllerFrame = frame?.[CONTROLLERFRAME];
		let isTopLevel = true;
		if (!controllerFrame) {
			isTopLevel = false;
			let currentwin = this.global.window;
			while (currentwin.parent !== currentwin) {
				const currentclient = currentwin[SCRAMJETCLIENT];
				if (!currentclient) {
					currentwin = currentwin.parent.window;
					continue;
				}
				const currentFrame = new currentclient.native.window(currentwin)
					.frameElement;
				if (currentFrame && currentFrame[CONTROLLERFRAME]) {
					controllerFrame = currentFrame[CONTROLLERFRAME];
					break;
				}
				currentwin = currentwin.parent.window;
			}
		}
		const context: ScramjetContext = {
			config: this.init.sjconfig,
			prefix: this.init.prefix,
			cookieJar: this.cookieJar,
			interface: {
				getInjectScripts: this.init.yieldGetInjectScripts(
					this.init.config,
					this.init.sjconfig,
					this.init.prefix,
					this.cookieJar,
					this.init.codecEncode,
					this.init.codecDecode
				),
				codecEncode: this.init.codecEncode,
				codecDecode: this.init.codecDecode,
			},
		};
		this.client = new ScramjetClient(this.global, {
			context,
			transport: this.transport,
			sendSetCookie: async (cookies, options) => {
				await this.transport.sendSetCookie(cookies, options);
			},
			shouldBlockMessageEvent: () => {
				return false;
			},
			hookSubcontext: (frameself) => this.hookSubcontext(frameself),
			hookOpenedWindow: (win) => this.hookOpenedWindow(win),
			initHeaders: this.init.initHeaders,
			history: this.init.history,
		});
		const frameInitContext = {
			window: this.global.window,
			client: this.client,
			isTopLevel,
		};
		if (controllerFrame)
			Tap.dispatch(controllerFrame.hooks.init.pre, frameInitContext, {});
		this.client.hook();
		if (controllerFrame)
			Tap.dispatch(controllerFrame.hooks.init.post, frameInitContext, {});
	}
}
