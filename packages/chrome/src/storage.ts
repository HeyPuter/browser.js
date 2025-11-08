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

setInterval(() => {
	if (dirty) {
		saveBrowserState();
		dirty = false;
	}
}, 5000);

window.addEventListener("beforeunload", (e) => {
	if (dirty) {
		e.preventDefault();
		e.returnValue = "";
	}
});
