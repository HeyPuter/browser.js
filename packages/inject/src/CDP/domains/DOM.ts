import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { NodeManager } from "../nodemanager";

let observer: MutationObserver | undefined = undefined;

// MARK: enable/disable
bindCDP("DOM.disable", async function () {
	this.disableDomain("DOM");
	observer?.disconnect();
});

bindCDP("DOM.enable", async function () {
	console.log("DOM enabled!");
	const callback = (mutations: MutationRecord[]) => {
		for (const mutation of mutations) {
			if (mutation.type == "attributes") {
				const name = mutation.attributeName!;
				const target = mutation.target as Element;
				if (target.hasAttribute(name)) {
					this.emit("DOM.attributeModified", {
						nodeId: this.nodes.getOrCreateId(target),
						name,
						value: target.getAttribute(name)!,
					});
				} else {
					this.emit("DOM.attributeRemoved", {
						nodeId: this.nodes.getOrCreateId(target),
						name,
					});
				}
			} else if (mutation.type == "childList") {
				for (const added of mutation.addedNodes) {
					this.emit("DOM.childNodeInserted", {
						parentNodeId: this.nodes.getOrCreateId(mutation.target),
						previousNodeId: added.previousSibling
							? this.nodes.getOrCreateId(added.previousSibling)
							: 0,
						node: this.nodes.serializeTree(added, -1, false),
					});

					// emit CSS.styleSheetAdded if a new stylesheet is added
					// was gonna make a separate observer but like.......
					if (this.cssEnabled && "sheet" in added) {
						const sheet = (added as HTMLStyleElement | HTMLLinkElement).sheet;
						if (sheet) {
							this.styles.register(sheet);
						}
					}
				}
				for (const removed of mutation.removedNodes) {
					this.emit("DOM.childNodeRemoved", {
						parentNodeId: this.nodes.getOrCreateId(mutation.target),
						nodeId: this.nodes.getOrCreateId(removed),
					});
				}
			} else if (mutation.type == "characterData") {
				this.emit("DOM.characterDataModified", {
					nodeId: this.nodes.getOrCreateId(mutation.target),
					characterData: mutation.target.nodeValue ?? "",
				});
			}
		}
	};
	observer = new MutationObserver(callback);
	observer.observe(document, {
		attributes: true,
		childList: true,
		characterData: true,
		subtree: true,
	});

	this.enableDomain("DOM");
});

// MARK: get stuff
bindCDP("DOM.getDocument", async function (params) {
	return {
		root: this.nodes.serializeTree(
			document,
			params?.depth ?? -1,
			params?.pierce ?? false
		),
	};
});

bindCDP("DOM.requestChildNodes", async function (params) {
	const { nodeId, depth, pierce } = params;
	const node = this.nodes.get(nodeId);
	if (!node) {
		throw new Error("Node not found");
	}
	if (node instanceof Element && node.shadowRoot) {
		this.nodes.serializeTree(node.shadowRoot, depth ?? -1, pierce ?? false);
	}
	const nodes: Protocol.DOM.Node[] = [];
	for (const child of node.childNodes) {
		nodes.push(this.nodes.serializeTree(child, depth ?? -1, pierce ?? false));
	}
	this.emit("DOM.setChildNodes", {
		parentId: nodeId,
		nodes,
	});
	return {};
});

bindCDP("DOM.requestNode", async function (params) {
	const { objectId } = params;
	const obj = this.objects.get(objectId);
	if (obj instanceof Node) {
		return {
			nodeId: this.nodes.getOrCreateId(obj),
		};
	}
	throw new Error("Object is not a node");
});

bindCDP("DOM.getNodeForLocation", async function (params) {
	// TODO: implement includeUserAgentShadowDOM
	const { x, y, includeUserAgentShadowDOM } = params;
	const element = document.elementFromPoint(x, y);
	if (element) {
		const nodeId = this.nodes.getOrCreateId(element);
		return {
			nodeId: nodeId,
			backendNodeId: nodeId,
		};
	}
	return null;
});

bindCDP("DOM.resolveNode", async function (params) {
	const { nodeId, backendNodeId, objectGroup, executionContextId } = params;
	let node: Node | undefined = undefined;
	if (nodeId) {
		node = this.nodes.get(nodeId);
	} else if (backendNodeId) {
		node = this.nodes.get(backendNodeId);
	}
	if (!node) {
		throw new Error("Node not found");
	}
	return {
		object: this.objects.wrap(node),
	};
});

