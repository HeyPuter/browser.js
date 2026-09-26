/**
 * Navigation targets, as the live DOM has to hold them for this document.
 *
 * https://html.spec.whatwg.org/multipage/document-sequences.html#the-rules-for-choosing-a-navigable
 *
 * The browser resolves a `target` itself, against the real frame tree - where
 * the site's top-level document is an iframe in the embedder. So the value it
 * finds in the attribute is not always the page's:
 *
 *   - `_top` means the emulated top-level: `_self` in that document, and the
 *     top-level frame's real name everywhere below it. In a real top-level
 *     window - a popup - it already means that and is left alone.
 *   - `_parent` means `_self` in the emulated top-level, whose real parent is
 *     the embedder, and the real `_parent` everywhere else.
 *   - the name the emulated top-level gave itself (`window.name = "main"`) is
 *     the frame's real name, which the page never sees.
 *
 * Every other value, `_blank` and names of frames the page made included, is
 * the browser's to resolve and is left alone: a subframe's or popup's real
 * name *is* the name the page gave it.
 *
 * The HTML rewriter cannot know any of this - see `shared/targets.ts` - so a
 * document it serves carries a placeholder, and straight after each target
 * that may need its client, a one-line script calling {@link settle}. The
 * parser runs an inline script the moment it has it, so the real value is in
 * place before the parser goes on - before any script of the page's and any
 * input event, the only things that can follow a link or submit a form. The
 * script takes itself out as it runs.
 *
 * Everything a script inserts is either written through the attribute layer,
 * which asks the same question and writes the answer straight away, or moved
 * in whole - a template's clone, a node adopted from another document - and is
 * settled for the document it lands in as it is inserted ({@link inserted}).
 *
 * Only the real attribute is ever touched. The page reads the mirror, which
 * holds what it wrote.
 */

import type { ScramjetClient } from "./client";
import { TARGET_ATTRIBUTES, climbingKeyword } from "@/shared/targets";
import { SCRAMJETCLIENT } from "@/symbols";
import { Array_indexOf } from "@/shared/snapshot";
import { mirrorAttributeName } from "./attributes";

const TARGET_SELECTOR = `[${mirrorAttributeName("target")}],[${mirrorAttributeName("formtarget")}]`;

const ELEMENT_NODE = 1;

/** How far back from its script a target is looked for - see {@link TargetLayer.settle}. */
const SETTLE_REACH = 32;

export class TargetLayer {
	constructor(private readonly client: ScramjetClient) {}

	/**
	 * The value the real attribute should hold for a target the page wrote as
	 * `value`, in this document, right now.
	 */
	rewrite(value: string): string {
		const client = this.client;
		const keyword = climbingKeyword(value);

		if (keyword === "_parent") {
			return client.isEmulatedTop ? "_self" : value;
		}
		if (keyword === "_top") {
			const top = client.topmostClient();
			// a real top-level tree - a popup - where `_top` already means it
			if (!top.isEmulatedTop) return value;
			if (top === client) return "_self";
			// the top-level's name could not be set up. Anywhere but the
			// embedder is better than the embedder
			if (!top.frameName) return "_self";

			return top.frameName.realName;
		}

		return this.resolveName(value) ?? value;
	}

	/**
	 * The real name that reaches a navigable the page calls `name`, when the
	 * browser would not find it by that name itself - which is only ever the
	 * emulated top-level, whose real name is scramjet's.
	 *
	 * The rules search the current navigable's own subtree first, then the
	 * rest of its tree from the top, then other trees the current one is
	 * familiar with. A frame the page named in the subtree wins, so it is left
	 * to the browser; the top-level comes before anything else in its tree; and
	 * a popup can reach the tree that opened it.
	 */
	private resolveName(name: string): string | null {
		if (name === "") return null;
		if (climbingKeyword(name)) return null;

		const client = this.client;

		// the top-level that has the name, if one does - asked first, because
		// it is nearly always none, and the subtree walk below is not free
		let found: ScramjetClient | null = null;
		const seen: Window[] = [];
		let current: ScramjetClient | null = client;
		while (current && Array_indexOf(seen, current.global) === -1) {
			seen[seen.length] = current.global as unknown as Window;

			const root = current.emulatedRoot();
			if (root && root.frameName!.get() === name) {
				found = root;
				break;
			}

			// the tree that opened this one, if this is a popup
			current = openerClient(current);
		}
		if (!found) return null;

		// a frame of the page's own below this document comes first
		if (this.subtreeHasName(client.global as unknown as Window, name))
			return null;

		return found === client ? "_self" : found.frameName!.realName;
	}

