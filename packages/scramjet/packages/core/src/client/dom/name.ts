/**
 * `window.name` in the emulated top-level.
 *
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-name
 *
 * Its real name is what targets below it say to reach it (see
 * `client.frameName`). Once the page sets a name, that is the real one, so a
 * popup's `target="main"` finds its opener the way it does natively. Until
 * then it is one scramjet made up, which reads as the empty string a top-level
 * starts out with.
 *
 * https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation
 * (step 4) - a top-level loses its name when a navigation changes its origin.
 * The real frame has a parent, so the browser keeps it; instead each name the
 * page sets is recorded with its origin, and dropped when a document of
 * another origin loads.
 */

import { GlobalScope, ScramjetClient } from "@client/index";
import { Type } from "@client/webidl";
import { isGeneratedFrameName } from "@client/helpers";
import {
	JSON_parse,
	JSON_stringify,
	Object_create,
	Object_hasOwn,
} from "@/shared/snapshot";

// in the proxy origin's session storage, which is per tab. No `@`, so it is
// under no site's prefix and no page is shown it (see `dom/storage.ts`)
const ORIGINS_KEY = "scramjet frame name origins";

// before any script of the page's can read the name
export const order = -10;

export default function (client: ScramjetClient, self: Self) {
	if (!client.isEmulatedTop) return;

	const storage = (): any => {
		try {
			return new client.native.Storage(
				new client.native.window(self).sessionStorage
			);
		} catch {
			// storage is off, or the document is sandboxed into an opaque origin
			return null;
		}
	};

	/** The origin that set each name, by name. */
	const origins = (): Record<string, string | null> => {
		try {
			const raw = storage()?.getItem(ORIGINS_KEY);
			const parsed = raw ? JSON_parse(raw) : null;
			if (parsed && typeof parsed === "object") return parsed;
		} catch {}

		return Object_create(null);
	};

	const nWin = new client.native.window(self);
	const current: string = nWin.name;
	if (current !== "" && !isGeneratedFrameName(current)) {
		const all = origins();
		// an opaque origin is only ever its own, so null on either side is a
		// change. A name nothing recorded - the embedder's - is left alone
		if (
			Object_hasOwn(all, current) &&
			(all[current] === null ||
				client.siteOrigin === null ||
				all[current] !== client.siteOrigin)
		) {
			nWin.name = "";
		}
	}

	client.Intercept(class extends GlobalScope {
		@Type("DOMString")
		static get name(): string {
			const name: string = new client.native.window(this).name;

			return isGeneratedFrameName(name) ? "" : name;
		}

		@Type("DOMString")
		static set name(value: string) {
			new client.native.window(this).name = value;
			if (value === "") return;

			try {
				const all = origins();
				all[value] = client.siteOrigin;
				storage()?.setItem(ORIGINS_KEY, JSON_stringify(all));
			} catch {
				// over quota. The name still holds; only a cross-origin
				// navigation fails to clear it
			}
		}
	});
}
