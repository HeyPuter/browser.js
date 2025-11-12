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
		</script>
		<style>
			:root {
				--font: "Inter", system-ui, sans-serif;
				--bg: ${theme.tokens.ntp_background};
				--text: ${theme.tokens.ntp_text};
				--muted: color-mix(in srgb, ${theme.tokens.ntp_text} 55%, transparent);
				--accent: ${theme.tokens.tab_line};
				--button-bg: ${theme.tokens.tab_line};
				--button-text: ${theme.tokens.ntp_background};
			}
			html,body{height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--font);overflow:hidden;}
			.wrapper{
				height:100%;
				display:flex;
				align-items:flex-start;
				justify-content:center;
				padding:120px 20px 20px 20px;
				overflow:auto;
			}

			.errpage{
				max-width:920px;
				width:100%;
				display:flex;
				flex-direction:row;
				gap:28px;
				align-items:flex-start;
			}

			.err-graphic{
				flex:0 0 120px;
				display:flex;
				align-items:center;
				justify-content:center;
			}
			.err-graphic .face{
				width:96px;
				height:96px;
				border-radius:12px;
				display:flex;
				align-items:center;
				justify-content:center;
				background:transparent;
				border:4px solid var(--muted);
				color:var(--muted);
				font-size:44px;
				line-height:1;
			}

			.err-main{
				flex:1 1 auto;
			}
			.err-title{
				font-size:28px;
				font-weight:600;
				margin:0 0 8px 0;
				color:var(--text);
			}
			.err-sub{
				margin:0 0 18px 0;
				color:var(--muted);
				font-size:14px;
			}

			.controls{
				display:flex;
				gap:12px;
				align-items:center;
				flex-wrap:wrap;
				margin-bottom:14px;
			}
			.btn{
				padding:10px 16px;
				border-radius:8px;
				font-weight:600;
				border:none;
				cursor:pointer;
				font-size:14px;
			}
			.btn-primary{
				background:var(--button-bg);
				color:var(--button-text);
				box-shadow:0 2px 0 rgba(0,0,0,0.06);
			}
			.btn-link{
				background:transparent;
				color:var(--muted);
				border:1px solid transparent;
			}
			.details{
				margin-top:8px;
				background:transparent;
				border:1px dashed color-mix(in srgb, var(--muted) 22%, transparent);
				padding:10px;
				border-radius:6px;
				font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", monospace;
				font-size:12px;
				color:var(--muted);
				max-height:260px;
				overflow:auto;
				white-space:pre-wrap;
			}

			.suggestions{
				margin-top:12px;
				color:var(--muted);
				font-size:13px;
			}

			@media (max-width:720px){
				.errpage{flex-direction:column;align-items:center;text-align:center;}
				.err-graphic{order:0;}
				.err-main{order:1;width:100%;}
			}
		</style>

		<body>
			<div class="wrapper" role="main" aria-labelledby="errTitle">
				<div class="errpage" role="alert" aria-live="polite">
					<div class="err-graphic" aria-hidden="true">
						<div class="face">:(</div>
					</div>

					<div class="err-main">
						<h1 id="errTitle" class="err-title">This page can&#39;t be loaded</h1>
						<p class="err-sub">The page at this address could not be loaded. This might be due to a network issue or the server being unreachable.</p>

						<div class="controls">
							<button class="btn btn-primary" id="reloadBtn">Reload</button>
							<button class="btn btn-link" id="toggleBtn">Show details</button>
							<button class="btn btn-link" id="copyBtn">Copy details</button>
						</div>
						<pre id="details" class="details" style="display:none;">${escapeHtml((error.stack || error.message) as any)}</pre>

						<p class="suggestions">Try checking your connection, or try again later. If you believe this is a problem with the browser, try disabling extensions.</p>
					</div>
				</div>
			</div>

			<script>
				reloadBtn.addEventListener('click', ()=> location.reload());
				toggleBtn.addEventListener('click', function(){
					if(details.style.display === 'none'){
						details.style.display = 'block';
						toggleBtn.textContent = 'Hide details';
					} else {
						details.style.display = 'none';
						toggleBtn.textContent = 'Show details';
					}
				});

				copyBtn.addEventListener('click', function(){
					const text = ${JSON.stringify((error.stack || error.message) as any)};
					const textarea = document.createElement('textarea');
					textarea.value = text;
					textarea.style.position = 'fixed';
					textarea.style.opacity = '0';
					document.body.appendChild(textarea);
					textarea.select();
					document.execCommand('copy');
					document.body.removeChild(textarea);

					const originalText = copyBtn.textContent;
					copyBtn.textContent = 'Copied!';
					setTimeout(() => {
						copyBtn.textContent = originalText;
					}, 2000);
				});
			</script>
		</body>
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
					console.log("sending to " + context.id, context.windowproxy);
					promises.push(
						context.rpc.call("setCookie", {
							url: url.href,
							cookie,
						})
					);
				}
			}
			if (promises.length === 0) return;
			console.log("actually sent");

			// a context could be deadlocked, so add a safety
			await Promise.race([
				new Promise((res) =>
					setTimeout(() => {
						console.error("a context deadlocked! hit timeout");
						res(null);
					}, 1000)
				),
				Promise.all(promises),
			]);
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
	console.log(data.rawUrl);
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
