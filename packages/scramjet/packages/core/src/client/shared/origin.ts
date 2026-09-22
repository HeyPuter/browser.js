import { GlobalScope, ScramjetClient } from "@client/index";
import { Type } from "@client/webidl";

export default function (client: ScramjetClient) {
	// https://html.spec.whatwg.org/multipage/webappapis.html#dom-origin
	client.Intercept(class extends GlobalScope {
		/**
		 * The IDL is `[Replaceable] readonly attribute USVString origin`, and
		 * `[Replaceable]` is why only the getter is declared here.
		 */
		@Type("USVString")
		static get origin(): string {
			// The native getter brand-checks its receiver, and answering out of
			// client state alone would not, so
			// `Object.getOwnPropertyDescriptor(self, "origin").get.call({})`
			// would return an origin where a browser throws. Read through the
			// receiver the page actually used to inherit the check.
			//
			// A bare `origin` is a `this` of undefined, which WebIDL sends to
			// the global object for a member of a [Global] interface, so an
			// unqualified read still resolves rather than throwing.
			//
			// Through `client.native` rather than `super.origin` or
			// `this.origin`. `super` does not work for a `GlobalScope` member -
			// see the note on `GlobalScope` in client.ts - and `this` here is
			// the *receiver*, so `this.origin` is a read of the accessor being
			// installed and recurses until the stack runs out. It typechecks,
			// because TypeScript types `this` in a static as the class, and the
			// class does declare a static `origin`.
			void new client.native.window(this).origin;

			// `siteOrigin`, not `scopeOrigin`. This is a *serialization* of the
			// document's origin, and an opaque one serializes as "null".
			// `scopeOrigin` answers a storage bucket key instead - a string
			// unique to this document, deliberately equal to nothing - and
			// handing that to the page would both invent an origin no browser
			// produces and hand out a value that changes on every load.
			// https://html.spec.whatwg.org/multipage/webappapis.html#dom-origin
			return client.siteOrigin ?? "null";
		}
	});
}
