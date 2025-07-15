/// <reference types="@rspack/core/module" />

export function $scramjetLoadController() {
	return require("./controller/index");
}

export function $scramjetLoadClient() {
	const client = require("./client/index");
	client.clientInitHook();

	return client;
}

export function $scramjetLoadWorker() {
	return require("./worker/index");
}

export const $scramjet = {
	version: {
		build: COMMITHASH,
		version: VERSION,
	},
};

if ("document" in self && document?.currentScript) {
	document.currentScript.remove();
}
