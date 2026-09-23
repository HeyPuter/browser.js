import type { ScramjetClient } from "@client/index";
import {
	_Map as Map,
	_Set as Set,
	Array_includes,
	String_replace,
	String_split,
	drain,
} from "@/shared/snapshot";

type Policy = Map<string, string[]>;
export type CspState = { policies: Policy[]; flush: () => void };

function parse(value: string): Policy {
	const policy: Policy = new Map();
	for (const directive of drain(String_split(value, ";"))) {
		const parts = String_split(
			String_replace(directive, /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ""),
			/[\t\n\f\r ]+/
		);
		const values: string[] = [];
		for (let i = 1; i < parts.length; i++) values[i - 1] = parts[i];
		const key = parts[0].toLowerCase();
		if (key && !policy.has(key)) policy.set(key, values);
	}
	return policy;
}

/** The enforced policy container; it survives removal of a delivering meta. */
export function initializeCsp(client: ScramjetClient): CspState {
	const existing = client.box.cspStates.get(client);
	if (existing) return existing;
	const state: CspState = {
		policies: (client.initHeaders?.get("content-security-policy") ?? "")
			.split(",")
			.map(parse),
		flush() {},
	};
	client.box.cspStates.set(client, state);
	if (!("window" in client.global)) return state;
	const global = new client.native.window(client.global);
	const document = global.document;
	if (!document) return state;
	const doc = new client.native.Document(document);
	if (doc.URL === "about:blank" || doc.URL === "about:srcdoc") {
		const creator =
			global.parent !== client.global ? global.parent : global.opener;
		const parent = creator && client.box.globals.get(creator);
		if (parent && parent !== client) {
			const inherited = policiesFor(parent);
			// Copy the container, not a live link: subsequent parent policies do
			// not change the initial document's policy container.
			const copy: Policy[] = [];
			for (let i = 0; i < inherited.length; i++) copy[i] = inherited[i];
			state.policies = copy;
		}
	}

	const seen = new Set<string>();
	const list = (nodes: NodeList): Node[] => {
		const native = new client.native.NodeList(nodes);
		const result: Node[] = [];
		for (let i = 0; i < native.length; i++) result.push(native.item(i));
		return result;
	};
	const nativeParent = (node: Node) => new client.native.Node(node).parentNode;
	const nativeChildren = (node: Node) =>
		list(new client.native.Node(node).childNodes);
	const attribute = (node: Node, name: string) =>
		new client.native.Element(node).getAttribute(name);
	const tag = (node: Node | null, name: string) => {
		if (!node || new client.native.Node(node).nodeType !== 1) return false;
		const element = new client.native.Element(node);
		return (
			element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
			element.localName === name
		);
	};
	const process = (
		node: Node,
		parent: (node: Node) => Node | null,
		attr: (node: Node, name: string) => string | null
	) => {
		// https://html.spec.whatwg.org/multipage/semantics.html#attr-meta-http-equiv-content-security-policy
		if (!tag(node, "meta") || !tag(parent(node), "head")) return;
		let root = node;
		while (parent(root)) root = parent(root)!;
		if (root !== document) return;
		if (attr(node, "http-equiv")?.toLowerCase() !== "content-security-policy")
			return;
		const value = attr(node, "scramjet-attr-content") ?? attr(node, "content");
		if (!value || seen.has(value)) return;
		seen.add(value);
		const policy = parse(value);
		policy.delete("report-uri");
		policy.delete("frame-ancestors");
		policy.delete("sandbox");
		state.policies.push(policy);
	};
	const visit = (
		node: Node,
		children: (node: Node) => Node[],
		apply: (node: Node) => void
	) => {
		apply(node);
		for (const child of drain(children(node))) visit(child, children, apply);
	};
	visit(document, nativeChildren, (node) =>
		process(node, nativeParent, attribute)
	);

	const consume = (records: MutationRecord[]) => {
		if (!records.length) return;
		// MutationRecord nodes are live. Reconstruct the tree and attributes at
		// each mutation in reverse, without changing the DOM. This preserves a
		// policy inserted, changed or removed before observer delivery/eval.
		const parents = new Map<Node, Node | null>();
		const children = new Map<Node, Node[]>();
		const attributes = new Map<Node, Map<string, string | null>>();
		const parent = (node: Node) =>
			parents.has(node) ? parents.get(node)! : nativeParent(node);
		const kids = (node: Node) => {
			if (!children.has(node)) children.set(node, nativeChildren(node));
			return children.get(node)!;
		};
		const attr = (node: Node, name: string) =>
			attributes.get(node)?.has(name)
				? attributes.get(node)!.get(name)!
				: attribute(node, name);
		for (let i = records.length - 1; i >= 0; i--) {
			const record = new client.native.MutationRecord(records[i]);
			const node = record.target;
			if (record.type === "attributes") {
				process(node, parent, attr);
				if (!attributes.has(node)) attributes.set(node, new Map());
				attributes.get(node)!.set(record.attributeName!, record.oldValue);
			} else {
				const added = list(record.addedNodes);
				for (const child of drain(added))
					visit(child, kids, (item) => process(item, parent, attr));
				for (const child of drain(added)) parents.set(child, null);
				const restored = list(record.removedNodes);
				for (const child of drain(restored)) parents.set(child, node);
				const current = kids(node);
				const next: Node[] = [];
				for (let j = 0; j < current.length; j++) {
					if (!Array_includes(added, current[j]))
						next[next.length] = current[j];
				}
				for (let j = 0; j < restored.length; j++)
					next[next.length] = restored[j];
				children.set(node, next);
			}
		}
	};
	const observer = new global.MutationObserver(consume);
	const nativeObserver = new client.native.MutationObserver(observer);
	nativeObserver.observe(document, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeOldValue: true,
		attributeFilter: ["http-equiv", "content", "scramjet-attr-content"],
	});
	state.flush = () => consume(nativeObserver.takeRecords());
	return state;
}

export function policiesFor(client: ScramjetClient): Policy[] {
	const state = initializeCsp(client);
	state.flush();
	return state.policies;
}

export function assertEvalAllowed(client: ScramjetClient): void {
	// script-src-elem/attr do not control string compilation. Every enforced
	// policy must allow it, with default-src as the fallback for script-src.
	// https://w3c.github.io/webappsec-csp/#can-compile-strings
	const policies = policiesFor(client);
	const trustedRequired = policies.some((policy) =>
		policy.get("require-trusted-types-for")?.includes("'script'")
	);
	for (const policy of drain(policies)) {
		const sources = policy.get("script-src") ?? policy.get("default-src");
		if (
			trustedRequired &&
			sources?.some((value) => value.toLowerCase() === "'trusted-types-eval'")
		)
			continue;
		if (
			sources &&
			!sources.some((value) => value.toLowerCase() === "'unsafe-eval'")
		) {
			const global = new client.native.window(client.global);
			throw new global.EvalError(
				"Evaluating a string as JavaScript violates this document's Content Security Policy."
			);
		}
	}
}
