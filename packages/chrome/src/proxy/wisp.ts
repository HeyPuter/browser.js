import {
	BareCompatibleClient,
	type ProxyTransport,
} from "@mercuryworkshop/proxy-transports";
import LibcurlClient from "@mercuryworkshop/libcurl-transport";

export let bare: BareCompatibleClient;
export let transport: ProxyTransport;
export let wispUrl: string;

export function setWispUrl(wispurl: string) {
	wispUrl = wispurl;

	transport = new LibcurlClient({
		wisp: wispurl,
	});
	bare = new BareCompatibleClient(transport);
}

// if (import.meta.env.VITE_WISP_URL) {
// 	setWispUrl(import.meta.env.VITE_WISP_URL);
// }
