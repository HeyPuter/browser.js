import {
	ScramjetHeaders,
	type ScramjetFetchContext,
	type ScramjetFetchResponse,
	CookieJar,
	ScramjetFetchHandler,
	rewriteUrl,
	setConfig,
	unrewriteUrl,
	type URLMeta,
	setInterface,
	type ScramjetInterface,
	type Serverbound,
} from "@mercuryworkshop/scramjet/bundled";

import scramjetWASM from "../../scramjet/packages/core/dist/scramjet.wasm.wasm?url";
import scramjetAll from "../../scramjet/packages/core/dist/scramjet.js?url";
import injectScript from "../../inject/dist/inject.js?url";
import {
	BareClient,
	type BareHeaders,
	type BareResponseFetch,
} from "@mercuryworkshop/bare-mux-custom";
import { ElementType, type Handler, Parser } from "htmlparser2";
import { type ChildNode, DomHandler, Element, Comment, Node } from "domhandler";
import * as tldts from "tldts";

import {
	iconBack,
	iconForwards,
	iconRefresh,
	iconBookmark,
	iconCode,
	iconLink,
	iconAdd,
	iconCopy,
	iconSave,
	iconSearch,
} from "./icons";

import type {
	Chromebound,
	Framebound,
	FrameSequence,
} from "../../inject/src/types";
import type { Tab } from "./Tab";
import { browser } from "./Browser";
import { createMenu } from "./components/Menu";

const ISOLATION_ORIGIN = import.meta.env.VITE_ISOLATION_ORIGIN;

import LibcurlClient from "@mercuryworkshop/libcurl-transport";

const cfg = {
	wisp: import.meta.env.VITE_WISP_URL,
	prefix: "/scramjet/",
	globals: {
		wrapfn: "$scramjet$wrap",
		wrappropertybase: "$scramjet__",
		wrappropertyfn: "$scramjet$prop",
		cleanrestfn: "$scramjet$clean",
		importfn: "$scramjet$import",
		rewritefn: "$scramjet$rewrite",
		metafn: "$scramjet$meta",
		wrappostmessagefn: "$scramjet$wrappostmessage",
		pushsourcemapfn: "$scramjet$pushsourcemap",
		trysetfn: "$scramjet$tryset",
		templocid: "$scramjet$temploc",
		tempunusedid: "$scramjet$tempunused",
	},
	flags: {
		syncxhr: false,
		strictRewrites: true,
		rewriterLogs: false,
		captureErrors: true,
		cleanErrors: false,
		scramitize: false,
		sourcemaps: true,
		destructureRewrites: false,
		allowInvalidJs: false,
		allowFailedIntercepts: false,
		antiAntiDebugger: false,
	},
	siteFlags: {},
	codec: {
		encode: `(url) => {
						if (!url) return url;

						return encodeURIComponent(url);
					}`,
		decode: `(url) => {
						if (!url) return url;

						return decodeURIComponent(url);
					}`,
	},
	maskedfiles: ["inject.js", "scramjet.wasm.js"],
};

setConfig(cfg);

// you can get to any frame by window.frames[index][index]...
// so we can encode a certain frame as a sequence of indices to reach it, and then it will be available from any other frame, even cross-origin

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

const virtualWasmPath = "/scramjet.wasm.js";
const virtualInjectPath = "/inject.js";

function base64Encode(str: string): string {
	return btoa(
		new Uint8Array(new TextEncoder().encode(str))
			.reduce(
				(data, byte) => (data.push(String.fromCharCode(byte)), data),
				[] as any
			)
			.join("")
	);
}

const getInjectScripts: ScramjetInterface["getInjectScripts"] = (
	meta,
	handler,
	config,
	cookieJar,
	script
) => {
	const injected = `
		$injectLoad({
			sequence: ${JSON.stringify(findSelfSequence(self)!)},
			config: ${JSON.stringify(config)},
			cookies: ${JSON.stringify(cookieJar.dump())},
			wisp: ${JSON.stringify(cfg.wisp)},
		});
		document.currentScript.remove();
	`;

	return [
		script(virtualWasmPath),
		script(virtualInjectPath),
		script("data:application/javascript;base64," + base64Encode(injected)),
	];
};

