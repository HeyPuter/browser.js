import { rewriteHtml } from "@rewriters/html";
import { ScramjetClient } from "@client/index";
import { ForeignContext } from "@/shared/rewriters/html";
import { Reflect_apply, String } from "@/shared/snapshot";
import { Arguments, Returns } from "@client/webidl";
import { foreignContextForElement } from "@client/dom/markup";
import { textAccess } from "@client/dom/node";

const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const DOCUMENT_NODE = 9;
const DOCUMENT_TYPE_NODE = 10;
const DOCUMENT_FRAGMENT_NODE = 11;

function foreignContextForRange(
	client: ScramjetClient,
	range: Range
): ForeignContext {
	const nRange = new client.native.Range(range);
	const node = nRange.startContainer;
	const nNode = new client.native.Node(node);
	const element = nNode.nodeType === 1 ? node : nNode.parentElement;
	if (!element) return "html";

	return foreignContextForElement(client, element as Element);
}

export default function (client: ScramjetClient, _self: Self) {
	const text = textAccess(client);
	const range = client.nativeStore.get("Range")!;
	const node = client.nativeStore.get("Node")!;
	const element = client.nativeStore.get("Element")!;

	const nStartContainer = range.startContainer.get;
	const nStartOffset = range.startOffset.get;
	const nEndContainer = range.endContainer.get;
	const nCollapsed = range.collapsed.get;
	const nCommonAncestor = range.commonAncestorContainer.get;
	const nSetEnd = range.setEnd.value;
	const nSelectNode = range.selectNode.value;
	const nExtractContents = range.extractContents.value;
	const nParentNode = node.parentNode.get;
	const nPreviousSibling = node.previousSibling.get;
	const nChildNodes = node.childNodes.get;
	const nContains = node.contains.value;
	const nInsertBefore = node.insertBefore.value;
	const nAppendChild = node.appendChild.value;
	const nReplaceChildren = element.replaceChildren.value;

	const parentOf = (n: Node): Node | null => Reflect_apply(nParentNode, n, []);
	const isText = (n: Node) => {
		const what = text.type(n);

		return what === TEXT_NODE || what === CDATA_SECTION_NODE;
	};
	const isRawText = (n: Node | null): n is Element =>
		n !== null &&
		text.type(n) === ELEMENT_NODE &&
		text.kind(n as Element) !== null;

	const indexOf = (n: Node): number => {
		let index = 0;
		for (
			let sibling = Reflect_apply(nPreviousSibling, n, []);
			sibling;
			sibling = Reflect_apply(nPreviousSibling, sibling, [])
		) {
			index++;
		}

		return index;
	};

	const hierarchyRequest = (member: string, detail: string) =>
		client.errors.domException("HierarchyRequestError", {
			execute: member,
			on: "Range",
			detail,
		});

	/**
	 * https://dom.spec.whatwg.org/#concept-range-insert, for the one case the
	 * native cannot be trusted with: a start inside a script's or a style's
	 * Text. The split in step 7 would cut the *rewritten* program at an offset
	 * into the page's, and the new tail would carry rewritten code out as the
	 * page's text - so the split is done over the page's text instead, and the
	 * insertion goes through the same blanking as every other one.
	 *
	 * Returns false when the native can do it all.
	 */
	const insertIntoRawText = (self: Range, inserted: Node, member: string) => {
		const start: Node = Reflect_apply(nStartContainer, self, []);
		if (!isText(start)) return false;

		const parent = parentOf(start);
		if (!isRawText(parent)) return false;

		// 1. If range's start node is node, throw
		if (start === inserted) {
			throw hierarchyRequest(
				member,
				"The node to be inserted is the start node."
			);
		}

		// 6. Ensure pre-insertion validity of node into parent. the parent is an
		//    element, so what is left of the checks is the node's type and the
		//    cycle
		const what = text.type(inserted);
		if (
			what === DOCUMENT_NODE ||
			what === DOCUMENT_TYPE_NODE ||
			what === ATTRIBUTE_NODE
		) {
			throw hierarchyRequest(member, "The node cannot be inserted here.");
		}
		if (Reflect_apply(nContains, inserted, [parent])) {
			throw hierarchyRequest(
				member,
				"The new child element contains the parent."
			);
		}

		const collapsed: boolean = Reflect_apply(nCollapsed, self, []);
		const offset: number = Reflect_apply(nStartOffset, self, []);

		// 7. split the start node - over the page's text
		let reference: Node | null = text.split(start as Text, offset);
		// 8. If node is referenceNode, set referenceNode to its next sibling
		if (inserted === reference) reference = null;

		// 10-11. the offset the range's end moves to if it was collapsed
		let newOffset =
			reference === null
				? Reflect_apply(nChildNodes, parent, []).length
				: indexOf(reference);
		newOffset +=
			what === DOCUMENT_FRAGMENT_NODE
				? Reflect_apply(nChildNodes, inserted, []).length
				: 1;

		// 9, 12. remove it from where it was and insert it, blanked
		text.around(parent, [inserted], () =>
			Reflect_apply(nInsertBefore, parent, [inserted, reference])
		);

		// 13. If range is collapsed, set range's end to (parent, newOffset)
		if (collapsed) Reflect_apply(nSetEnd, self, [parent, newOffset]);

		return true;
	};

	/**
	 * https://dom.spec.whatwg.org/#concept-range-bp - whether a node other than
	 * a Text is partially contained, which `surroundContents` refuses. Only the
	 * start's and the end's ancestors below the common ancestor can be.
	 */
	const hasPartiallyContainedNonText = (self: Range): boolean => {
		const common: Node = Reflect_apply(nCommonAncestor, self, []);
		const ends = [
			Reflect_apply(nStartContainer, self, []),
			Reflect_apply(nEndContainer, self, []),
		];
		for (let i = 0; i < ends.length; i++) {
			for (let n: Node | null = ends[i]; n && n !== common; n = parentOf(n)) {
				if (!isText(n)) return true;
			}
		}

		return false;
	};

	client.Intercept(class extends Range {
		@Returns("DocumentFragment")
		@Arguments("(TrustedHTML or DOMString)")
		createContextualFragment(string: string | TrustedHTML): DocumentFragment {
			const html = String(string);
			const rewritten = rewriteHtml(html, client.context, client.meta, {
				loadScripts: false,
				inline: true,
				source: client.url.href,
				apisource: "Range.prototype.createContextualFragment",
				foreignContext: foreignContextForRange(client, this),
			});

			return super.createContextualFragment(rewritten);
		}

		// an insertion like any other, and one that can land Text in a script
		@Arguments("Node")
		@Returns("undefined")
		insertNode(node: Node): void {
			void super.collapsed;
			if (insertIntoRawText(this, node, "insertNode")) return;

			// the parent the native will insert into: the start node, or the
			// parent of the Text it splits
			const start = super.startContainer;
			const parent = isText(start) ? parentOf(start) : start;

			text.around(parent, [node], () => super.insertNode(node));
		}

		// https://dom.spec.whatwg.org/#dom-range-surroundcontents - the native
		// appends the extracted text to `newParent` *after* inserting it, so a
		// script or a style as the new parent is connected - and prepared - by
		// the time its text lands. Done step by step for those, so that the
		// append goes through the blanking every other insertion does
		@Arguments("Node")
		@Returns("undefined")
		surroundContents(newParent: Node): void {
			void super.collapsed;
			if (!isRawText(newParent)) return super.surroundContents(newParent);

			// 1. a partially contained non-Text node is an InvalidStateError
			if (hasPartiallyContainedNonText(this)) {
				throw client.errors.domException("InvalidStateError", {
					execute: "surroundContents",
					on: "Range",
					detail: "The Range has partially selected a non-Text node.",
				});
			}
			// 2. newParent is an element, so it is never the wrong type

			// 3. Let fragment be the result of extracting this
			const fragment: DocumentFragment = Reflect_apply(
				nExtractContents,
				this,
				[]
			);
			// 4. If newParent has children, replace all with null within it
			Reflect_apply(nReplaceChildren, newParent, []);
			// 5. Insert newParent into this
			if (!insertIntoRawText(this, newParent, "surroundContents")) {
				const start = super.startContainer;
				const parent = isText(start) ? parentOf(start) : start;
				text.around(parent, [newParent], () => super.insertNode(newParent));
			}
			// 6. Append fragment to newParent - blanked on the way in
			text.around(newParent, [fragment], () =>
				Reflect_apply(nAppendChild, newParent, [fragment])
			);
			// 7. Select newParent within this
			Reflect_apply(nSelectNode, this, [newParent]);
		}
	});
}
