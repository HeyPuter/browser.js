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

import scramjetWASM from "../../../scramjet/packages/core/dist/scramjet.wasm.wasm?url";
import injectScript from "../../../inject/dist/inject.js?url";

import { browser } from "../Browser";
export const virtualWasmPath = "scramjet.wasm.js";
export const virtualInjectPath = "inject.js";

function makeConfig(): ScramjetConfig {
	return {
		...defaultConfig,
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

import type { FrameSequence } from "../../../inject/src/types";
import { bare, wispUrl } from "./wisp";
import { codecDecode, codecEncode } from "./codec";
import { controllerForURL, type Controller } from "./Controller";
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

export function createFetchHandler(controller: Controller) {
	const getInjectScripts: ScramjetInterface["getInjectScripts"] = (
		meta,
		handler,
		script
	) => {
		const injected = `
				$injectLoad({
					sequence: ${JSON.stringify(findSelfSequence(self)!)},
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
		js,
		type
	) => {
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
					config: ${JSON.stringify(makeConfig())},
					cookies: null,
					wisp: ${JSON.stringify(wispUrl)},
				});
			`;
		script(controller.prefix.href + virtualWasmPath);
		script(controller.prefix.href + virtualInjectPath);
		script(`data:application/javascript;base64,${base64Encode(injectLoad)}`);

		return str;
	};

	const fetchHandler = new ScramjetFetchHandler({
		client: bare,
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
		onServerbound: (type, listener) => {
			// sjIpcListeners.set(type, listener);
		},
		sendClientbound: async (type, msg) => {
			// // TODO: the fetchandler needs an abstracted concept of clients so it can manually decide which one to send to
			// for (let tab of browser.tabs) {
			// 	if (!tab.frame.frame.contentWindow) continue;
			// 	const token = sjIpcCounter++;
			// 	const recurseSend = (win: Window) => {
			// 		win.postMessage(
			// 			{
			// 				$scramjetipc$type: "request",
			// 				$scramjetipc$method: type,
			// 				$scramjetipc$token: token,
			// 				$scramjetipc$message: msg,
			// 			},
			// 			"*"
			// 		);
			// 		for (let i = 0; i < win.frames.length; i++) {
			// 			recurseSend(win.frames[i]);
			// 		}
			// 	};
			// 	recurseSend(tab.frame.frame.contentWindow);
			// }
			// return undefined;
		},
		async fetchDataUrl(dataUrl: string) {
			return (await fetch(dataUrl)) as BareResponseFetch;
		},
		async fetchBlobUrl(blobUrl: string) {
			// find a random tab under this controller
			// console.log("FETCHUBG BLOB");
			// const tab = browser.tabs.find(
			// 	(tab) => tab.frame.controller === controller
			// );
			// if (!tab) throw new Error("No tab found for blob fetch (?)");
			// const response = await sendFrame(tab, "fetchBlob", blobUrl);
			// console.log("FETCHED BLOB", response);
			// let headers = new Headers();
			// headers.set("Content-Type", response.contentType);
			// return new Response(response.body, {
			// 	headers,
			// }) as BareResponseFetch;
		},
	});

	return fetchHandler;
}

import type { BareHeaders } from "@mercuryworkshop/bare-mux-custom";

let wasmPayload: string | null = null;

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
	// repopulate fetchcontext fields with the items that weren't cloned over postMessage

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
