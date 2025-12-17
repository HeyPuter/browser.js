import { InjectScramjetInit } from "./types";

import { SCRAMJETCLIENT, setWasm } from "@mercuryworkshop/scramjet";
import { loadErrorPage } from "./errorpage/errorpage";
import { ExecutionContextWrapper } from "./context";

// these are the only globals that are safe to be shared
export let chromeframe: Window;
export let wasm: Uint8Array;

function $injectLoad(init: InjectScramjetInit) {
	if (SCRAMJETCLIENT in globalThis) {
		return;
	}

	if (init.sequence && !chromeframe) {
		chromeframe = init.sequence.reduce((win, idx) => win!.frames[idx], top)!;
		if (!chromeframe) {
			throw new Error(
				"Reducing InitSequence failed to yield valid frame! This is very bad."
			);
		}
	}

	if (!("WASM" in self)) {
		throw new Error("WASM not found in global scope!");
	}
	wasm = Uint8Array.from(atob(self.WASM), (c) => c.charCodeAt(0));
	delete (self as any).WASM;
	setWasm(wasm);

	const context = new ExecutionContextWrapper(self, init);
	console.log("Execution Context Created", self);
}

function $injectLoadError(init: InjectScramjetInit, errormeta) {
	loadErrorPage(errormeta);

	$injectLoad(init);
}

// @ts-expect-error
globalThis.$injectLoadError = $injectLoadError;
// @ts-expect-error
globalThis.$injectLoad = $injectLoad;
