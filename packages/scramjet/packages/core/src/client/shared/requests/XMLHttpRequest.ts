import {
	String_split,
	String_startsWith,
	String_toLowerCase,
} from "@/shared/snapshot";
import { ScramjetClient } from "@client/client";
import { Arguments, Returns, Type } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	client.Intercept(
		"XMLHttpRequest",
		class extends XMLHttpRequest {
			@Arguments("ByteString", "USVString")
			open(method: string, url: string) {
				const rewritten = client.rewriteUrl(url);
				return super.open(method, rewritten, true);
			}

			@Type("USVString")
			get responseURL() {
				return client.rewriteUrl(super.responseURL);
			}

			@Returns("ByteString?")
			@Arguments("ByteString")
			getResponseHeader(name: string): string | null {
				const value = super.getResponseHeader(name);
				if (value === null) return null;
				if (name.toLowerCase() === "link") {
					return client.unrewriteUrl(value);
				}
				return value;
			}

			@Returns("ByteString")
			@Arguments("ByteString")
			getAllResponseHeaders(): string {
				const headerstring = super.getAllResponseHeaders();
				if (!headerstring) return headerstring;
				const headers = String_split(headerstring, "\r\n");

				for (const i in headers) {
					const header = headers[i];
					if (String_startsWith(String_toLowerCase(header), "link:")) {
						headers[i] = `Link: ${unrewriteLinkHeader(
							header.slice(5).trim(),
							client.context
						)}`;
					}
				}

				return headers.join("\r\n");
			}
		}
	);
}

export function unrewriteLinkHeader(header: string, context: ScramjetContext) {
	return header.replace(
		/<([^>]+)>/gi,
		(_match, p1) => `<${unrewriteUrl(p1, context)}>`
	);
}
