import { ExecutionContextWrapper } from "../context";
import { setupAlwaysLastBubble } from "./alwaysLastBubble";

export function setupAnchorHandler(
	{ self, rpc, client }: ExecutionContextWrapper,
	addAlwaysLastEventListener: ReturnType<typeof setupAlwaysLastBubble>
) {
	const anchorObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			setTimeout(() => {
				mutation.addedNodes.forEach((_node) => {
					const node = _node as HTMLAnchorElement;
					if ("tagName" in node && node.tagName == "A") {
						const openInNewTab = () => {
							// note that this is the intercepted version
							const href = node.href;

							rpc.call("newtab", {
								url: href,
							});
						};

						addAlwaysLastEventListener(node, "click", (e: MouseEvent) => {
							if (e.button !== 0) return; // left click
							e.preventDefault();
							e.stopPropagation();
							e.stopImmediatePropagation();
							openInNewTab();
						});

						addAlwaysLastEventListener(node, "auxclick", (e: MouseEvent) => {
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
