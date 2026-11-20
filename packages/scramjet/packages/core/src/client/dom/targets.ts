/**
 * Navigation targets, settled as they are used.
 *
 * `_top` and `_parent` would leave the proxy from the emulated top-level, so
 * the attribute rule in `htmlRules.ts` rewrites them by where the document
 * sits in the frame tree. The client knows that. The service worker only
 * knows what a request carried, and a document it serves often carried
 * nothing - a frame's markup, or a page a frame navigated to - so it drops
 * the keyword, which keeps the navigation in the frame.
 *
 * This puts the real target in place as a link is followed or a form is
 * submitted, from the value the page wrote, before the browser reads it.
 * Only the real attribute changes: the page goes on seeing its own value.
 */

import { ScramjetClient } from "@client/index";
import { Array_indexOf, String_toLowerCase } from "@/shared/snapshot";

const KEYWORDS = ["_top", "_parent", "_unfencedtop"];

export default function (client: ScramjetClient, self: Self) {
	const settle = (element: Element | null | undefined, name: string) => {
		if (!element) return;
		const value = client.attributes.get(element, name);
		if (value === null) return;
		if (Array_indexOf(KEYWORDS, String_toLowerCase(value)) === -1) return;

		const rewrite = client.attributes.rewriter(element, name);
		if (!rewrite) return;

		const real = rewrite(value);
		const raw = client.attributes.raw;
		if (real === null) {
			if (raw.has(element, name)) raw.remove(element, name);
		} else if (raw.get(element, name) !== real) {
			raw.set(element, name, real);
		}
	};

	/** The document's base target, which a link or form without one uses. */
	const settleBase = (node: Node) => {
		const document = new client.native.Node(node).ownerDocument;
		if (!document) return;
		const bases = new client.native.Document(document).querySelectorAll("base");
		for (let i = 0; i < bases.length; i++) settle(bases[i], "target");
	};

	const listen = new client.native.EventTarget(self).addEventListener;

	// a link is followed after its click event is dispatched, whether the
	// click came from the user, the keyboard or `a.click()`
	listen(
		"click",
		(event: Event) => {
			const path = new client.native.Event(event).composedPath();
			for (let i = 0; i < path.length; i++) {
				let local: string;
				try {
					local = new client.native.Element(path[i]).localName;
				} catch {
					// the document and the window, at the end of the path
					continue;
				}
				if (local === "a" || local === "area") {
					settle(path[i] as Element, "target");
					settleBase(path[i] as Node);

					return;
				}
			}
		},
		true
	);

	// and a form's target is chosen after its submit event
	listen(
		"submit",
		(event: Event) => {
			const form = new client.native.Event(event).target as Element;
			settle(form, "target");
			settle(new client.native.SubmitEvent(event).submitter, "formtarget");
			settleBase(form);
		},
		true
	);

	// which `form.submit()` does not fire
	client.Proxy("HTMLFormElement.prototype.submit", {
		apply(ctx) {
			// eslint-disable-next-line scramjet-core/no-poisoned-ctx-value
			const form = ctx.this as Element;
			settle(form, "target");
			settleBase(form);
		},
	});
}
