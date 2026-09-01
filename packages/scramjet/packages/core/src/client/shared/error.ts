import { unrewriteUrl } from "@rewriters/url";
import { ScramjetClient } from "@client/index";
import { isOwnScript } from "@client/nativeerror";
import { RAWFRAMES } from "@/symbols";
import { QP } from "@/fetch/parse";
import {
	Error_prototype_toString,
	String,
	String_split,
	_URL,
} from "@/shared/snapshot";

export const enabled = (client: ScramjetClient) =>
	client.flagEnabled("cleanErrors");

export default function (client: ScramjetClient, _self: Self) {
	// v8 only. all we need to do is clean the scramjet urls from stack traces
	/**
	 * What this frame would have been named without the proxy.
	 *
	 * Rewriting appends a `//# sourceURL` of scramjet's own, so the name in the
	 * frame is ours, not the script's. When the source carried a sourceURL of
	 * its own that value is what the page expects to see, verbatim - V8 does
	 * not resolve a relative one - and the rewriter recorded it against the
	 * nonce. Otherwise the frame should name the script's real URL, which is
	 * what unrewriting ours gets back.
	 */
	const pageName = (shown: string): string => {
		let nonce: string | null = null;
		try {
			nonce = new _URL(shown).searchParams.get(QP.nonce);
		} catch {
			// not a URL at all - a page's own bare sourceURL, or `<anonymous>`
		}

		if (nonce) {
			const realm = client.box.scriptrealms[nonce];
			if (realm && realm.pageSourceUrl !== null) return realm.pageSourceUrl;
		}

		return unrewriteUrl(shown, client.context);
	};

	const closure = (error: any, frames: any[]) => {
		// scramjet reading a stack for itself wants the CallSites, not the string
		// a page gets. this formatter refuses to be replaced, so this marker is
		// the only way past it - see `shared/incumbency.ts`
		if (error && error[RAWFRAMES]) return frames;

		// V8 calls this *to produce* `error.stack`, so reading `error.stack` here
		// is re-entrant - it comes back already formatted by the default
		// formatter, which is how this used to work and why the CallSite list was
		// only ever mined for filenames. Build the string the way the default
		// formatter does instead: `Error.prototype.toString` for the header,
		// which is what V8 uses for a DOMException as much as for an Error, then
		// one "\n    at <frame>" per surviving frame.
		let stack: string = Error_prototype_toString.call(error);

		for (let i = 0; i < frames.length; i++) {
			let file: string | null = null;
			// what the frame is *named*, which is the `//# sourceURL` when the
			// script has one and the resource URL when it does not. `getFileName`
			// is always the resource URL, so it decides whether the frame is ours
			// to drop, but it is not the string the frame text contains
			let shown: string | null = null;
			try {
				file = frames[i].getFileName();
				shown = frames[i].getScriptNameOrSourceURL();
			} catch {
				// a frame with no file - eval, or native code - is kept as-is
			}

			// strip stack frames including scramjet handlers from the trace
			if (file && isOwnScript(file, client.config.maskedfiles)) continue;

			let frame = String(frames[i]);
			if (shown) {
				try {
					// splitting on the url rather than replaceAll, which a page can
					// replace on String.prototype
					frame = String_split(frame, shown).join(pageName(shown));
				} catch {
					// not one of ours; leave the frame alone
				}
			}

			stack += "\n    at " + frame;
		}

		return stack;
	};

	client.Trap("Error.prepareStackTrace", {
		get(_ctx) {
			// this is a funny js quirk. the getter is ran every time you type something in console
			return closure;
		},
		set(_value) {
			// just ignore it if a site tries setting their own. not much we can really do
		},
	});
}
