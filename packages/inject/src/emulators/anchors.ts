import { ExecutionContextWrapper } from "../context";

export function setupAnchorHandler({
	self,
	rpc,
	client,
}: ExecutionContextWrapper) {
	// goal is to override the default behavior of clicking on an <a> link
	// if the link is target=_blank it needs to open in a new browser.js tab instead of a native tab
	// the browser does not provide a neat way of knowing when a link is clicked through
	//
	// so the only solution left is to addEventListener("click") on every single <a> element
	// however, this presents an issue
	// if the page has its *own* event listener, and it calls e.preventDefault(), we need to not open the tab, since we're essentially acting as the new default
	// since events bubble down and can have non trivial control flows, this gets complicated fast
	//
	// the only solution is to register both the first and last event listeners, so that you control the entire call stack
	// registering the first is easy, you just need to call it immediately after creation
	// registering the *last* is extremely difficult

	type EvtDesc = {
		originalcb: (e: Event) => void;
		injectafter?: (e: MouseEvent) => void;
	};
	let currentlyExecutingDesc: EvtDesc | null = null;
	const eventListeners: Map<EventTarget, EvtDesc[]> = new Map();
	// start by recording every click event registered so that we can rebuild the bubble path later
	client.Proxy("EventTarget.prototype.addEventListener", {
		apply(ctx) {
			if (ctx.args[0] != "click") return;
			// capture events don't go through the bubble process so we shouldn't include them
			if (
				(typeof ctx.args[2] === "boolean" && ctx.args[2]) ||
				(typeof ctx.args[2] === "object" && ctx.args[2].capture)
			)
				return;

			let cb = ctx.args[1];
			ctx.args[1] = function (...args: any) {
				// will always exist since we set it just below
				let descs = eventListeners.get(ctx.this)!;
				// find the one talking about us
				let desc = descs.find((d) => d.originalcb === cb)!;

				// have a flag for the event that's currently running so that we know where we are in the stack if preventDefault() or stopPropagation() is called
				currentlyExecutingDesc = desc;
				if (typeof cb === "function") {
					Reflect.apply(cb, this, args);
				} else if (typeof cb === "object" && cb !== null && cb.handleEvent) {
					Reflect.apply(cb.handleEvent, this, args);
				}

				if (desc.injectafter) {
					desc.injectafter(args[0]);
					delete desc.injectafter;
				}
				currentlyExecutingDesc = null;
			};

			let desc = {
				originalcb: cb,
			};

			if (eventListeners.has(ctx.this)) {
				eventListeners.get(ctx.this)!.push(desc);
			} else {
				eventListeners.set(ctx.this, [desc]);
			}
		},
	});

	const anchorObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			setTimeout(() => {
				mutation.addedNodes.forEach((_node) => {
					let node: HTMLAnchorElement = _node as any;
					if ("tagName" in node && node.tagName == "A") {
						const openInNewTab = () => {
							// note that this is the intercepted version
							const href = node.href;

							rpc.call("newtab", {
								url: href,
							});
						};

						const iAmLastListener = (e: MouseEvent) => {
							if (node.target != "_blank") return;
							if (e.defaultPrevented) return; // our behavior is what the new "default" is, so we don't want to trigger
							e.preventDefault();
							e.stopImmediatePropagation(); // for good measure
							openInNewTab();
						};

						// this event will always run before all other ones, since it was registered at injectHistoryEmulation
						// * unless you registered the event before appending to the dom
						// * unless there's something inside of the <a> that has a listener on it
						// * unless there's a capture listener
						// TODO fix those cases

						client.natives.call(
							"EventTarget.prototype.addEventListener",
							node,
							"click",
							(e: MouseEvent) => {
								let lastlistener;
								const path = e.composedPath();

								// travel the path, from the <a> all the way to Window
								for (const elm of path) {
									let descriptors = eventListeners.get(elm);
									if (descriptors) {
										// last descriptor was last added and will be called last
										lastlistener = descriptors[descriptors.length - 1];
									}
								}

								// TODO: if a listener is added to a lower level of the dom inside the listener of a higher level, our lastlistener will not be correct
								if (!lastlistener) {
									// there are no other event listeners! great
									iAmLastListener(e);
								} else {
									// we know what the last listener is. run this to inject after it
									lastlistener.injectafter = (e) => {
										iAmLastListener(e);
									};
								}

								// except, if stopPropagation is called, it never gets to the lastlistener
								client.RawProxy(e, "stopImmediatePropagation", {
									apply() {
										if (!currentlyExecutingDesc)
											throw new Error(
												"stopImmediatePropagation called but no desc found?"
											);
										// for stopImmediatePropagation this is the last one
										currentlyExecutingDesc.injectafter = (e) => {
											// in case preventDefault is called after stopImmediatePropagation(), wait for the event handler to be done
											iAmLastListener(e);
										};
									},
								});
								client.RawProxy(e, "stopPropagation", {
									apply(ctx) {
										if (!currentlyExecutingDesc)
											throw new Error(
												"stopPropagation called but no desc found?"
											);
										// stopPropagation means there might still be more listeners on the same element
										// find whatever the last one is on the this element and then inject after it too

										let ev: Event = ctx.this;
										if (!ev.target) throw new Error("no target");
										let descs = eventListeners.get(ev.target);
										if (!descs)
											throw new Error("no descs found in stopPropagation()");
										let idx = descs.indexOf(currentlyExecutingDesc);
										if (idx == -1)
											throw new Error("couldn't find currentlyExecutingDesc");
										let remaining = descs.slice(idx + 1, descs.length);
										if (remaining.length > 0) {
											let last = remaining[remaining.length - 1];
											// finally we have the last in the chain after propagation is cut off
											last.injectafter = (e) => {
												iAmLastListener(e);
											};
										}
									},
								});
							}
						);
						// TODO: jankify this too
						client.natives.call(
							"EventTarget.prototype.addEventListener",
							node,
							"auxclick",
							(e: MouseEvent) => {
								if (e.button !== 1) return; // middle click
								e.preventDefault();
								openInNewTab();
							}
						);
					}
				});
			}, 2000);
		});
	});
	anchorObserver.observe(self.document, {
		childList: true,
		subtree: true,
	});

	self.addEventListener("load", () => {
		self.document.querySelectorAll("*").forEach((e) => e);
	});
}
