import { iswindow, isworker } from "@client/entry";
import { SCRAMJETCLIENT } from "@/symbols";
import { GlobalScope, ScramjetClient } from "@client/index";
import {
	Object_defineProperty,
	Object_getPrototypeOf,
} from "@/shared/snapshot";
import { Arguments } from "@client/webidl";
import { incumbencyMode, rawCallSites } from "@/shared/incumbency";
import { incumbentClient, realmForFrame } from "./incumbency";

export default function (client: ScramjetClient, self: Self) {
	const getLegacyRealm = (args: any[]) => {
		let pollutant: any;

		if (typeof args[0] === "object" && args[0] !== null) {
			pollutant = args[0]; // try to use the first object we can find
		} else if (typeof args[2] === "object" && args[2] !== null) {
			pollutant = args[2]; // next try to use transfer
		} else {
			pollutant = {}; // give up
		}

		const objectPrototype = Object_getPrototypeOf(pollutant);
		return client.box.objectPrototypes.get(objectPrototype);
	};

	if (iswindow) {
		client.Intercept(class extends GlobalScope {
			static postMessage(
				message: any,
				targetOrigin: string | object,
				transfer?: any
			) {
				const mode = incumbencyMode(client.context, client.url);
				let senderClient: ScramjetClient;
				if (mode === "pst") {
					const sites = rawCallSites();
					// there are 4 scramjet frames between a caller and rawCallSites()
					// 5 if accounting for the extra trampoline frame
					const index = client.flagEnabled("debugTrampolines") ? 5 : 4;
					const last = sites[index];
					const scriptId = client.box.scripthashes[last.getScriptHash()];
					senderClient = client.box.scriptrealms[scriptId].client;
				} else if (mode === "stamp" || mode === "lazystamp") {
					// the innermost rewritten call site on the stack is the
					// script that called in. Nothing there means the host
					// called this directly, past any script of the page's -
					// the backup incumbent settings object, which nothing
					// records yet, so fall back to the realm being called
					senderClient = incumbentClient(client) ?? client;
				} else {
					senderClient = getLegacyRealm([message, targetOrigin, transfer]);
				}

				super.postMessage({
					$scramjet$messagetype: "window",
					$scramjet$origin: client.url.origin,
					$scramjet$data: message,
					$scramjet$clientid: senderClient.id,
				});
			}
		});
	}

	// if (iswindow)
	// 	client.Proxy("window.postMessage", {
	// 		apply(ctx) {
	// 						// console.log(
	// 			// 	callerClient,
	// 			// 	client,
	// 			// 	callerGlobalThisProxied.document,
	// 			// 	self.document,
	// 			// 	callerClient === client
	// 			// );
	// 			const inherit =
	// 				callerClient.url.href === "about:srcdoc" ||
	// 				callerClient.url.href === "about:blank";
	// 			ctx.args[0] = {
	// 				$scramjet$messagetype: "window",
	// 				$scramjet$origin: inherit
	// 					? callerClient.global.parent[SCRAMJETCLIENT].url.origin
	// 					: callerClient.url.origin,
	// 				$scramjet$data: ctx.args[0],
	// 			};
	// 			// console.error("?", ctx.args);
	// 			// eval("debugger");

	// 			// * origin because obviously
	// 			if (typeof ctx.args[1] === "string") ctx.args[1] = "*";
	// 			if (typeof ctx.args[1] === "object") ctx.args[1].targetOrigin = "*";

	// 			ctx.return(wrappedPostMessage.call(ctx.fn, ...ctx.args));
	// 		},
	// 	});

	client.Proxy("BroadcastChannel.prototype.postMessage", {
		apply(ctx) {
			ctx.args[0] = {
				$scramjet$messagetype: "window",
				// TODO: need to actually look up the broadcastchannel itself in box i think
				$scramjet$origin: client.url.origin,
				$scramjet$data: ctx.args[0],
			};
		},
	});

	const makeWorkerPostMessageBody = (message: any) => {
		return {
			$scramjet$messagetype: "worker",
			$scramjet$data: message,
		};
	};

	if (isworker) {
		client.Intercept(class extends GlobalScope {
			@Arguments(
				"any",
				"(sequence<object> or optional StructuredSerializeOptions = {})"
			)
			static postMessage(message: any, transferoptions: any) {
				super.postMessage(makeWorkerPostMessageBody(message), transferoptions);
			}
		});
	}

	client.Intercept(class extends MessagePort {
		@Arguments(
			"any",
			"(sequence<object> or optional StructuredSerializeOptions = {})"
		)
		postMessage(message: any, transferoptions: any) {
			super.postMessage(makeWorkerPostMessageBody(message), transferoptions);
		}
	});

	client.Intercept(class extends Worker {
		@Arguments(
			"any",
			"(sequence<object> or optional StructuredSerializeOptions = {})"
		)
		postMessage(message: any, transferoptions: any) {
			super.postMessage(makeWorkerPostMessageBody(message), transferoptions);
		}
	});
}
