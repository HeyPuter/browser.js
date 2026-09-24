import { rewriteJs } from "@rewriters/js";
import { GlobalScope, ScramjetClient } from "@client/index";
import { String, TextDecoder_decode } from "@/shared/snapshot";
import { Arguments, Returns } from "@client/webidl";
import {
	backupIncumbencyMode,
	backupIncumbentCallback,
	incumbentFor,
	interceptDepth,
} from "./incumbency";

export default function (client: ScramjetClient, _self: Self) {
	/**
	 * A function handler is a callback, converted - and so given its incumbent,
	 * for `backupIncumbency: "full"` - when the timer is set, which is here: the
	 * member is intercepted, so `shared/callbacks.ts` leaves it alone. A string
	 * one is a script of its own.
	 * https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timer-initialisation-steps
	 */
	const rewriteHandler = (
		handler: TimerHandler,
		incumbent: ScramjetClient | null
	): TimerHandler => {
		if (typeof handler === "function") {
			return backupIncumbentCallback(
				client,
				incumbent,
				handler as (...args: any[]) => any
			);
		}

		const rewritten = rewriteJs(
			String(handler),
			"(setTimeout string eval)",
			client.context,
			client.meta,
			false,
			client
		);

		return typeof rewritten === "string"
			? rewritten
			: TextDecoder_decode(rewritten);
	};

	// called from an interceptor body, so the member's frames are Intercept's
	const conversionIncumbent = () =>
		backupIncumbencyMode(client) === "full"
			? incumbentFor(client, interceptDepth(client) + 1)
			: null;

	// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers
	client.Intercept(class extends GlobalScope {
		@Arguments("TimerHandler", "optional long timeout = 0", "any... arguments")
		@Returns("long")
		static setTimeout(
			handler: TimerHandler,
			timeout?: number,
			...args: any[]
		): number {
			// through the receiver, not a captured `self`. A `this` that is not
			// a global inherits the native's brand check, where a fixed
			// receiver silently made `setTimeout.call({}, fn, 0)` work; and a
			// bare call passes undefined, which WebIDL sends to the global for
			// a member of a [Global] interface, so that still resolves
			const incumbent = conversionIncumbent();

			return new client.native.window(this).setTimeout(
				rewriteHandler(handler, incumbent),
				timeout,
				...args
			);
		}

		@Arguments("TimerHandler", "optional long timeout = 0", "any... arguments")
		@Returns("long")
		static setInterval(
			handler: TimerHandler,
			timeout?: number,
			...args: any[]
		): number {
			const incumbent = conversionIncumbent();

			return new client.native.window(this).setInterval(
				rewriteHandler(handler, incumbent),
				timeout,
				...args
			);
		}
	});
}
