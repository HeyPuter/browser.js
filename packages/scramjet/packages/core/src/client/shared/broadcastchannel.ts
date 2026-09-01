import { ScramjetClient } from "@client/index";
import { Constructor, Type } from "@client/webidl";
import { String_indexOf, String_substring } from "@/shared/snapshot";

export const enabled = (client: ScramjetClient, self: Self) =>
	"BroadcastChannel" in self;

/**
 * https://html.spec.whatwg.org/multipage/web-messaging.html#broadcastchannel
 *
 * A BroadcastChannel is matched on the tuple (storage key, name), and every
 * proxied document shares the one real storage key - so the name is the only
 * thing keeping two sites' channels apart, and it has to carry the origin.
 * Without this, `new BroadcastChannel("chat")` on two unrelated sites is one
 * channel, and `postmessage.ts` stamps the sender's origin into the envelope,
 * so the receiving site reads a foreign `event.origin` off a message it should
 * never have been given.
 *
 * `scopeOrigin` rather than `url.origin`, for the same reason `indexeddb.ts`,
 * `caches.ts`, `worker.ts` and `dom/storage.ts` use it: an about:blank or
 * srcdoc document has no origin of its own and serializes as the opaque
 * "null", so keying on its URL would file every such frame on every site under
 * one shared namespace - the same cross-site channel, one level down. A
 * document with no proxied creator to inherit from gets a bucket unique to
 * itself instead of joining that namespace.
 */
export default function (client: ScramjetClient) {
	client.Intercept(class extends BroadcastChannel {
		@Constructor("DOMString")
		static konstructor(name: string) {
			return new this(`${client.scopeOrigin}@${name}`);
		}

		@Type("DOMString")
		get name(): string {
			const name = super.name;

			// split on the *first* "@": an origin cannot contain one, so the
			// first is always the separator and a name the page put an "@" in -
			// including one that looks like it is already scoped - comes back
			// intact. A name with no "@" at all is not one of ours and is
			// answered as-is rather than mangled.
			return String_substring(name, String_indexOf(name, "@") + 1);
		}
	});
}
