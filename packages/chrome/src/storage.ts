import { browser, browserLoaded } from "./Browser";

let dirty = false;
export function markDirty() {
	dirty = true;
}

async function saveBrowserState() {
	if (!browserLoaded) return;

	let ser = browser.serialize();

	if (import.meta.env.VITE_PUTER_BRANDING) {
		await puter.kv.set("browserstate", JSON.stringify(ser));
	} else {
		localStorage["browserstate"] = JSON.stringify(ser);
	}
}

export async function getSerializedBrowserState(): Promise<string | null> {
	if (import.meta.env.VITE_PUTER_BRANDING) {
		return await puter.kv.get("browserstate");
	} else {
		return localStorage["browserstate"];
	}
}

setInterval(async () => {
	if (dirty) {
		await saveBrowserState();
		dirty = false;
	}
}, 3000);

// just in case
setInterval(async () => {
	await saveBrowserState();
	dirty = false;
}, 10000);

window.addEventListener("beforeunload", (e) => {
	if (dirty) {
		e.preventDefault();
		e.returnValue = "";
	}
});
