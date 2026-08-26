import { rewriteJs } from "@rewriters/js";
import { GlobalScope, ScramjetClient } from "@client/index";
import { String, TextDecoder_decode } from "@/shared/snapshot";
import { Arguments, Returns } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	const nativeGlobal = new client.native.window(self);

	const rewriteHandler = (handler: TimerHandler): TimerHandler => {
		if (typeof handler === "function") return handler;

		const rewritten = rewriteJs(
			String(handler),
			"(setTimeout string eval)",
			client.context,
			client.meta
		);

		return typeof rewritten === "string"
			? rewritten
			: TextDecoder_decode(rewritten);
	};

	// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers
	client.Intercept(class extends GlobalScope {
		@Arguments("TimerHandler", "optional long timeout = 0", "any... arguments")
		@Returns("long")
		static setTimeout(
			handler: TimerHandler,
			timeout?: number,
			...args: any[]
		): number {
			return nativeGlobal.setTimeout(rewriteHandler(handler), timeout, ...args);
		}

		@Arguments("TimerHandler", "optional long timeout = 0", "any... arguments")
		@Returns("long")
		static setInterval(
			handler: TimerHandler,
			timeout?: number,
			...args: any[]
		): number {
			return nativeGlobal.setInterval(
				rewriteHandler(handler),
				timeout,
				...args
			);
		}
	});
}
