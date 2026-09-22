import {
	Array_join,
	Array_sort,
	String_indexOf,
	String_split,
	String_startsWith,
	String_substring,
	String_toLowerCase,
} from "@/shared/snapshot";
import { carriedHeaderName, uncarriedHeaderName } from "@/shared/headers";
import { ScramjetClient } from "@client/client";
import { Arguments, Returns, Type } from "@client/webidl";

export const enabled = (client: ScramjetClient, self: Self) =>
	"XMLHttpRequest" in self;

export default function (client: ScramjetClient) {
	client.Intercept(class extends XMLHttpRequest {
		@Arguments(
			"ByteString",
			"USVString",
			"optional boolean",
			"optional USVString?",
			"optional USVString?"
		)
		@Returns("undefined")
		open(
			method: string,
			url: string,
			isAsync?: boolean,
			username?: string | null,
			password?: string | null
		): void {
			const rewritten = client.rewriteUrl(url);

			if (arguments.length < 3) return super.open(method, rewritten);

			if (isAsync === false) {
				// TODO: bring back sync xhr
				throw client.errors.domException("InvalidAccessError", {
					execute: "open",
					on: "XMLHttpRequest",
					detail: "Synchronous requests are not supported.",
				});
			}

			return super.open(method, rewritten, isAsync, username, password);
		}

		@Type("USVString")
		get responseURL() {
			const url = super.responseURL;

			return String_startsWith(url, client.context.prefix.href)
				? client.unrewriteUrl(url)
				: url;
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
			Array_sort(restored);

			return restored.length ? Array_join(restored, "\r\n") + "\r\n" : "";
		}
	});
}
