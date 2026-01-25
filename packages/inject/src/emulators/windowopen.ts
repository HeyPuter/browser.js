import { ExecutionContextWrapper } from "../context";
import { chromeframe } from "..";
import { reduceSequence } from "..";

export function setupWindowOpen({
	self,
	rpc,
	client,
}: ExecutionContextWrapper) {
	client.Proxy("window.open", {
		apply(ctx) {
			const url = new URL(ctx.args[0], client.url);

			// TODO: return real window in singlethreaded mode

			let realWindow: Window | null = null;
			let realWindowResolve!: (window: Window) => void;
			const realWindowPromise: Promise<Window> = new Promise((resolve) => {
				realWindowResolve = resolve;
			});

			rpc
				.call("newtab", {
					url: url.href,
				})
				.then(({ sequence }) => {
					console.error(
						`windowopenproxy: newtab: sequence was received`,
						sequence
					);
					let newWindow = reduceSequence(sequence);
					if (!newWindow) {
						throw new Error("Failed to reduce sequence");
					}
					realWindow = newWindow;
					realWindowResolve(realWindow);
				});

			const windowProxy = new Proxy(
				{},
				{
					get(target, prop) {
						// TODO: hardcoded scramjet prefix
						if (typeof prop === "string" && prop.startsWith("$scramjet__")) {
							prop = prop.slice(11);
						}

						console.log(
							`windowopenproxy: property ${String(prop)} was accessed`
						);

						if (realWindow) {
							return Reflect.get(realWindow, prop);
						} else {
							if (prop === "location") {
								// this doesn't need to be undetectable, just working
								return new Proxy(
									{},
									{
										get(target, prop) {
											if (
												typeof prop === "string" &&
												prop.startsWith("$scramjet__")
											) {
												prop = prop.slice(11);
											}
											if (prop in url) {
												return url[prop];
											}
											if (prop === "assign") {
												return (target: string | URL) => {
													console.log(
														`windowopenproxy.location.assign: ${String(target)} was called`
													);
													realWindowPromise.then((realWindow) => {
														console.log(realWindow);
														console.log(typeof realWindow);
														console.log(
															`windowopenproxy.location.assign: real window was created, calling assign on it`,
															realWindow
														);
														realWindow.location.assign(target);
													});
												};
											} else if (prop === "reload") {
												return () => {
													realWindowPromise.then((realWindow) => {
														realWindow.location.reload();
													});
												};
											} else if (prop === "replace") {
												return (target: string | URL) => {
													realWindowPromise.then((realWindow) => {
														realWindow.location.replace(target);
													});
												};
											}
											console.warn(
												`windowopenproxy.location: property ${String(prop)} was accessed, but real window.location was not yet created`
											);
											return undefined;
										},
										set(target, prop, value) {
											realWindowPromise.then((realWindow) => {
												Reflect.set(realWindow.location, prop, value);
											});
											return true;
										},
									}
								);
							}

							console.warn(
								`windowopenproxy: property ${String(prop)} was accessed, but real window was not yet created`
							);
						}
					},
					set(target, prop, value) {
						if (realWindow) {
							Reflect.set(realWindow, prop, value);
						} else {
							realWindowPromise.then((window) => {
								Reflect.set(window, prop, value);
							});
						}
						return true;
					},
				}
			);

			ctx.return(windowProxy);
		},
	});
}
