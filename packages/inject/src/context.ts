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
import { chromeframe } from ".";

function findSelfSequence(
	target: Window,
	path: FrameSequence = []
): FrameSequence | null {
	if (target == self) {
		return path;
	} else {
		for (let i = 0; i < target.frames.length; i++) {
			const child = target.frames[i];
			const res = findSelfSequence(child, [...path, i]);
			if (res) return res;
		}
		return null;
	}
}

// const realFetch = fetch;

export class ExecutionContextWrapper {
	public rpc: RpcHelper<Framebound, Chromebound>;
	public client: ScramjetClient;
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
				async navigate({ url }) {
					window.location.href = url;
				},
				async popstate({ url, state, title }) {
					history_replaceState.call(history, state, title, url);
					const popStateEvent = new PopStateEvent("popstate", { state });
					window.dispatchEvent(popStateEvent);
				},
				async fetchBlob(url) {
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
				async setCookie({ url, cookie }) {
					this.cookieJar.setCookies([cookie], new URL(url));
				},
				async updateTheme(theme) {
					applyTheme(theme);
				},
			},
			init.id,
			(message, transfer) => chromeframe.postMessage(message, "*", transfer)
		);
		addEventListener("message", (event) => {
			// if (event.source !== chromeframe) return;
			this.rpc.recieve(event.data);
		});

		setupTitleWatcher();
		setupContextMenu();
		// setupHistoryEmulation();
		// inform	chrome of the current url
		// will happen if you get redirected/click on a link, etc, the chrome will have no idea otherwise
		this.rpc.call("load", {
			url: this.client.url.href,
			sequence: findSelfSequence(top!)!,
		});
	}

	loadScramjet() {
		setWasm(Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0)));
		delete (self as any).WASM;
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
			sendSetCookie: async (url: URL, cookie: string) => {},
		});
		this.client.hook();
	}
}
