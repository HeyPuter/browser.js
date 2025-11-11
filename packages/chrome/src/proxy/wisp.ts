import {
	BareClient,
	type BareTransport,
} from "@mercuryworkshop/bare-mux-custom";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";

export let bare: BareClient;
export let transport: BareTransport;
export let wispUrl: string;

export function setWispUrl(wispurl: string) {
	wispUrl = wispurl;

	transport = new LibcurlClient({
		wisp: wispurl,
	});
	bare = new BareClient(transport);
}

// if (import.meta.env.VITE_WISP_URL) {
// 	setWispUrl(import.meta.env.VITE_WISP_URL);
// }
