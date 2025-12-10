import {
	CookieJar,
	defaultConfig,
	ScramjetFetchHandler,
	type ScramjetConfig,
	type ScramjetFetchRequest,
	type ScramjetInterface,
	unrewriteUrl,
	type ScramjetFetchResponse,
	rewriteUrl,
} from "@mercuryworkshop/scramjet/bundled";
import type {
	BareHeaders,
	BareResponseFetch,
} from "@mercuryworkshop/bare-mux-custom";
import { RpcHelper } from "@mercuryworkshop/rpc";

import scramjetWASM from "../../../scramjet/packages/core/dist/scramjet.wasm.wasm?url";
import injectScript from "../../../inject/dist/inject.js?url";

import { browser } from "../Browser";
export const virtualWasmPath = "scramjet.wasm.js";
export const virtualInjectPath = "inject.js";

function makeConfig(): ScramjetConfig {
	return {
		...defaultConfig,
		flags: {
			...defaultConfig.flags,
			captureErrors: false,
		},
		maskedfiles: ["inject.js", "scramjet.wasm.js"],
		allowedwebsockets: [import.meta.env.VITE_WISP_URL],
	};
}

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

import type {
	Chromebound,
	Framebound,
	FrameSequence,
} from "../../../inject/src/types";
import { bare, transport, wispUrl } from "./wisp";
import { codecDecode, codecEncode } from "./codec";
import { Controller, controllerForURL, makeId } from "./Controller";
import type { Tab } from "../Tab";
import { createMenu } from "../components/Menu";
import { pageContextItems } from "./contextitems";
import type { BodyType } from "../../../scramjet/packages/controller/src/types";
import { getTheme } from "../themes";
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

function reduceSequence(sequence: FrameSequence): Window | null {
	return sequence.reduce<Window | null>((win, idx) => {
		if (!win) return null;
		return win.frames[idx];
	}, self.top);
}

class ProxyFrameContext {
	rpc: RpcHelper<Chromebound, Framebound>;
	windowproxy: Window | null = null;
	constructor(
		public controller: Controller,
		public id: string
	) {
		let tab: Tab | null = null;
		this.rpc = new RpcHelper(
			{
				load: async ({ url, sequence }) => {
					this.windowproxy = reduceSequence(sequence);
					console.log("WP" + id, this.windowproxy);
					tab =
						browser.tabs.find(
							(t) => t.frame.frame.contentWindow === this.windowproxy
						) || null;
					if (!tab) return;

					console.log("TAB FOUND", url);
					if (tab.history.justTriggeredNavigation) {
						// url bar was typed in, we triggered this navigation, don't push a new state since we already did
						tab.history.justTriggeredNavigation = false;
					} else {
						// the page just loaded on its own (a link was clicked, window.location was set)
						tab.history.push(new URL(url), undefined, false);
					}
					tab.initialLoad();
				},
				titlechange: async ({ title, icon }) => {
					if (!tab) return;
					if (title) {
						tab.title = title;
						tab.history.current().title = title;
					}
					if (icon) {
						tab.icon = icon;
						tab.history.current().favicon = icon;
					}
				},
				contextmenu: async (msg) => {
					if (!tab) return;

					let offX = 0;
					let offY = 0;
					let { x, y } = tab!.frame.frame.getBoundingClientRect();
					offX += x;
					offY += y;
					createMenu(
						{ left: msg.x + offX, top: msg.y + offY },
						pageContextItems(tab, msg)
					);
				},
				history_go: async ({ delta }) => {
					if (tab) {
						console.error("hist go" + delta);
						tab.history.go(delta);
					}
				},
				history_pushState: async ({ url, title, state }) => {
					if (tab) {
						console.error("hist push", url);
						tab.history.push(new URL(url), title, state, false, true);
					}
				},
				history_replaceState: async ({ url, title, state }) => {
					if (tab) {
						tab.history.replace(new URL(url), title, state, false);
					}
				},
			},
			id,
			(message, transfer) => {
				if (this.windowproxy) {
					this.windowproxy.postMessage(message, "*", transfer);
				} else {
					console.warn("No window proxy available for frame context", this.id);
				}
			}
		);
		addEventListener("message", (event) => {
			this.rpc.recieve(event.data);
		});
	}

	alive(): boolean {
		// the windowproxy *object* will still exist, so we need to check if there's still a path to it
		return findSequence(top!, this.windowproxy!) !== null;
	}
}

