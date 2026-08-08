import { ScramjetClient } from "@client/client";
import { Arguments } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	client.Intercept(
		class extends Audio {
			@Constructor
			@Arguments("DOMString?")
			ctor() {}
		}
	);
}