	/** Whether `win` or any frame under it has the real name `name`. */
	private subtreeHasName(win: Window, name: string, depth = 0): boolean {
		if (depth > 64) return false;
		try {
			const nWin = new this.client.native.window(win);
			if (nWin.name === name) return true;
			const length = nWin.length;
			for (let i = 0; i < length; i++) {
				if (this.subtreeHasName(win[i], name, depth + 1)) return true;
			}
		} catch {
			// a frame outside the proxy, which the page named or not; it cannot
			// be asked
		}

		return false;
	}

	/**
	 * What the script after a served target calls: settle the target it
	 * follows, then take the script out.
	 *
	 * The target is the nearest element before the script, in tree order, that
	 * has one. That is the element itself in nearly every document - the
	 * script is its first child, or its next sibling for a void one - and it
	 * still finds it when the parser has moved one of the two: an `<a>` in a
	 * table is placed in front of the table, while the script stays in it.
	 *
	 * Everything is read and written through the natives, so a page script
	 * that ran earlier cannot see this run, or steer it.
	 */
	settle(shadows?: number) {
		const client = this.client;
		const document = client.global.document;
		const script = new client.native.Document(document).currentScript;
		if (!script) return;

		if (shadows === 1) {
			// the script follows a shadow host: everything in its declarative
			// shadow trees, which it could not follow from inside
			const host = new client.native.Element(script).previousElementSibling;
			if (host) this.fixShadows(host);
			new client.native.Element(script).remove();

			return;
		}

		let node: Node | null = script;
		for (let steps = 0; steps < SETTLE_REACH && node; steps++) {
			node = previousInTreeOrder(client, node);
			if (!node || new client.native.Node(node).nodeType !== ELEMENT_NODE)
				continue;
			if (this.hasTarget(node as Element)) {
				this.fixElement(node as Element);
				break;
			}
		}

		new client.native.Element(script).remove();
	}

	/** Every target in `host`'s open shadow tree, and in the shadow trees inside that. */
	private fixShadows(host: Element, depth = 0) {
		if (depth > 32) return;
		const client = this.client;
		const root = new client.native.Element(host).shadowRoot;
		if (!root) return;
		this.fix(root);
		const all = new client.native.DocumentFragment(root).querySelectorAll("*");
		for (let i = 0; i < all.length; i++) {
			if (new client.native.Element(all[i]).shadowRoot)
				this.fixShadows(all[i], depth + 1);
		}
	}

	/**
	 * The targets among `nodes`, for {@link settle} to write once they are
	 * inserted. Read before the insertion, because a fragment is empty after.
	 */
	collect(nodes: readonly unknown[]): Element[] | null {
		const client = this.client;
		let found: Element[] | null = null;

		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node || typeof node !== "object") continue;
			let type: number;
			try {
				type = new client.native.Node(node as Node).nodeType;
			} catch {
				continue;
			}
			if (type !== ELEMENT_NODE && type !== 11) continue;

