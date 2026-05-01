import {
	CookieJar,
	iswindow,
	SCRAMJETCLIENT,
	ScramjetClient,
	setWasm,
} from "@mercuryworkshop/scramjet";
import {
	Chromebound,
	Framebound,
	FrameSequence,
	InjectScramjetInit,
} from "./types";

import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import { RpcHelper } from "@mercuryworkshop/rpc";
import { applyTheme } from "./errorpage/errorpage";
import { chromeframe, wasm } from ".";
import { setupContextMenu } from "./emulators/contextmenu";
import { setupHistoryEmulation } from "./emulators/history";
import { setupTitleWatcher } from "./emulators/titlewatcher";
import { setupAnchorHandler } from "./emulators/anchors";
import { setupWindowOpen } from "./emulators/windowopen";

function makeContextId(): string {
	return "context-" + Math.random().toString(36).substring(2, 10);
}

function findSequence(
	top: Window,
	target: Window,
	path: FrameSequence = []
): FrameSequence | null {
	if (top == target) {
		return path;
	} else {
		for (let i = 0; i < top.frames.length; i++) {
			const child = top.frames[i];
			const res = findSequence(child, target, [...path, i]);
			if (res) return res;
		}
		return null;
	}
}

// const realFetch = fetch;

export class ExecutionContextWrapper {
	public rpc!: RpcHelper<Framebound, Chromebound>;
	public client!: ScramjetClient;
	private cookieJar = new CookieJar();
	constructor(
		public self: typeof globalThis,
		private init: InjectScramjetInit
	) {
		this.cookieJar.load(init.cookies);
		this.loadScramjet();

		// this entry point is still called in web workers
		if (!iswindow) return;

		const history_replaceState = self.History.prototype.replaceState;
		const realFetch = self.fetch.bind(self);
		this.rpc = new RpcHelper(
			{
				navigate: async ({ url }) => {
					window.location.href = url;
				},
				popstate: async ({ url, state, title }) => {
					history_replaceState.call(history, state, title, url);
					const popStateEvent = new PopStateEvent("popstate", { state });
					window.dispatchEvent(popStateEvent);
				},
				fetchBlob: async (
					url
				): Promise<
					[{ body: ArrayBuffer; contentType: string }, Transferable[]]
				> => {
					const response = await realFetch(url);
					const ab = await response.arrayBuffer();
					return [
						{
							body: ab,
							contentType:
								response.headers.get("Content-Type") ||
								"application/octet-stream",
						},
						[ab],
					];
				},
				setCookies: async ({ cookies }) => {
					for (const { url, cookie } of cookies) {
						this.cookieJar.setCookies([cookie], new URL(url));
					}
				},
				updateTheme: async (theme) => {
					applyTheme(theme);
				},
			},
			init.id,
			(message, transfer) => {
				this.client.natives.call(
					"window.postMessage",
					chromeframe,
					message,
					"*",
					transfer
				);
			}
		);
		addEventListener("message", (event) => {
			// if (event.source !== chromeframe) return;
			this.rpc.recieve(event.data);
		});

		setupTitleWatcher(this);
		setupContextMenu(this);
		setupHistoryEmulation(this);
		setupAnchorHandler(this);
		setupWindowOpen(this);
		// inform	chrome of the current url
		// will happen if you get redirected/click on a link, etc, the chrome will have no idea otherwise

		this.rpc.call("load", {
			url: this.client.url.href,
			sequence: findSequence(top!, self as any)!,
		});
	}

	loadScramjet() {
		const transport = new LibcurlClient({ wisp: this.init.wisp });

		this.client = new ScramjetClient(this.self, {
			context: {
				interface: {
					getInjectScripts: this.init.getInjectScripts,
					codecEncode: this.init.codecEncode,
					codecDecode: this.init.codecDecode,
				},
				config: this.init.config,
				cookieJar: this.cookieJar,
				prefix: new URL(this.init.prefix),
			},
			transport,
			shouldPassthroughWebsocket: (url) => {
				return url === this.init.wisp;
			},
			hookSubcontext: (frameself, frame) => {
				if (!frame) {
					throw new Error(
						"hookSubcontext was called, but a frame null was passed. It shouldn't be possible for a window.open to happen here"
					);
				}

				// recalculate chromeframe's sequence just in case
				const newseq = findSequence(top!, chromeframe);
				if (!newseq) {
					throw new Error("could not find chromeframe in top?");
				}
				const childId = makeContextId();
				void this.rpc.call("registerFrameContext", { id: childId });
				const context = new ExecutionContextWrapper(frameself, {
					sequence: newseq,
					id: childId,
					config: this.init.config,
					cookies: this.cookieJar.dump(),
					getInjectScripts: this.init.getInjectScripts,
					wisp: this.init.wisp,
					prefix: this.init.prefix,
					codecEncode: this.init.codecEncode,
					codecDecode: this.init.codecDecode,
					// TODO: what should be the behavior here? is inheriting correct?
					initHeaders: this.init.initHeaders,
					history: this.init.history,
				});

				return context.client;
			},
			sendSetCookie: async (_cookies, _options) => {},
			initHeaders: this.init.initHeaders,
			history: this.init.history,
		});
		this.client.hook();
	}
}
