import {
	CookieJar,
	iswindow,
	SCRAMJETCLIENT,
	ScramjetClient,
	setWasm,
} from "@mercuryworkshop/scramjet";
import { FrameSequence, InjectScramjetInit } from "./types";

import LibcurlClient from "@mercuryworkshop/libcurl-transport";
import { cookieJar } from ".";

export let client: ScramjetClient;

const top = self.top;

export function loadScramjet({
	config,
	getInjectScripts,
	wisp,
	prefix,
	codecEncode,
	codecDecode,
}: InjectScramjetInit) {
	setWasm(Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0)));
	delete (self as any).WASM;

	const transport = new LibcurlClient({ wisp });

	if (SCRAMJETCLIENT in self) return;

	client = new ScramjetClient(globalThis, {
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
	client.hook();
}
