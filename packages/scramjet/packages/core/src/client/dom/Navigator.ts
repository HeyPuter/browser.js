import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";

export default function (client: ScramjetClient) {
	client.Intercept(
		class extends Navigator {
			@Arguments("USVString", "optional BodyInit?")
			@Returns("boolean")
			sendBeacon(url: string, data?: BodyInit | null): boolean {
				return super.sendBeacon(client.rewriteUrl(url), data);
			}

			// protocol handlers will not work out of the box since there's no guarantee the service worker will be set up
			// or any other expectations that the user agent might need
			// sites can set this up themselves if they want to
			@Arguments("DOMString", "USVString")
			@Returns("undefined")
			registerProtocolHandler(_scheme: string, _url: string): void {}

			@Arguments("DOMString", "USVString")
			@Returns("undefined")
			unregisterProtocolHandler(_scheme: string, _url: string): void {}
		}
	);
}
