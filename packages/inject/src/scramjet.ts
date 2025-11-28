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

	if (SCRAMJETCLIENT in globalThis) {
		//@ts-expect-error god bless america
		client = globalThis[SCRAMJETCLIENT];
		return;
	}

	const transport = new LibcurlClient({ wisp });

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
		shouldPassthroughWebsocket: (url) => {
			return url === wisp;
		},
		sendSetCookie: async (url: URL, cookie: string) => {},
	});
	client.hook();
}
