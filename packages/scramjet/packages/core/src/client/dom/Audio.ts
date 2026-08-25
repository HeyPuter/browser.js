import { ScramjetClient } from "@client/client";
import { Constructor } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	client.Intercept(class extends Audio {
		@Constructor("optional DOMString")
		static konstructor(url: string) {
			return new this(url ? client.rewriteUrl(url) : undefined);
		}
	});
}
