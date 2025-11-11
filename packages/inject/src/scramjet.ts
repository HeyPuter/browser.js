import {
	CookieJar,
	iswindow,
	loadAndHook,
	SCRAMJETCLIENT,
	ScramjetClient,
	ScramjetClientInit,
	ScramjetInitConfig,
	ScramjetInterface,
	setWasm,
} from "@mercuryworkshop/scramjet";
import { FrameSequence, InjectScramjetInit } from "./types";

import LibcurlClient from "@mercuryworkshop/libcurl-transport";

export let client: ScramjetClient;
export let chromeframe: Window;

let counter = 0;
const top = self.top;
let syncPool = new Map();
let listeners = new Map();

export function loadScramjet({
	sequence,
	config,
	cookies,
	getInjectScripts,
	wisp,
	prefix,
	codecEncode,
	codecDecode,
}: InjectScramjetInit) {
	setWasm(Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0)));
	delete (self as any).WASM;

	if (iswindow) {
		chromeframe = sequence.reduce((win, idx) => win!.frames[idx], top)!;
	}
	const transport = new LibcurlClient({ wisp });

	let cookieJar = new CookieJar();
	cookieJar.load(cookies);

	loadAndHook({
		context: {
			interface: {
				getInjectScripts,
				codecEncode,
				codecDecode,
			},
			config,
			cookieJar,
			prefix: new URL(prefix),
		},
		transport,
		sendSetCookie: async (url: URL, cookie: string) => {},
	});

	client = self[SCRAMJETCLIENT];
}
