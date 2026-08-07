import { ScramjetClient } from "@client/index";

export default function (client: ScramjetClient) {
	client.Intercept(
		"Navigator",
		class extends Navigator {
			sendBeacon(url: string | URL, data?: BodyInit | null): boolean {
				return super.sendBeacon(client.rewriteUrl(url));
			}
			// protocol handlers will not work out of the box since there's no guarantee the service worker will be set up
			// or any other expectations that the user agent might need
			// sites can set this up themselves if they want to
			registerProtocolHandler(scheme: string, url: string | URL): void {}
			unregisterProtocolHandler(scheme: string, url: string | URL): void {}
		}
	);
}