			if (type === ELEMENT_NODE && this.hasTarget(node as Element)) {
				found ??= [];
				found[found.length] = node as Element;
			}
			if (!new client.native.Node(node as Node).firstChild) continue;
			const within: NodeListOf<Element> = (
				type === 11
					? new client.native.DocumentFragment(node as DocumentFragment)
					: new client.native.Element(node as Element)
			).querySelectorAll(TARGET_SELECTOR);
			for (let j = 0; j < within.length; j++) {
				found ??= [];
				found[found.length] = within[j];
			}
		}

		return found;
	}

	/**
	 * Settle `elements` for the document they are now in - which is the
	 * answer's to give, not the inserting realm's.
	 */
	static inserted(elements: Element[], via: ScramjetClient) {
		for (let i = 0; i < elements.length; i++) {
			const element = elements[i];
			try {
				const document = new via.native.Node(element).ownerDocument;
				if (!document) continue;
				const owner: ScramjetClient | undefined = (document as any)[
					SCRAMJETCLIENT
				];
				if (owner && owner.targets) owner.targets.fixElement(element);
			} catch {}
		}
	}

	private hasTarget(element: Element): boolean {
		const attrs = this.client.attributes;
		const tag = attrs.localName(element);
		for (let i = 0; i < TARGET_ATTRIBUTES.length; i++) {
			const { name, tags } = TARGET_ATTRIBUTES[i];
			if (Array_indexOf(tags, tag) === -1) continue;
			if (attrs.raw.has(element, mirrorAttributeName(name))) return true;
		}

		return false;
	}

	/** Correct every target at or under `node`. */
	fix(node: Node) {
		const client = this.client;
		const nNode = new client.native.Node(node);
		const type = nNode.nodeType;
		if (type === ELEMENT_NODE) this.fixElement(node as Element);
		// an element's descendants, or a document's or fragment's
		if (type !== ELEMENT_NODE && type !== 9 && type !== 11) return;
		if (!nNode.firstChild) return;

		const found: NodeListOf<Element> = (
			type === 9
				? new client.native.Document(node as Document)
				: type === 11
					? new client.native.DocumentFragment(node as DocumentFragment)
					: new client.native.Element(node as Element)
		).querySelectorAll(TARGET_SELECTOR);
		for (let i = 0; i < found.length; i++) this.fixElement(found[i]);
	}

	fixElement(element: Element) {
		const attrs = this.client.attributes;
		const tag = attrs.localName(element);

		for (let i = 0; i < TARGET_ATTRIBUTES.length; i++) {
			const { name, tags } = TARGET_ATTRIBUTES[i];
			if (Array_indexOf(tags, tag) === -1) continue;
			const value = attrs.raw.get(element, mirrorAttributeName(name));
			if (value === null) continue;

			const wanted = this.rewrite(value);
			if (attrs.raw.get(element, name) !== wanted) {
				attrs.raw.set(element, name, wanted);
			}
		}
	}

	/**
	 * The emulated top-level's name changed: every target that named it by
	 * the old name or the new one has a different answer now, in every
	 * document of its tree and in the popups it opened.
	 */
	static topNameChanged(root: ScramjetClient) {
		const visit = (win: Window, depth: number) => {
			if (depth > 64) return;
			try {
				const client: ScramjetClient | undefined = win[SCRAMJETCLIENT];
				if (client && client.targets) client.targets.fix(client.global.document);
				const length = new root.native.window(win).length;
				for (let i = 0; i < length; i++) visit(win[i], depth + 1);
			} catch {}
		};

		visit(root.global as unknown as Window, 0);

		// the closed ones are let go on the way
		const popups = root.frameName!.popups;
		let kept = 0;
		for (let i = 0; i < popups.length; i++) {
			let open = false;
			try {
				open = !new root.native.window(popups[i]).closed;
			} catch {}
			if (!open) continue;
			visit(popups[i], 0);
			popups[kept++] = popups[i];
		}
		popups.length = kept;
	}
}

/** The client of the window that opened `client`'s tree, if it is one of scramjet's. */
export function openerClient(client: ScramjetClient): ScramjetClient | null {
	try {
		const top = client.topmostClient();
		const opener = new client.native.window(top.global).opener;
		if (!opener) return null;

		return (opener as Window)[SCRAMJETCLIENT] ?? null;
	} catch {
		return null;
	}
}


/** The node before `node` in tree order: its previous sibling's last descendant, or its parent. */
function previousInTreeOrder(client: ScramjetClient, node: Node): Node | null {
	const nNode = new client.native.Node(node);
	let previous = nNode.previousSibling;
	if (!previous) return nNode.parentNode;
	for (;;) {
		const last = new client.native.Node(previous).lastChild;
		if (!last) return previous;
		previous = last;
	}
}
