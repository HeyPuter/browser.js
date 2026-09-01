import { iswindow, isworker } from "@client/entry";
import { SCRAMJETCLIENT } from "@/symbols";
import { GlobalScope, ScramjetClient } from "@client/index";
import { Object_defineProperty } from "@/shared/snapshot";
import { POLLUTANT } from "./realm";
import { Arguments } from "@client/webidl";
import { incumbencyMode, rawCallSites } from "@/shared/incumbency";
import { realmForFrame } from "./incumbency";

export default function (client: ScramjetClient, self: Self) {
	const getLegacyPollutant = () => {
		// so we need to send the real origin here, since the recieving window can't possibly know.
		// except, remember that this code is being ran in a different realm than the invoker, so if we ask our `client` it may give us the wrong origin
		// if we were given any object that came from the real realm we can use that to get the real origin
		// and this works in every case EXCEPT for the fact that all three arguments can be strings which are copied instead of cloned
		// so we have to use `$setrealm` which will pollute this with an object from the real realm

		let pollutant;

		if (typeof ctx.args[0] === "object" && ctx.args[0] !== null) {
			pollutant = ctx.args[0]; // try to use the first object we can find because it's more reliable
		} else if (typeof ctx.args[2] === "object" && ctx.args[2] !== null) {
			pollutant = ctx.args[2]; // next try to use transfer
		} else if (
			ctx.this &&
			POLLUTANT in ctx.this &&
			typeof ctx.this[POLLUTANT] === "object" &&
			ctx.this[POLLUTANT] !== null
		) {
			pollutant = ctx.this[POLLUTANT]; // lastly try to use the object from $setrealm
		} else {
			pollutant = {}; // give up
		}

		// and now we can steal Function from the caller's realm
		const {
			constructor: { constructor: Function },
		} = pollutant;

		// invoking stolen function will give us the caller's globalThis, remember scramjet has already proxied it!!!
		const callerGlobalThisProxied: Self = Function("return globalThis")();
		const callerClient = callerGlobalThisProxied[SCRAMJETCLIENT];

		// this WOULD be enough but the source argument of MessageEvent has to return the caller's window
		// and if we just call it normally it would be coming from here, which WILL NOT BE THE CALLER'S because the accessor is from the parent
		// so with the stolen function we wrap postmessage so the source will truly be the caller's window (remember that function is scramjet's!!!)
		const wrappedPostMessage = Function("...args", "this(...args)");
	};

	if (iswindow) {
		client.Intercept(class extends GlobalScope {
			static postMessage(message: any) {
				const mode = incumbencyMode(client.context, client.url);
				if (mode === "pst" || mode === "nonce") {
					const sites = rawCallSites();
					for (const site of sites) {
						console.log(`${site.getFileName()} : ${site.getScriptHash()}`);
					}
					const last = sites[sites.length - 1];
					console.log(last.getScriptHash(), client.box);
					const nonce = client.box.scripthashes[last.getScriptHash()];

					super.postMessage({
						$scramjet$messagetype: "window",
						$scramjet$origin: client.url.origin,
						$scramjet$data: message,
						$scramjet$nonce: nonce,
					});
				}
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
