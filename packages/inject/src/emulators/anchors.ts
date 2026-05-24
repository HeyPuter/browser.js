import { ExecutionContextWrapper } from "../context";
import { setupAlwaysLastBubble } from "./alwaysLastBubble";

export function setupAnchorHandler(
	{ self, rpc, client }: ExecutionContextWrapper,
	addAlwaysLastEventListener: ReturnType<typeof setupAlwaysLastBubble>
) {
	const anchorObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			// https://issues.chromium.org/issues/440360422
			setTimeout(() => {
				mutation.addedNodes.forEach((_node) => {
					if (client.box.instanceof(_node, "HTMLAnchorElement")) {
						const node = _node as HTMLAnchorElement;
						const openInNewTab = () => {
							// note that this is the intercepted version
							const href = node.href;

							rpc.call("newtab", {
								url: href,
							});
						};

						addAlwaysLastEventListener(node, "click", (e: MouseEvent) => {
							if (e.defaultPrevented) return;
							if (e.button !== 0) return; // left click
							if (node.target !== "_blank") return;
							e.preventDefault();
							e.stopPropagation();
							e.stopImmediatePropagation();
							openInNewTab();
						});

						addAlwaysLastEventListener(node, "auxclick", (e: MouseEvent) => {
							if (e.defaultPrevented) return;
							if (e.button !== 1) return; // middle click
							e.preventDefault();
							e.stopPropagation();
							e.stopImmediatePropagation();
							openInNewTab();
						});
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
