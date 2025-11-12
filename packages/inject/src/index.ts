import chobitsu from "chobitsu";
import * as h2 from "html-to-image";
import {
	Chromebound,
	Framebound,
	FrameSequence,
	InjectScramjetInit,
} from "./types";
import { CookieJar, iswindow, ScramjetClient } from "@mercuryworkshop/scramjet";
import { setupTitleWatcher } from "./titlewatcher";
import { setupContextMenu } from "./contextmenu";
import { setupHistoryEmulation } from "./history";
import { client, loadScramjet } from "./scramjet";
import { MethodsDefinition, RpcHelper } from "@mercuryworkshop/rpc";

const history_replaceState = globalThis?.History?.prototype?.replaceState;
const realFetch = fetch;

export let chromeframe: Window;

export let rpc: RpcHelper<Framebound, Chromebound>;
export let cookieJar: CookieJar;
export const methods: MethodsDefinition<Framebound> = {
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
					response.headers.get("Content-Type") || "application/octet-stream",
			},
			[ab],
		];
	},
	setCookie({ url, cookie }) {
		cookieJar.setCookies([cookie], new URL(url));
	},
};

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

(globalThis as any).$injectLoad = (init: InjectScramjetInit) => {
	cookieJar = new CookieJar();
	cookieJar.load(init.cookies);
	loadScramjet(init);

	if (!iswindow) return;
	chromeframe = init.sequence.reduce((win, idx) => win!.frames[idx], top)!;

	rpc = new RpcHelper(methods, init.id, (message, transfer) =>
		chromeframe.postMessage(message, "*", transfer)
	);
	addEventListener("message", (event) => {
		// console.log("inject got message", event.data, event.source, chromeframe);
		// if (event.source !== chromeframe) return;
		rpc.recieve(event.data);
	});

	setupTitleWatcher();
	setupContextMenu();
	// setupHistoryEmulation();
	// inform	chrome of the current url
	// will happen if you get redirected/click on a link, etc, the chrome will have no idea otherwise
	rpc.call("load", {
		url: client.url.href,
		sequence: findSelfSequence(top!)!,
	});
};
