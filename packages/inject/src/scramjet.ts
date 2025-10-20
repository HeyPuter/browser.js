import {
	loadAndHook,
	SCRAMJETCLIENT,
	ScramjetClient,
	ScramjetClientEntryInit,
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
}: InjectScramjetInit) {
	setWasm(Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0)));
	delete (self as any).WASM;

	chromeframe = sequence.reduce((win, idx) => win!.frames[idx], top)!;
	const transport = new LibcurlClient({ wisp });

	addEventListener("message", async (e) => {
		if (typeof e.data != "object" || !("$scramjetipc$type" in e.data)) return;
		const type = e.data.$scramjetipc$type;
		if (type === "response") {
			const token = e.data.$scramjetipc$token;
			const message = e.data.$scramjetipc$message;

			const cb = syncPool.get(token);
			if (cb) {
				cb(message);
				syncPool.delete(token);
			}
		} else if (type === "request") {
			const method = e.data.$scramjetipc$method;
			const message = e.data.$scramjetipc$message;
			const token = e.data.$scramjetipc$token;

			const fn = listeners.get(method);
			if (fn) {
				const response = await fn(message);
				e.source!.postMessage({
					$scramjetipc$type: "response",
					$scramjetipc$token: token,
					$scramjetipc$message: response,
				});
			} else {
				console.error("Unknown scramjet ipc clientbound method", method);
			}
		}
	});

	loadAndHook({
		interface: {
			getInjectScripts,
			onClientbound: function (type, callback) {
				listeners.set(type, callback);
			},
			sendServerbound: async function (type, msg) {
				const token = counter++;
				chromeframe.postMessage(
					{
						$scramjetipc$type: "request",
						$scramjetipc$method: type,
						$scramjetipc$token: token,
						$scramjetipc$message: msg,
					},
					"*"
				);

				return new Promise((res) => {
					syncPool.set(token, res);
				});
			},
		},
		config,
		cookies,
		transport,
	});

	client = self[SCRAMJETCLIENT];
}