setInterface({
	getInjectScripts,
	getWorkerInjectScripts: (meta, js, config, type) => {
		const module = type === "module";
		let str = "";
		const script = (script: string) => {
			if (module) {
				str += `import "${script}"\n`;
			} else {
				str += `importScripts("${script}");\n`;
			}
		};

		const injectLoad = `
			$injectLoad({
				config: ${JSON.stringify(config)},
				cookies: null,
				wisp: ${JSON.stringify(cfg.wisp)},
			});
		`;
		script(virtualWasmPath);
		script(virtualInjectPath);
		script(`data:application/javascript;base64,${base64Encode(injectLoad)}`);

		return str;
	},
});
export const bare = new BareClient(
	new LibcurlClient({
		wisp: cfg.wisp,
	})
);

type Controller = {
	controllerframe: HTMLIFrameElement;
	cookieJar: CookieJar;
	fetchHandler: ScramjetFetchHandler;
	rootdomain: string;
	baseurl: URL;
	prefix: URL;
	window: Window;
	ready: Promise<void>;
	readyResolve: () => void;
};

function hashDomain(domain: string): string {
	// dbj2
	// TODO investigate possibility of collisions at some point
	let hash = 0;
	for (let i = 0; i < domain.length; i++) {
		const char = domain.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash).toString(36).substring(0, 8);
}

const controllers: Controller[] = [];

function getRootDomain(url: URL): string {
	return tldts.getDomain(url.href) || url.hostname;
}

function makeController(url: URL): Controller {
	let originurl = new URL(ISOLATION_ORIGIN);
	let baseurl = new URL(
		`${originurl.protocol}//${hashDomain(getRootDomain(url))}.${originurl.host}`
	);
	let frame = document.createElement("iframe");
	const rootdomain = getRootDomain(url);
	frame.src = baseurl.href + "controller.html";
	frame.style.display = "none";
	document.body.appendChild(frame);
	console.log("waiting for activation for " + rootdomain + " controller");

	let readyResolve;
	let ready = new Promise<void>((res) => {
		readyResolve = res;
	});

	const prefix = new URL(baseurl.protocol + baseurl.host + cfg.prefix);
	const cookieJar = new CookieJar();

	const fetchHandler = new ScramjetFetchHandler({
		client: bare,
		cookieJar,
		prefix: prefix,
		onServerbound: (type, listener) => {
			sjIpcListeners.set(type, listener);
		},
		sendClientbound: async (type, msg) => {
			// TODO: the fetchandler needs an abstracted concept of clients so it can manually decide which one to send to
			for (let tab of browser.tabs) {
				if (!tab.frame.frame.contentWindow) continue;
				const token = sjIpcCounter++;

				const recurseSend = (win: Window) => {
					win.postMessage(
						{
							$scramjetipc$type: "request",
							$scramjetipc$method: type,
							$scramjetipc$token: token,
							$scramjetipc$message: msg,
						},
						"*"
					);
					for (let i = 0; i < win.frames.length; i++) {
						recurseSend(win.frames[i]);
					}
				};

				recurseSend(tab.frame.frame.contentWindow);
			}
			return undefined;
		},
		async fetchDataUrl(dataUrl: string) {
			return (await fetch(dataUrl)) as BareResponseFetch;
		},
		async fetchBlobUrl(blobUrl: string) {
			// find a random tab under this controller
			console.log("FETCHUBG BLOB");
			const tab = browser.tabs.find(
				(tab) => tab.frame.controller === controller
			);
			if (!tab) throw new Error("No tab found for blob fetch (?)");
			const response = await sendFrame(tab, "fetchBlob", blobUrl);
			console.log("FETCHED BLOB", response);

			let headers = new Headers();
			headers.set("Content-Type", response.type);

			return new Response(response.body, {
				headers,
			}) as BareResponseFetch;
		},
	});

	const controller = {
		controllerframe: frame,
		window: frame.contentWindow!,
		rootdomain,
		baseurl,
		prefix,
		ready,
		readyResolve: readyResolve!,
		cookieJar,
		fetchHandler,
	};
	controllers.push(controller);

	return controller;
}

export class IsolatedFrame {
	frame: HTMLIFrameElement;
	controller: Controller | null = null;
	constructor() {
		this.frame = document.createElement("iframe");
	}

	async go(url: URL) {
		let controller = controllers.find((c) => {
			return c.rootdomain === getRootDomain(url);
		});

		if (!controller) {
			controller = makeController(url);
		}
		await controller.ready;
		this.controller = controller;

		const prefix = controller.prefix;

		this.frame.src = rewriteUrl(url, {
			origin: prefix, // origin/base don't matter here because we're always sending an absolute URL
			base: prefix,
			prefix,
		});
	}

	reload() {
		this.frame.contentWindow?.location.reload();
	}
}

