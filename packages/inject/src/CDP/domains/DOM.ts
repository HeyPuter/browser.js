import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";

let observer: MutationObserver | undefined = undefined;

// MARK: helpers
// resolve a node from any of the identifiers the protocol allows
// (backend ids are the same as node ids here)
function resolveTarget(
	session: CDPSession,
	{
		nodeId,
		backendNodeId,
		objectId,
	}: {
		nodeId?: Protocol.DOM.NodeId;
		backendNodeId?: Protocol.DOM.BackendNodeId;
		objectId?: Protocol.Runtime.RemoteObjectId;
	}
): Node | undefined {
	if (nodeId) return session.nodes.get(nodeId);
	if (backendNodeId) return session.nodes.get(backendNodeId);
	if (objectId) {
		const obj = session.objects.get(objectId);
		if (obj instanceof Node) return obj;
	}
	return undefined;
}

function handleMutation(session: CDPSession, mutation: MutationRecord) {
	const id = (node: Node) => session.nodes.getOrCreateId(node);

	switch (mutation.type) {
		case "attributes": {
			const name = mutation.attributeName!;
			const target = mutation.target as Element;
			if (target.hasAttribute(name)) {
				session.emit("DOM.attributeModified", {
					nodeId: id(target),
					name,
					value: target.getAttribute(name)!,
				});
			} else {
				session.emit("DOM.attributeRemoved", { nodeId: id(target), name });
			}
			break;
		}
		case "childList": {
			const parentNodeId = id(mutation.target);
			for (const added of mutation.addedNodes) {
				session.emit("DOM.childNodeInserted", {
					parentNodeId,
					previousNodeId: added.previousSibling ? id(added.previousSibling) : 0,
					node: session.nodes.serializeTree(added, -1, false),
				});

				// register new stylesheets as they're added
				// was gonna make a separate observer but like.......
				if (session.isDomainEnabled("CSS") && "sheet" in added) {
					const sheet = (added as HTMLStyleElement | HTMLLinkElement).sheet;
					if (sheet) session.styles.register(sheet);
				}
			}
			for (const removed of mutation.removedNodes) {
				session.emit("DOM.childNodeRemoved", {
					parentNodeId,
					nodeId: id(removed),
				});
			}
			break;
		}
		case "characterData":
			session.emit("DOM.characterDataModified", {
				nodeId: id(mutation.target),
				characterData: mutation.target.nodeValue ?? "",
			});
			break;
	}
}

// MARK: enable/disable
bindCDP("DOM.enable", async function () {
	observer?.disconnect();
	observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) handleMutation(this, mutation);
	});
	observer.observe(document, {
		attributes: true,
		childList: true,
		characterData: true,
		subtree: true,
	});

	this.enableDomain("DOM");
});

bindCDP("DOM.disable", async function () {
	this.disableDomain("DOM");
	observer?.disconnect();
});

// MARK: nodes
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
	const { nodeId, depth = -1, pierce = false } = params;
	const node = this.nodes.resolveNode(nodeId);
	if (node instanceof Element && node.shadowRoot) {
		this.nodes.serializeTree(node.shadowRoot, depth, pierce);
	}
	const nodes = [...node.childNodes].map((child) =>
		this.nodes.serializeTree(child, depth, pierce)
	);
	this.emit("DOM.setChildNodes", {
		parentId: nodeId,
		nodes,
	});
	return {};
});

bindCDP("DOM.requestNode", async function (params) {
	const obj = this.objects.get(params.objectId);
	if (!(obj instanceof Node)) {
		throw new Error("Object is not a node");
	}
	return { nodeId: this.nodes.getOrCreateId(obj) };
});

bindCDP("DOM.resolveNode", async function (params) {
	const node = resolveTarget(this, params);
	if (!node) {
		throw new Error("Node not found");
	}
	return {
		object: this.objects.wrap(node),
	};
});

bindCDP("DOM.getNodeForLocation", async function (params) {
	// TODO: implement includeUserAgentShadowDOM
	const { x, y } = params;
	const element = document.elementFromPoint(x, y);
	if (!element) {
		return null;
	}
	const nodeId = this.nodes.getOrCreateId(element);
	return { nodeId, backendNodeId: nodeId };
});

// this doesnt really do anything like we literally just use the same id but it's required by the protocol
bindCDP("DOM.pushNodesByBackendIdsToFrontend", async function (params) {
	return { nodeIds: params.backendNodeIds };
});

// MARK: inspecting
bindCDP("DOM.getBoxModel", async function (params) {
	const node = resolveTarget(this, params);
	if (!(node instanceof Element)) {
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
	const node = this.nodes.resolveElement(params.nodeId);
	return {
		attributes: [...node.attributes].flatMap((attr) => [attr.name, attr.value]),
	};
});

bindCDP("DOM.getOuterHTML", async function (params) {
	const node = resolveTarget(this, params);
	if (!(node instanceof Element)) {
		throw new Error("Node not found");
	}
	return {
		outerHTML: node.outerHTML,
	};
});

// MARK: querying
bindCDP("DOM.querySelector", async function (params) {
	const { nodeId, selector } = params;
	const node = this.nodes.resolveElement(nodeId);
	const found = node.querySelector(selector);
	return {
		nodeId: found ? this.nodes.getOrCreateId(found) : 0,
	};
});

bindCDP("DOM.querySelectorAll", async function (params) {
	const { nodeId, selector } = params;
	const node = this.nodes.resolveElement(nodeId);
	return {
		nodeIds: [...node.querySelectorAll(selector)].map((n) =>
			this.nodes.getOrCreateId(n)
		),
	};
});

// MARK: modifying
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
		const doc = new DOMParser().parseFromString(
			`<div ${text}></div>`,
			"text/html"
		);
		for (const attr of doc.body.firstElementChild?.attributes ?? []) {
			node.setAttribute(attr.name, attr.value);
		}
	}
	return {};
});

bindCDP("DOM.setNodeName", async function (params) {
	const { nodeId, name } = params;
	const old = this.nodes.resolveElement(nodeId);
	const newEl = document.createElement(name);
	for (const attr of old.attributes) {
		newEl.setAttribute(attr.name, attr.value);
	}
	newEl.append(...old.childNodes);
	old.replaceWith(newEl);
	return {
		nodeId: this.nodes.getOrCreateId(newEl),
	};
});

bindCDP("DOM.setNodeValue", async function (params) {
	const { nodeId, value } = params;
	const node = this.nodes.resolveNode(nodeId);
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
	node.remove();
	return {};
});
