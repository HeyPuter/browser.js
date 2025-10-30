import chobitsu from "chobitsu";
import * as h2 from "html-to-image";
import { Chromebound, FrameboundMethods, InjectScramjetInit } from "./types";
import { sendChrome } from "./ipc";
import { iswindow, ScramjetClient } from "@mercuryworkshop/scramjet";
import { setupTitleWatcher } from "./titlewatcher";
import { setupContextMenu } from "./contextmenu";
import { setupHistoryEmulation } from "./history";
import { client, loadScramjet } from "./scramjet";

const history_replaceState = globalThis?.History?.prototype?.replaceState;
const realFetch = fetch;

export const methods: FrameboundMethods = {
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
		return {
			body: ab,
			contentType:
				response.headers.get("Content-Type") || "application/octet-stream",
		};
	},
};

(globalThis as any).$injectLoad = (init: InjectScramjetInit) => {
	loadScramjet(init);

	if (iswindow) {
		setupTitleWatcher();
		setupContextMenu();
		setupHistoryEmulation();
		// inform	chrome of the current url
		// will happen if you get redirected/click on a link, etc, the chrome will have no idea otherwise
		sendChrome("load", {
			url: client.url.href,
		});
	}
};
