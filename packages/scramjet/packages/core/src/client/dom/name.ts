/**
 * `window.name`, and the start of the navigation target layer.
 *
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-name
 *
 *   The name getter steps are:
 *     1. If this's navigable is null, then return the empty string.
 *     2. Return this's navigable's target name.
 *
 *   The name setter steps are:
 *     1. If this's navigable is null, then return.
 *     2. Set this's navigable's active session history entry's document
 *        state's navigable target name to the given value.
 *
 * Only the emulated top-level answers with anything but the native: its real
 * name is scramjet's (see `framename.ts`). Every other window's name is the
 * one the browser keeps, which is already the page's.
 */

import { GlobalScope, ScramjetClient } from "@client/index";
import { Type } from "@client/webidl";
import { TopFrameName } from "@client/framename";
import { TargetLayer, openerClient } from "@client/targets";
import { trackPopup } from "@client/helpers";
import { SCRAMJETCLIENT } from "@/symbols";
import { Object_defineProperty } from "@/shared/snapshot";

// before anything else a document can run, and before the page's own modules
// can read the name
export const order = -10;

export default function (client: ScramjetClient, self: Self) {
	if (client.isEmulatedTop) {
		try {
			client.frameName = new TopFrameName(client);
		} catch (err) {
			dbg.error("failed to set up the top-level frame's name", err);
		}
	}

	/**
	 * The emulated top-level `win` is, or null for a window that answers for
	 * itself natively. The receiver can be any window - `get.call(parent)` is
	 * a cross-realm call to this realm's getter.
	 */
	const emulated = (win: Window): TopFrameName | null => {
		try {
			const other: ScramjetClient | undefined = win[SCRAMJETCLIENT];

			return other && (other.global as unknown) === win ? other.frameName : null;
		} catch {
			return null;
		}
	};

	/** Step 1: a window whose navigable is gone - a removed frame's - has no name. */
	const detached = (win: Window): boolean => {
		try {
			return new client.native.window(win).closed;
		} catch {
			return false;
		}
	};

	/**
	 * The window an accessor was called on. For a [Global] interface, WebIDL
	 * takes an undefined or null `this` to mean the current global - so
	 * `get.call(undefined)` reads this window's name and must be answered as
	 * such, not handed the real one.
	 */
	const receiver = (that: unknown): Window =>
		(that === undefined || that === null ? self : that) as Window;

	client.Intercept(class extends GlobalScope {
		@Type("DOMString")
		static get name(): string {
			// the native first, for its brand check: a receiver that is not a
			// window gets the browser's own TypeError
			const native = new client.native.window(this).name;
			const win = receiver(this);
			const state = emulated(win);
			if (!state) return native;
			if (detached(win)) return "";

			return state.get();
		}

		@Type("DOMString")
		static set name(value: string) {
			const win = receiver(this);
			const state = emulated(win);
			if (!state) {
				new client.native.window(this).name = value;

				return;
			}
			// the brand check the native setter would have made - and nothing
			// else, since the real name has to stay scramjet's
			void new client.native.window(this).name;
			if (detached(win)) return;

			const before = state.get();
			state.set(value);
			if (before !== value) TargetLayer.topNameChanged(win[SCRAMJETCLIENT]);
		}
	});

	// a popup this tree did not open by `window.open` - a link with a target
	// that named no frame - still has to hear about its opener's top-level
	// being renamed
	try {
		if (client.parentFrame() === "top") {
			const opener = openerClient(client);
			if (opener) trackPopup(opener, self as unknown as Window);
		}
	} catch {}

	// what the script the HTML rewriter puts after a served target calls.
	// Defined like the rewriter's other globals: not enumerable, and fixed
	Object_defineProperty(self, client.config.globals.targetfn, {
		value: (shadows?: number) => client.targets.settle(shadows),
		writable: false,
		configurable: false,
		enumerable: false,
	});
}
