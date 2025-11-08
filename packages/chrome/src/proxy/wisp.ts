import { BareClient } from "@mercuryworkshop/bare-mux-custom";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";

export let bare: BareClient;
export let wispUrl: string;

export function setWispUrl(wispurl: string) {
	wispUrl = wispurl;

	bare = new BareClient(
		new LibcurlClient({
			wisp: wispurl,
		})
	);
}

// if (import.meta.env.VITE_WISP_URL) {
// 	setWispUrl(import.meta.env.VITE_WISP_URL);
// }
