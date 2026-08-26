import { GlobalScope, ScramjetClient } from "@client/index";
import { SCRAMJETCLIENT } from "@/symbols";
import { openWindowSteps } from "@client/helpers";
import { Arguments, Returns } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	const nativeGlobal = new client.native.window(self);

	client.Intercept(class extends GlobalScope {
		// https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-open
		// the steps themselves are shared with the three-argument
		// `document.open`, which is the same operation under another name
		@Arguments("optional USVString", "optional DOMString", "optional DOMString")
		@Returns("WindowProxy?")
		static open(
			url?: string,
			target?: string,
			features?: string
		): Window | null {
			return openWindowSteps(client, nativeGlobal.open, url, target, features);
		}
	});

	// left as a Trap: `frameElement` is a global attribute, and `ctx.get()` reads
	// it off the receiver the page actually used. A static accessor on
	// `GlobalScope` would have to go through `nativeGlobal`, which pins the read
	// to *this* realm's window and loses the receiver
	client.Trap("window.frameElement", {
		get(ctx) {
			const f = ctx.get() as HTMLIFrameElement | null;
			if (!f) return f;

			const win = f.ownerDocument.defaultView;
			if (win[SCRAMJETCLIENT]) {
				// then this is a subframe in a scramjet context, and it's safe to pass back the real iframe
				return f;
			} else {
				// no, the top frame is outside the sandbox
				return null;
			}
		},
	});
}