function isDownload(
	responseHeaders: BareHeaders,
	destination: string
): boolean {
	if (["document", "iframe"].includes(destination)) {
		const header = responseHeaders["content-disposition"]?.[0];
		if (header) {
			if (header === "inline") {
				return false; // force it to show in browser
			} else {
				return true;
			}
		} else {
			// check mime type as fallback
			const displayableMimes = [
				// Text types
				"text/html",
				"text/plain",
				"text/css",
				"text/javascript",
				"text/xml",
				"application/javascript",
				"application/json",
				"application/xml",
				"application/pdf",
			];
			const contentType = responseHeaders["content-type"]?.[0]
				?.split(";")[0]
				.trim()
				.toLowerCase();
			if (
				contentType &&
				!displayableMimes.includes(contentType) &&
				!contentType.startsWith("text") &&
				!contentType.startsWith("image") &&
				!contentType.startsWith("font") &&
				!contentType.startsWith("video")
			) {
				return true;
			}
		}
	}

	return false;
}

export type RawDownload = {
	filename: string | null;
	url: string;
	type: string;
	body: BodyType;
	length: number;
};

const methods = {
	async fetch(
		data: ScramjetFetchContext,
		controller: Controller
	): Promise<[ScramjetFetchResponse, Transferable[] | undefined]> {
		// repopulate fetchcontext fields with the items that weren't cloned over postMessage
		data.cookieStore = controller.cookieJar;
		data.rawUrl = new URL(data.rawUrl);
		if (data.rawClientUrl) data.rawClientUrl = new URL(data.rawClientUrl);
		let headers = new ScramjetHeaders();
		for (let [k, v] of Object.entries(data.initialHeaders)) {
			headers.set(k, v);
		}
		data.initialHeaders = headers;

		// handle scramjet.all.js and scramjet.wasm.js requests
		if (data.rawUrl.pathname === virtualWasmPath) {
			return [await makeWasmResponse(), undefined];
		} else if (data.rawUrl.pathname === virtualInjectPath) {
			return [
				await fetch(injectScript).then(async (x) => {
					const text = await x.text();
					return {
						body: text,
						headers: { "Content-Type": "application/javascript" },
						status: 200,
						statusText: "OK",
					};
				}),
				undefined,
			];
		}

		if (data.destination === "document" || data.destination === "iframe") {
			const unrewritten = unrewriteUrl(data.rawUrl, {
				prefix: controller.prefix,
			} as URLMeta);

			// our controller is bound to a root domain
			// if a site under the controller tries to iframe a cross-site domain it needs to redirect to that different controller
			const reqrootdomain = getRootDomain(new URL(unrewritten));
			if (reqrootdomain !== controller.rootdomain) {
				let crosscontroller = controllers.find((c) => {
					return c.rootdomain === reqrootdomain;
				});

				if (!crosscontroller) {
					crosscontroller = makeController(new URL(unrewritten));
				}
				await crosscontroller.ready;

				// now send a redirect so the browser will load the request from the other controller's sw
				return [
					{
						body: "Redirecting Cross-Origin Frame Request...",
						status: 302,
						statusText: "Found",
						headers: {
							"Content-Type": "text/plain",
							Location: rewriteUrl(new URL(unrewritten), {
								origin: crosscontroller.prefix,
								base: crosscontroller.prefix,
								prefix: crosscontroller.prefix,
							}),
						},
					},
					undefined,
				];
			}
		}

		const fetchresponse = await controller.fetchHandler.handleFetch(data);

		if (
			isDownload(fetchresponse.headers, data.destination) &&
			fetchresponse.status === 200
		) {
			let filename: string | null = null;
			const disp = fetchresponse.headers["content-disposition"]?.[0];
			if (typeof disp === "string") {
				const filenameMatch = disp.match(/filename=["']?([^"';\n]*)["']?/i);
				if (filenameMatch && filenameMatch[1]) {
					filename = filenameMatch[1];
				}
			}
			const length = fetchresponse.headers["content-length"][0];

			browser.startDownload({
				filename,
				url: unrewriteUrl(data.rawUrl, { prefix: controller.prefix } as any),
				type:
					fetchresponse.headers["content-type"][0] ||
					"application/octet-stream",
				length: parseInt(length),
				body: fetchresponse.body,
			});

			// endless vortex reference
			await new Promise(() => {});
		}

		let transfer: any[] | undefined = undefined;
		if (
			fetchresponse.body instanceof ArrayBuffer ||
			fetchresponse.body instanceof ReadableStream
		) {
			transfer = [fetchresponse.body];
		}

		return [fetchresponse, transfer];
	},
};
window.addEventListener("message", async (event) => {
	let data = event.data;
	if (!(data && "$sandboxsw$type" in data)) return;
	let controller = controllers.find(
		(c) => c.controllerframe.contentWindow == event.source
	);
	if (!controller) {
		console.error("No controller found for message", data);
		return;
	}

	try {
		if (data.$sandboxsw$type == "request") {
			let domain = data.$sandboxsw$domain;
			let message = data.$sandboxsw$message;
			let token = data.$sandboxsw$token;

			let fn = (methods as any)[domain];

			let [result, transfer] = await fn(message, controller);
			controller.window.postMessage(
				{
					$sandboxsw$type: "response",
					$sandboxsw$token: token,
					$sandboxsw$message: result,
				},
				controller.baseurl.origin,
				transfer
			);
		} else if (data.$sandboxsw$type == "confirm") {
			console.log(controller.rootdomain + " controller activated");
			controller.readyResolve();
		}
	} catch (e) {
		console.log(e);
		console.error("error in response", e);
	}
});

