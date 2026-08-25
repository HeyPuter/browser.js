import {
	String_indexOf,
	String_split,
	String_substring,
	String_toLowerCase,
} from "@/shared/snapshot";
import { carriedHeaderName, uncarriedHeaderName } from "@/shared/headers";
import { ScramjetClient } from "@client/client";
import { Arguments, Returns, Type } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	client.Intercept(class extends XMLHttpRequest {
		@Arguments("ByteString", "USVString")
		open(method: string, url: string) {
			const rewritten = client.rewriteUrl(url);
			return super.open(method, rewritten, true);
		}

		@Type("USVString")
		get responseURL() {
			return client.unrewriteUrl(super.responseURL);
		}

		@Returns("ByteString?")
		@Arguments("ByteString")
		getResponseHeader(name: string): string | null {
			return super.getResponseHeader(carriedHeaderName(name));
		}

		@Returns("ByteString")
		@Arguments()
		getAllResponseHeaders(): string {
			const raw = super.getAllResponseHeaders();
			if (!raw) return raw;

			const restored: string[] = [];
			const lines = String_split(raw, "\r\n");

			for (let i = 0; i < lines.length; i++) {
				const colon = String_indexOf(lines[i], ":");
				if (colon === -1) continue;

				const name = uncarriedHeaderName(String_substring(lines[i], 0, colon));
				if (name === null) continue;

				// the value keeps the separator and its leading space verbatim
				restored[restored.length] =
					String_toLowerCase(name) + String_substring(lines[i], colon);
			}

			// a carrier sorts under `x-`, and the name it stands for almost never
			// does, so the list has to be re-sorted rather than filtered in place
			restored.sort();

			return restored.length ? restored.join("\r\n") + "\r\n" : "";
		}
	});
}