bindCDP("DOM.getBoxModel", async function (params) {
	const { nodeId, backendNodeId, objectId } = params;
	let node: Node | undefined = undefined;
	if (nodeId) {
		node = this.nodes.get(nodeId);
	} else if (backendNodeId) {
		node = this.nodes.get(backendNodeId);
	} else if (objectId) {
		const obj = this.objects.get(objectId);
		if (obj instanceof Node) {
			node = obj;
		}
	}
	if (!node || !(node instanceof Element)) {
		return {
			model: {},
		};
	}
	const rect = node.getBoundingClientRect();
	const style = window.getComputedStyle(node);

	const px = (v: string) => parseFloat(v) || 0;
	const sides = (fmt: (s: string) => string) =>
		["Top", "Right", "Bottom", "Left"].map((s) => px((style as any)[fmt(s)]));
	const [bt, br, bb, bl] = sides((s) => `border${s}Width`);
	const [pt, pr, pb, pl] = sides((s) => `padding${s}`);
	const [mt, mr, mb, ml] = sides((s) => `margin${s}`);
	const quad = (l: number, t: number, r: number, b: number) => [
		l,
		t,
		r,
		t,
		r,
		b,
		l,
		b,
	];

	return {
		model: {
			content: quad(
				rect.left + bl + pl,
				rect.top + bt + pt,
				rect.right - br - pr,
				rect.bottom - bb - pb
			),
			padding: quad(
				rect.left + bl,
				rect.top + bt,
				rect.right - br,
				rect.bottom - bb
			),
			border: quad(rect.left, rect.top, rect.right, rect.bottom),
			margin: quad(
				rect.left - ml,
				rect.top - mt,
				rect.right + mr,
				rect.bottom + mb
			),
			width: rect.width,
			height: rect.height,
		},
	};
});

bindCDP("DOM.getAttributes", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	const attributes: string[] = [];
	for (const attr of node.attributes) {
		attributes.push(attr.name, attr.value);
	}
	return {
		attributes,
	};
});

bindCDP("DOM.getOuterHTML", async function (params) {
	const { nodeId, backendNodeId, objectId } = params;
	let node: Element | undefined = undefined;
	if (nodeId) {
		node = this.nodes.get(nodeId) as Element;
	} else if (backendNodeId) {
		node = this.nodes.get(backendNodeId) as Element;
	} else if (objectId) {
		const obj = this.objects.get(objectId);
		if (obj instanceof Element) {
			node = obj;
		}
	}
	if (!node) {
		throw new Error("Node not found");
	}
	return {
		outerHTML: node.outerHTML,
	};
});

bindCDP("DOM.querySelector", async function (params) {
	const { nodeId, selector } = params;
	const node = this.nodes.resolveElement(nodeId);
	const found = node.querySelector(selector);
	if (found) {
		return {
			nodeId: this.nodes.getOrCreateId(found),
		};
	}
	return {
		nodeId: 0,
	};
});

bindCDP("DOM.querySelectorAll", async function (params) {
	const { nodeId, selector } = params;
	const node = this.nodes.resolveElement(nodeId);
	const found = node.querySelectorAll(selector);
	if (found.length > 0) {
		return {
			nodeIds: [...found].map((n) => this.nodes.wrap(n)),
		};
	}
	return {
		nodeId: 0,
	};
});

// MARK: modify stuff
bindCDP("DOM.setAttributeValue", async function (params) {
	const { nodeId, name, value } = params;
	const node = this.nodes.resolveElement(nodeId);
	node.setAttribute(name, value);
	return {};
});

bindCDP("DOM.setAttributesAsText", async function (params) {
	const { nodeId, text, name } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (name) {
		node.setAttribute(name, text);
	} else {
		// parse text as attributes
		const parser = new DOMParser();
		const doc = parser.parseFromString(`<div ${text}></div>`, "text/html");
		const parsedEl = doc.body.firstElementChild;

		if (parsedEl) {
			for (const attr of parsedEl.attributes) {
				node.setAttribute(attr.name, attr.value);
			}
		}
	}
	return {};
});

bindCDP("DOM.setNodeName", async function (params) {
	const { nodeId, name } = params;
	const old = this.nodes.resolveElement(nodeId);
	const newEl = document.createElement(name);
	// copy attributes
	for (const attr of old.attributes) {
		newEl.setAttribute(attr.name, attr.value);
	}
	// copy children
	while (old.firstChild) {
		newEl.appendChild(old.firstChild);
	}
	old.replaceWith(newEl);
	return {
		nodeId: this.nodes.getOrCreateId(newEl),
	};
});

bindCDP("DOM.setNodeValue", async function (params) {
	const { nodeId, value } = params;
	const node = this.nodes.get(nodeId);
	if (!node) {
		throw new Error("Node not found");
	}
	node.nodeValue = value;
	return {};
});

bindCDP("DOM.setOuterHTML", async function (params) {
	const { nodeId, outerHTML } = params;
	const node = this.nodes.resolveElement(nodeId);
	node.outerHTML = outerHTML;
	return {};
});

bindCDP("DOM.removeNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (node.parentNode) {
		node.parentNode.removeChild(node);
	}
	return {};
});

// this doesnt really do anything like we literally just use the same id but it's required by the protocol
bindCDP("DOM.pushNodesByBackendIdsToFrontend", async function (params) {
	return {
		nodeIds: params.backendNodeIds,
	};
});
