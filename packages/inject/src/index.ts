import { InjectScramjetInit } from "./types";

import { SCRAMJETCLIENT } from "@mercuryworkshop/scramjet";
import { loadErrorPage } from "./errorpage/errorpage";
import { ExecutionContextWrapper } from "./context";

// this is the only global that's safe to be shared
export let chromeframe: Window;

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