let wasmPayload: string | null = null;

async function makeWasmResponse() {
	if (!wasmPayload) {
		const resp = await fetch(scramjetWASM);
		const buf = await resp.arrayBuffer();
		const b64 = btoa(
			new Uint8Array(buf)
				.reduce(
					(data, byte) => (data.push(String.fromCharCode(byte)), data),
					[] as any
				)
				.join("")
		);

		let payload = "";
		payload +=
			"if ('document' in self && document.currentScript) { document.currentScript.remove(); }\n";
		payload += `self.WASM = '${b64}';`;
		wasmPayload = payload;
	}

	return {
		body: wasmPayload,
		headers: { "Content-Type": "application/javascript" },
		status: 200,
		statusText: "OK",
	};
}

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

function pageContextItems(
	tab: Tab,
	{ selection, image, anchor }: Chromebound["contextmenu"][0]
) {
	if (selection && selection.toString().length > 0) {
		return [
			{
				label: "Search",
				icon: iconSearch,
				action: () => {
					const query = selection.toString();
					if (query) {
						tab.pushNavigate(
							new URL(
								`https://www.google.com/search?q=${encodeURIComponent(query)}`
							)
						);
					}
				},
			},
			{
				label: "Copy",
				icon: iconCopy,
				action: () => {
					navigator.clipboard.writeText(selection.toString());
				},
			},
		];
	}

	if (image) {
		return [
			{
				label: "Open Image in New Tab",
				action: () => {
					// TODO: this is broken lol
					if (image.src) {
						let newTab = browser.newTab();
						newTab.pushNavigate(new URL(image.src));
					}
				},
			},
			{
				label: "Copy Image URL",
				action: () => {
					navigator.clipboard.writeText(image.src);
				},
			},
			{
				label: "Copy Image",
				action: () => {
					// copyImageToClipboard(target);
				},
			},
			{
				label: "Save Image As...",
				action: () => {
					// TODO
				},
			},
		];
	} else if (anchor) {
		return [
			{
				label: "Open Link",
				action: () => {
					if (anchor.href) {
						browser.activetab.pushNavigate(new URL(anchor.href));
					}
				},
				icon: iconLink,
			},
			{
				label: "Open Link in New Tab",
				action: () => {
					if (anchor.href) {
						browser.newTab(new URL(anchor.href));
					}
				},
				icon: iconAdd,
			},
			{
				label: "Copy Link Address",
				action: () => {
					navigator.clipboard.writeText(anchor.href);
				},
				icon: iconCopy,
			},
			{
				label: "Save Link As...",
				action: () => {
					// TODO
				},
				icon: iconSave,
			},
		];
	}

	return [
		{
			label: "Back",
			action: () => {
				tab.back();
			},
			icon: iconBack,
		},
		{
			label: "Forward",
			action: () => {
				tab.forward();
			},
			icon: iconForwards,
		},
		{
			label: "Reload",
			action: () => {
				tab.reload();
			},
			icon: iconRefresh,
		},
		{
			label: "Bookmark",
			action: () => {
				// TODO:
				console.log("Bookmarking", tab.title, tab.url);
			},
			icon: iconBookmark,
		},
		{
			label: "Inspect",
			action: () => {
				tab.devtoolsOpen = true;
				// if (e.target) requestInspectElement([e.target as HTMLElement, tab]);
			},
			icon: iconCode,
		},
	];
}
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
