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

			// TODO: an opaque origin should be "null" rather than the URL's
			// serialization. `client.url` is never opaque today, so this only
			// diverges for a sandboxed document, which scramjet cannot host yet
			return client.scopeOrigin;
		}
	});
}
