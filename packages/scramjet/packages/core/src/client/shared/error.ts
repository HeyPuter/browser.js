import { unrewriteUrl } from "@rewriters/url";
import { ScramjetClient } from "@client/index";
import { SCRAMJET_SCRIPT_URL } from "@client/nativeerror";
import {
	Error_prototype_toString,
	Object_defineProperty,
	String,
	String_endsWith,
	String_split,
} from "@/shared/snapshot";

export const enabled = (client: ScramjetClient) =>
	client.flagEnabled("cleanErrors");

export default function (client: ScramjetClient, _self: Self) {
	// v8 only. all we need to do is clean the scramjet urls from stack traces
	const isOwnScript = (url: string): boolean => {
		// the client bundle, identified by a frame from inside it rather than by
		// name, so this holds however the embedder chose to serve it
		if (url === SCRAMJET_SCRIPT_URL) return true;

		const masked = client.config.maskedfiles;
		if (!masked) return false;

		for (let i = 0; i < masked.length; i++) {
			if (String_endsWith(url, masked[i])) return true;
		}

		return false;
	};

	const closure = (error: any, frames: any[]) => {
		// V8 calls this *to produce* `error.stack`, so reading `error.stack` here
		// is re-entrant - it comes back already formatted by the default
		// formatter, which is how this used to work and why the CallSite list was
		// only ever mined for filenames. Build the string the way the default
		// formatter does instead: `Error.prototype.toString` for the header,
		// which is what V8 uses for a DOMException as much as for an Error, then
		// one "\n    at <frame>" per surviving frame.
		let stack: string = Error_prototype_toString.call(error);

		for (let i = 0; i < frames.length; i++) {
			let url: string | null = null;
			try {
				url = frames[i].getFileName();
			} catch {
				// a frame with no file - eval, or native code - is kept as-is
			}

			// strip stack frames including scramjet handlers from the trace
			if (url && isOwnScript(url)) continue;

			let frame = String(frames[i]);
			if (url) {
				try {
					// splitting on the url rather than replaceAll, which a page can
					// replace on String.prototype
					frame = String_split(frame, url).join(
						unrewriteUrl(url, client.context)
					);
				} catch {
					// not one of ours; leave the frame alone
				}
			}

			stack += "\n    at " + frame;
		}

		return stack;
	};

	// Defined outright rather than through `Trap`.
	//
	// `Error.prepareStackTrace` does not exist until something assigns it -
	// `Object.getOwnPropertyDescriptor(Error, "prepareStackTrace")` is
	// undefined on a fresh realm, and so is every entry up the chain - so
	// `resolveNative` finds nothing to replace and skips the member. That is
	// the right default everywhere else (adding a member an engine does not
	// have advertises the patch), and it is why this flag silently did nothing:
	// with `cleanErrors` on, every `error.stack` a page read still named
	// scramjet.js in the frames beneath the member it called.
	//
	// Assigning it is what a page would do anyway, so the shape is one a real
	// page produces.
	Object_defineProperty(client.global.Error, "prepareStackTrace", {
		get() {
			// this is a funny js quirk. the getter is ran every time you type something in console
			return closure;
		},
		set() {
			// just ignore it if a site tries setting their own. not much we can really do
		},
		enumerable: false,
		configurable: true,
	});
}
