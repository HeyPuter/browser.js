import type { Chromebound, Framebound } from "../../../inject/src/types";
import { browser } from "../Browser";
import { createMenu } from "../components/Menu";
import type { Tab } from "../Tab";
import { pageContextItems } from "./contextitems";
import { controllers } from "./Controller";

let sjIpcListeners = new Map<string, (msg: any) => Promise<any>>();
const sjIpcSyncPool = new Map<number, (val: any) => void>();
let sjIpcCounter = 0;

addEventListener("message", async (e) => {
	if (!e.data || typeof e.data != "object" || !("$scramjetipc$type" in e.data))
		return;
	const type = e.data.$scramjetipc$type;
	if (type === "request") {
		const method = e.data.$scramjetipc$method;
		const message = e.data.$scramjetipc$message;
		const token = e.data.$scramjetipc$token;

		const findTab = (win: Window): Tab | null => {
			const f = browser.tabs.find((t) => t.frame.frame.contentWindow === win);
			if (f) return f;
			const p = findTab(win.parent);
			if (p) return p;
			// no need to worry about subframes because it can't be a tab if it's not the top frame
			return null;
		};

		// const tab = findTab(e.source as Window)!;
		const fn = sjIpcListeners.get(method);
		if (fn) {
			const response = await fn(message);
			e.source!.postMessage({
				$scramjetipc$type: "response",
				$scramjetipc$token: token,
				$scramjetipc$message: response,
			});
		} else {
			console.error("Unknown scramjet ipc method", method);
		}
	} else if (type === "response") {
		const token = e.data.$scramjetipc$token;
		const message = e.data.$scramjetipc$message;

		const cb = sjIpcSyncPool.get(token);
		if (cb) {
			cb(message);
			sjIpcSyncPool.delete(token);
		}
	}
});

export type RawDownload = {
	filename: string | null;
	url: string;
	type: string;
	body: BodyType;
	length: number;
};

let synctoken = 0;
let syncPool: { [token: number]: (val: any) => void } = {};
export function sendFrame<T extends keyof Framebound>(
	tab: Tab,
	type: T,
	message: Framebound[T][0]
): Promise<Framebound[T][1]> {
	let token = synctoken++;

	tab.frame.frame.contentWindow!.postMessage(
		{
			$ipc$type: "request",
			$ipc$token: token,
			$ipc$message: {
				type,
				message,
			},
		},
		"*"
	);

	return new Promise((res) => {
		syncPool[token] = res;
	});
}

window.addEventListener("message", (event) => {
	let data = event.data;
	if (!(data && data.$ipc$type)) return;

	if (data.$ipc$type === "response") {
		let token = data.$ipc$token;
		if (typeof token !== "number") return;
		let cb = syncPool[token];
		if (cb) {
			cb(data.$ipc$message);
			delete syncPool[token];
		}
	} else if (data.$ipc$type === "request") {
		const { type, message } = data.$ipc$message;
		const token = data.$ipc$token;

		const tab =
			browser.tabs.find((t) => t.frame.frame.contentWindow === event.source) ||
			null;

		chromemethods[type as keyof ChromeboundMethods](tab, message).then(
			(response: any) => {
				(event.source as Window).postMessage(
					{
						$ipc$type: "response",
						$ipc$token: token,
						$ipc$message: response,
					},
					"*"
				);
			}
		);
	}
});

type ChromeboundMethods = {
	[K in keyof Chromebound]: (
		tab: Tab | null,
		arg: Chromebound[K][0]
	) => Promise<Chromebound[K][1]>;
};

const chromemethods: ChromeboundMethods = {
	titlechange: async (tab, { title, icon }) => {
		if (tab) {
			if (title) {
				tab.title = title;
				tab.history.current().title = title;
			}
			if (icon) {
				tab.icon = icon;
				tab.history.current().favicon = icon;
			}
		}
	},
	contextmenu: async (tab, msg) => {
		let offX = 0;
		let offY = 0;
		let { x, y } = tab!.frame.frame.getBoundingClientRect();
		offX += x;
		offY += y;
		createMenu(
			{ left: msg.x + offX, top: msg.y + offY },
			pageContextItems(tab!, msg)
		);
	},
	load: async (tab, { url }) => {
		if (!tab) return;
		console.log("URL", url);
		if (tab.history.justTriggeredNavigation) {
			// url bar was typed in, we triggered this navigation, don't push a new state since we already did
			tab.history.justTriggeredNavigation = false;
		} else {
			// the page just loaded on its own (a link was clicked, window.location was set)
			tab.history.push(new URL(url), undefined, false);
		}
	},

	history_go: async (tab, { delta }) => {
		if (tab) {
			console.error("hist go" + delta);
			tab.history.go(delta);
		}
	},
	history_pushState: async (tab, { url, title, state }) => {
		if (tab) {
			console.error("hist push", url);
			tab.history.push(new URL(url), title, state, false, true);
		}
	},
	history_replaceState: async (tab, { url, title, state }) => {
		if (tab) {
			tab.history.replace(new URL(url), title, state, false);
		}
	},
};
