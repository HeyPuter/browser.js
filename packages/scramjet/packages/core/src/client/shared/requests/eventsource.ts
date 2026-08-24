import { ScramjetClient } from "@client/index";
import { Constructor, Type, idlBoolean, idlDictionary } from "@client/webidl";

export default function (client: ScramjetClient) {
	client.Intercept(
		class extends EventSource {
			// https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface
			@Constructor("USVString", "optional EventSourceInit")
			static konstructor(url: string, eventSourceInitDict?: EventSourceInit) {
				const dict = idlDictionary(eventSourceInitDict, "EventSourceInit");
				const raw = dict.withCredentials;
				const withCredentials = raw === undefined ? false : idlBoolean(raw);

				return new this(
					client.rewriteUrl(url, {
						mode: "cors",
						credentials: withCredentials ? "include" : undefined,
					}),
					{ withCredentials }
				);
			}

			@Type("USVString")
			get url(): string {
				return client.unrewriteUrl(super.url);
			}
		}
	);
}
