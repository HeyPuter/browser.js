import { ScramjetClient } from "@client/index";

import { _Date, _URL } from "@/shared/snapshot";
import { Type } from "@client/webidl";

export default function (client: ScramjetClient, _self: Self) {
	client.Intercept(class extends Document {
		@Type("USVString")
		get cookie(): string {
			return client.context.cookieJar.getCookies(client.url, true);
		}
		@Type("USVString")
		set cookie(value: string) {
			client.context.cookieJar.setCookies(value, client.url);
			client.init.sendSetCookie([
				{
					url: client.url,
					cookie: value,
				},
			]);
		}
	});
}
