import chobitsu from "chobitsu";
import * as h2 from "html-to-image";
import {
	Chromebound,
	Framebound,
	FrameSequence,
	InjectScramjetInit,
} from "./types";
import type { ThemeDefinition } from "../../chrome/src/themes";

import { CookieJar, iswindow, ScramjetClient } from "@mercuryworkshop/scramjet";
import { setupTitleWatcher } from "./titlewatcher";
import { setupContextMenu } from "./contextmenu";
import { setupHistoryEmulation } from "./history";
import { client, loadScramjet } from "./scramjet";
import { MethodsDefinition, RpcHelper } from "@mercuryworkshop/rpc";

//@ts-expect-error
import rawErrorHtml from "./errorpage.html";
//@ts-expect-error
import rawErrorCss from "./errorpage.css";

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
	async setCookie({ url, cookie }) {
		cookieJar.setCookies([cookie], new URL(url));
	},
	async updateTheme(theme) {
		applyTheme(theme);
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

function $injectLoad(init: InjectScramjetInit) {
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
}

let themeStyle: HTMLStyleElement;
export function applyTheme(theme: ThemeDefinition) {
	themeStyle.innerHTML = `:root {
		--font: "Inter", system-ui, sans-serif;
		--bg: ${theme.tokens.ntp_background};
		--text: ${theme.tokens.ntp_text};
		--muted: color-mix(in srgb, ${theme.tokens.ntp_text} 55%, transparent);
		--accent: ${theme.tokens.tab_line};
		--button-bg: ${theme.tokens.tab_line};
		--button-text: ${theme.tokens.ntp_background};
	}`;
}

function $injectLoadError(
	init: InjectScramjetInit,
	errormeta: {
		message: string;
		stack: string;
		theme: ThemeDefinition;
	}
) {
	let initialStyle = document.createElement("style");
	initialStyle.innerHTML = rawErrorCss;
	document.head.appendChild(initialStyle);

	themeStyle = document.createElement("style");
	document.head.appendChild(themeStyle);
	applyTheme(errormeta.theme);

	document.open();
	document.write(rawErrorHtml);
	document.close();

	let reloadBtn = document.getElementById("reloadBtn")!;
	let toggleBtn = document.getElementById("toggleBtn")!;
	let details = document.getElementById("details")!;
	let copyBtn = document.getElementById("copyBtn")!;
	let errorMessage = document.getElementById("errorMessage")!;

	reloadBtn.addEventListener("click", () => location.reload());

	let error = `Error: ${errormeta.message}\n\n${errormeta.stack}`;

	errorMessage.innerText = errormeta.message;
	details.innerText = errormeta.stack;
	toggleBtn.addEventListener("click", () => {
		if (details.style.display === "none") {
			details.style.display = "block";
			toggleBtn.textContent = "Hide details";
		} else {
			details.style.display = "none";
			toggleBtn.textContent = "Show details";
		}
	});

	copyBtn.addEventListener("click", () => {
		const text = error;
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		document.body.removeChild(textarea);

		const originalText = copyBtn.textContent;
		copyBtn.textContent = "Copied!";
		setTimeout(() => {
			copyBtn.textContent = originalText;
		}, 2000);
	});

	$injectLoad(init);
}

// @ts-expect-error
globalThis.$injectLoadError = $injectLoadError;
// @ts-expect-error
globalThis.$injectLoad = $injectLoad;
