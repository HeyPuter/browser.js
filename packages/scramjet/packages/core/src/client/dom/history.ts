import { ScramjetClient } from "@client/index";
import { Tap } from "@/Tap";
import { Arguments, Returns } from "@client/webidl";
import { _URL } from "@/shared/snapshot";

export default function (client: ScramjetClient, _self: Self) {
	/**
	 * The SecurityError Chrome throws for a state URL it will not accept.
	 *
	 * Built rather than delegated. Handing the call to the native would produce
	 * a message naming the *proxy's* origin and document URL, which is the leak
	 * the old TODO was about. Every field a detector can read - the message
	 * text, the name, the code, and the presence and descriptor of `stack` -
	 * was measured against Chrome and matches.
	 *
	 * `url` is the *resolved* URL, not the argument: Chrome reports
	 * "//evil.example/x" as "http://evil.example/x", and `documentUrl` carries
	 * its query and fragment.
	 */
	const stateUrlRejected = (
		method: string,
		url: string,
		documentUrl: URL
	): DOMException =>
		client.errors.domException("SecurityError", {
			execute: method,
			on: "History",
			detail: `A history state object with URL '${url}' cannot be created in a document with origin '${documentUrl.origin}' and URL '${documentUrl.href}'.`,
			caller: resolveStateUrl,
		});

	/**
	 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#shared-history-push/replace-state-steps
	 *
	 * Returns the URL to hand the native, or null for "no URL change".
	 */
	const resolveStateUrl = (
		history: History,
		url: string | null,
		method: string
	): string | null => {
		// null is the IDL default and means the entry keeps the document's URL.
		// It is the *only* value that means that: "" is a real URL that resolves
		// to the document's URL without its fragment, and 0 is the relative URL
		// "0", both of which a truthiness test silently drops.
		if (url === null) return null;

		const relevantclient = client.box.histories.get(history);

		// Resolved against the site's URL, not the proxy's, and resolved *before*
		// the origin check rather than after: a scheme-relative "//evil.example/x"
		// does not parse on its own, so an absolute-only parse skips the check
		// entirely and then hands the rewriter a cross-origin URL.
		let parsed: URL;
		try {
			parsed = new _URL(url, relevantclient.url);
		} catch {
			// an unparseable URL is a SecurityError too, and Chrome reports it in
			// the same sentence as a cross-origin one. It renders the URL as far
			// as its parser got - "http://" comes back as "http:", "http://[" as
			// "http://[/" - which the standard parser cannot reproduce because it
			// simply throws, so the argument is reported verbatim instead
			throw stateUrlRejected(method, url, relevantclient.url);
		}

		if (parsed.origin !== relevantclient.url.origin) {
			throw stateUrlRejected(method, parsed.href, relevantclient.url);
		}

		return relevantclient.rewriteUrl(parsed.href);
	};

	const dispatchNavigate = (history: History) => {
		const relevantclient = client.box.histories.get(history);
		Tap.dispatch(
			relevantclient.hooks.lifecycle.navigate,
			{ type: "history" },
			{ url: relevantclient.url.href }
		);
	};

	client.Intercept(class extends History {
		@Arguments("any", "DOMString", "optional USVString? url = null")
		@Returns("undefined")
		pushState(data: any, unused: string, url: string | null = null): void {
			super.pushState(data, unused, resolveStateUrl(this, url, "pushState"));
			dispatchNavigate(this);
		}

		@Arguments("any", "DOMString", "optional USVString? url = null")
		@Returns("undefined")
		replaceState(data: any, unused: string, url: string | null = null): void {
			super.replaceState(
				data,
				unused,
				resolveStateUrl(this, url, "replaceState")
			);
			dispatchNavigate(this);
		}
	});
}