export let contexts: ProxyFrameContext[] = [];
window.contexts = contexts;
function escapeHtml(text: string): string {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

export function renderErrorPage(controller: Controller, error: Error): string {
	const contextId = "context-" + makeId();
	let frameContext = new ProxyFrameContext(controller, contextId);
	contexts.push(frameContext);

	const theme = getTheme(browser.settings.themeId);

	return `
		<script src="${controller.prefix.href}${virtualWasmPath}"></script>
		<script src="${controller.prefix.href}${virtualInjectPath}"></script>
		<script>
			$injectLoadError({
				id: "${contextId}",
				sequence: ${JSON.stringify(findSequence(top!, self)!)},
				config: ${JSON.stringify(makeConfig())},
				cookies: ${JSON.stringify(browser.cookieJar.dump())},
				wisp: ${JSON.stringify(wispUrl)},
				codecEncode: ${codecEncode.toString()},
				codecDecode: ${codecDecode.toString()},
				prefix: "${controller.prefix.href}",
			}, {
				message: ${JSON.stringify(error.message)},
				stack: ${JSON.stringify(error.stack)},
				theme: ${JSON.stringify(theme)},
			});
			document.currentScript.remove();
		</script>
	`;
}

export function createFetchHandler(controller: Controller) {
	const getInjectScripts: ScramjetInterface["getInjectScripts"] = (
		meta,
		handler,
		script
	) => {
		const contextId = "context-" + makeId();
		let frameContext = new ProxyFrameContext(controller, contextId);
		contexts.push(frameContext);

		const injected = `
			$injectLoad({
				id: "${contextId}",
				sequence: ${JSON.stringify(findSequence(top!, self)!)},
				config: ${JSON.stringify(makeConfig())},
				cookies: ${JSON.stringify(browser.cookieJar.dump())},
				wisp: ${JSON.stringify(wispUrl)},
				codecEncode: ${codecEncode.toString()},
				codecDecode: ${codecDecode.toString()},
				prefix: "${controller.prefix.href}",
			});
			document.currentScript.remove();
		`;

		return [
			script(controller.prefix.href + virtualWasmPath),
			script(controller.prefix.href + virtualInjectPath),
			script("data:application/javascript;base64," + base64Encode(injected)),
		];
	};

	const getWorkerInjectScripts: ScramjetInterface["getWorkerInjectScripts"] = (
		meta,
		type,
		script
	) => {
		let str = "";

		const injectLoad = `
				$injectLoad({
					config: ${JSON.stringify(makeConfig())},
					cookies: null,
					wisp: ${JSON.stringify(wispUrl)},
					codecEncode: ${codecEncode.toString()},
					codecDecode: ${codecDecode.toString()},
					prefix: "${controller.prefix.href}",
				});
			`;
		str += script(controller.prefix.href + virtualWasmPath);
		str += script(controller.prefix.href + virtualInjectPath);
		str += script(
			`data:application/javascript;base64,${base64Encode(injectLoad)}`
		);

		return str;
	};

	const fetchHandler = new ScramjetFetchHandler({
		transport: transport,
		context: {
			interface: {
				getInjectScripts,
				getWorkerInjectScripts,
				codecEncode,
				codecDecode,
			},
			cookieJar: browser.cookieJar,
			config: makeConfig(),
			prefix: controller.prefix,
		},
		async fetchDataUrl(dataUrl: string) {
			return (await fetch(dataUrl)) as BareResponseFetch;
		},
		async fetchBlobUrl(blobUrl: string) {
			// find a random tab under this controller
			const tab = browser.tabs.find(
				(tab) => tab.frame.controller === controller
			);
			if (!tab) throw new Error("No tab found for blob fetch (?)");
			let framewindowproxy = tab.frame.frame.contentWindow;
			if (!framewindowproxy)
				throw new Error("No frame window proxy for blob fetch");
			// find the context for this proxy
			const context = contexts.find(
				(ctx) => ctx.windowproxy === framewindowproxy
			);
			if (!context) throw new Error("No context found for blob fetch");

			const response = await context.rpc.call("fetchBlob", blobUrl);

			console.log("FETCHED BLOB", response);
			let headers = new Headers();
			headers.set("Content-Type", response.contentType);
			return new Response(response.body, {
				headers,
			}) as BareResponseFetch;
		},
		async sendSetCookie(url: URL, cookie: string) {
			let promises: Promise<any>[] = [];
			for (const context of contexts) {
				if (context.alive()) {
					// console.log("sending to " + context.id, context.windowproxy);
					promises.push(
						context.rpc.call("setCookie", {
							url: url.href,
							cookie,
						})
					);
				}
			}
			if (promises.length === 0) return;
			// console.log("actually sent");

			// a context could be deadlocked, so add a safety
			// await Promise.race([
			// 	new Promise((res) =>
			// 		setTimeout(() => {
			// 			console.error("a context deadlocked! hit timeout");
			// 			res(null);
			// 		}, 1000)
			// 	),
			// 	Promise.all(promises),
			// ]);
		},
	});

	return fetchHandler;
}

let wasmPayload: string | null = null;

export type RawDownload = {
	filename: string | null;
	url: string;
	type: string;
	body: BodyType;
	length: number;
};
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

export async function handlefetch(
	data: ScramjetFetchRequest,
	controller: Controller
): Promise<ScramjetFetchResponse> {
	// handle scramjet.all.js and scramjet.wasm.js requests
	if (data.rawUrl.pathname === controller.prefix.pathname + virtualWasmPath) {
		return await makeWasmResponse();
	} else if (
		data.rawUrl.pathname ===
		controller.prefix.pathname + virtualInjectPath
	) {
		return await fetch(injectScript).then(async (x) => {
			const text = await x.text();
			return {
				body: text,
				headers: { "Content-Type": "application/javascript" },
				status: 200,
				statusText: "OK",
			};
		});
	}

	if (data.destination === "document" || data.destination === "iframe") {
		const unrewritten = unrewriteUrl(
			data.rawUrl,
			controller.fetchHandler.context
		);

		// our controller is bound to a root domain
		// if a site under the controller tries to iframe a cross-site domain it needs to redirect to that different controller
		const newcontroller = await controllerForURL(new URL(unrewritten));
		if (controller !== newcontroller) {
			// then send a redirect so the browser will load the request from the other controller's sw
			return {
				body: "Redirecting Cross-Origin Frame Request...",
				status: 302,
				statusText: "Found",
				headers: {
					"Content-Type": "text/plain",
					Location: rewriteUrl(
						new URL(unrewritten),
						newcontroller.fetchHandler.context,
						{
							origin: newcontroller.prefix,
							base: newcontroller.prefix,
						}
					),
				},
			};
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
				fetchresponse.headers["content-type"][0] || "application/octet-stream",
			length: parseInt(length),
			body: fetchresponse.body,
		});

		// endless vortex reference
		await new Promise(() => {});
	}

	return fetchresponse;
}
