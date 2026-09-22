/**
 * Text, and the source of a script or style element.
 *
 * A script element's children are its program and a style element's are its
 * stylesheet, so both go through a rewriter on the way in and have to come back
 * out unrewritten. Everything else in the tree is text like any other.
 *
 * The model is one string per element - its "child text content", the
 * concatenation of its Text children - held two ways at once:
 *
 *   - what the page wrote, per node, in `box.characterDataSources` (and, for a
 *     script, in the `scramjet-attr-script-source-src` attribute, which is
 *     where the HTML rewriter leaves it and which survives cloning)
 *   - what the document holds, which is the rewritten whole in the *first* Text
 *     child with every later one emptied, so that the browser's own
 *     concatenation is exactly the rewritten program
 *
 * Every member that can change that text - `textContent`, `innerText`,
 * `script.text`, the `CharacterData` mutators, and every insertion method that
 * can put a Text node under a script - re-derives the first from its parts and
 * rewrites it whole. Rewriting a fragment on its own is not an option: half a
 * program does not parse, and the half that does would run unrewritten.
 *
 * The order matters as much as the content. A connected script that has not
 * executed yet is prepared - and runs - the moment its children change
 * (https://html.spec.whatwg.org/multipage/scripting.html#script-children-changed-steps),
 * so nothing may reach the DOM before it has been through the rewriter. That is
 * why an insertion blanks the text it is inserting, inserts it, and only then
 * writes the rewritten whole.
 *
 * https://dom.spec.whatwg.org/#interface-characterdata
 * https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute
 */

import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import { attrValue, setAttrValue } from "@client/dom/attr";
import {
	attributeAccess,
	HTML_NAMESPACE,
	mirroredAttributeName,
	SCRIPT_SOURCE_ATTRIBUTE,
} from "@client/dom/element";
import {
	getScriptBlockTypeString,
	isModuleScriptType,
	isScriptType,
} from "@/shared/mime";
import { rewriteCss, unrewriteCss } from "@rewriters/css";
import { rewriteJs } from "@rewriters/js";
import { rewriteUrl } from "@rewriters/url";
import { base64Decode, bytesToBase64 } from "@/shared/util";
import {
	JSON_parse,
	JSON_stringify,
	Object_hasOwn,
	Reflect_apply,
	String,
	String_substring,
	String_toLowerCase,
	TextEncoder_encode,
	_WeakMap,
} from "@/shared/snapshot";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Node types, as `Node.prototype.nodeType` reports them. */
const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

/** A script or a style: an element whose children are code rather than text. */
export type RawTextKind = "script" | "style";

/** The text layer, bound to one client. See {@link textAccess}. */
export type TextAccess = {
	/** Whether `element` is a script or a style, in HTML or in SVG. */
	kind(element: Element): RawTextKind | null;
	/** The child text content of `element`, as the page wrote it. */
	source(element: Element): string;
	/** Replace the child text content of `element`, rewriting it. */
	setSource(element: Element, text: string): void;
	/** One node's data, as the page wrote it. */
	data(node: CharacterData): string;
	/** Replace one node's data, rewriting the element it belongs to. */
	setData(node: CharacterData, text: string): void;
	/**
	 * Record what `node` says and empty it, without touching anything else.
	 *
	 * What a node about to be inserted into a script goes through, so that the
	 * insertion - which can prepare and run the element - lands nothing the
	 * rewriter has not seen.
	 */
	blank(node: CharacterData): void;
	/** Hand `node` back its own text, for a move out of a script into plain text. */
	restore(node: CharacterData): void;
	/** Re-derive `element`'s live text from its children's recorded data. */
	sync(element: Element): void;
	/** The descendant text content of `node`, as the page wrote it. */
	descendantText(node: Node): string;
	/** Whether anything under `node` is a script or a style. */
	containsRawText(node: Node): boolean;
	/** `node`'s parent element, or null. */
	parent(node: Node): Element | null;
	/** `node`'s type, as `nodeType` reports it. */
	type(node: Node): number;
	/** A fresh Text node in `node`'s document, carrying `text` as its data. */
	createText(node: Node, text: string): Text;
	/** The Text children of `element`, in order. */
	textChildren(element: Element): CharacterData[];
	/**
	 * Record every Text child of a script or style that has no record yet.
	 *
	 * Run before anything changes the element's children. A script straight
	 * out of the HTML rewriter has one Text child holding the rewritten
	 * program and its source only in {@link SCRIPT_SOURCE_ATTRIBUTE}, which
	 * answers for that child only while it is the only one - so the record has
	 * to be taken while it still is.
	 */
	adopt(element: Element): void;
	/** Whether `value` is really a Node - a brand check, not a prototype walk. */
	isNode(value: unknown): boolean;
	/**
	 * Run `insert`, a native insertion of `nodes` into `parent`, with every
	 * Text node it moves into or out of a script or a style handled around it.
	 * See {@link insertion}.
	 */
	around<T>(parent: Node | null, nodes: readonly unknown[], insert: () => T): T;
	/**
	 * Insert a new Text node carrying `value` into `parent` before
	 * `reference`, as the page's text: rewritten whole when `parent` is a
	 * script or a style. Throws what the native `insertBefore` throws.
	 */
	insertText(parent: Node, reference: Node | null, value: string): Text;
	/**
	 * `splitText` over the page's text rather than the rewritten text the
	 * document holds. Only for a node inside a script or a style.
	 */
	split(node: Text, offset: number): Text;
};

const layers = new _WeakMap<ScramjetClient, TextAccess>([]);

/**
 * The text primitives for `client`, built once.
 *
 * Exported because `dom/markup.ts` serves the same text under two more names:
 * a script's `innerHTML` is its source, and a style's is its stylesheet.
 */
export function textAccess(client: ScramjetClient): TextAccess {
	const existing = layers.get(client);
	if (existing) return existing;

	const attrs = attributeAccess(client);
	const node = client.nativeStore.get("Node")!;
	const characterData = client.nativeStore.get("CharacterData")!;
	const element = client.nativeStore.get("Element")!;
	const fragment = client.nativeStore.get("DocumentFragment")!;
	const document = client.nativeStore.get("Document")!;

	const nNodeType = node.nodeType.get;
	const nParentElement = node.parentElement.get;
	const nFirstChild = node.firstChild.get;
	const nNextSibling = node.nextSibling.get;
	const nOwnerDocument = node.ownerDocument.get;
	const nSetTextContent = node.textContent.set;
	const nGetData = characterData.data.get;
	const nSetData = characterData.data.set;
	const nNamespaceURI = element.namespaceURI.get;
	// `childElementCount` and `querySelector` are installed once per interface
	// that mixes ParentNode in, and each copy brand checks for its own - so a
	// DocumentFragment has to be asked with the fragment's
	const nChildElementCount = element.childElementCount.get;
	const nQuerySelector = element.querySelector.value;
	const nFragmentChildElementCount = fragment.childElementCount.get;
	const nFragmentQuerySelector = fragment.querySelector.value;
	const nCreateTextNode = document.createTextNode.value;
	const nInsertBefore = node.insertBefore.value;
	const nAppendChild = node.appendChild.value;
	const nRemoveChild = node.removeChild.value;
	const nIsConnected = node.isConnected.get;
	const nGetTextContent = node.textContent.get;
	const nAfter = characterData.after.value;

	const type = (node: Node): number => Reflect_apply(nNodeType, node, []);
	const parent = (node: Node): Element | null =>
		Reflect_apply(nParentElement, node, []);
	const parent_ = parent;
	const firstChild = (node: Node): Node | null =>
		Reflect_apply(nFirstChild, node, []);
	const nextSibling = (node: Node): Node | null =>
		Reflect_apply(nNextSibling, node, []);
	const rawData = (node: CharacterData): string =>
		Reflect_apply(nGetData, node, []);
	const writeData = (node: CharacterData, text: string): void => {
		Reflect_apply(nSetData, node, [text]);
	};

	const kind = (element: Element): RawTextKind | null => {
		const namespace = Reflect_apply(nNamespaceURI, element, []);
		// an element named "script" in some other namespace is not one, and
		// running its text through a javascript rewriter would corrupt it
		if (namespace !== HTML_NAMESPACE && namespace !== SVG_NAMESPACE) {
			return null;
		}

		const local = attrs.localName(element);
		if (local === "script") return "script";
		if (local === "style") return "style";

		return null;
	};

	/**
	 * https://html.spec.whatwg.org/multipage/scripting.html#the-script-element -
	 * what the `type` and `language` attributes say this script block is. Read
	 * through the mirror, because that is what the page believes it set.
	 */
	const scriptBlockType = (element: Element): string => {
		const type = attrs.get(element, "type");
		const language = attrs.get(element, "language");

		// an attribute is present exactly when the mirror-aware read answers with
		// something, so the two "has" flags are the same test
		return getScriptBlockTypeString(
			type,
			language,
			type !== null,
			language !== null
		);
	};

	/**
	 * How this element's text has to be rewritten, or null when it is not
	 * rewritten at all - `<script type="application/json">` is data, and the
	 * page has to get back exactly the bytes it wrote.
	 */
	const rewriterFor = (element: Element): ((text: string) => string) | null => {
		const what = kind(element);
		if (what === null) return null;
		if (what === "style") {
			return (text) => rewriteCss(text, client.context, client.meta);
		}

		const blockType = scriptBlockType(element);
		if (isScriptType(blockType)) {
			const module = isModuleScriptType(blockType);

			return (text) =>
				rewriteJs(
					text,
					"(anonymous script element)",
					client.context,
					client.meta,
					module
				) as string;
		}

		// an import map's specifiers are URLs the module loader will resolve, so
		// they go through the same rewrite the HTML rewriter gives a parsed one
		if (String_toLowerCase(blockType) === "importmap") {
			return (text) => rewriteImportMap(text);
		}

		return null;
	};

	const rewriteImportMap = (json: string): string => {
		try {
			const map = JSON_parse(json);
			if (map && map.imports) {
				for (const key in map.imports) {
					const url = map.imports[key];
					if (typeof url === "string") {
						map.imports[key] = rewriteUrl(url, client.context, client.meta, {
							isModule: true,
						});
					}
				}
			}

			return JSON_stringify(map);
		} catch (err) {
			dbg.error("failed to parse an importmap", err);

			return json;
		}
	};

	const textChildren = (element: Element): CharacterData[] => {
		const out: CharacterData[] = [];
		for (let child = firstChild(element); child; child = nextSibling(child)) {
			const what = type(child);
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				out[out.length] = child as CharacterData;
			}
		}

		return out;
	};

	const data = (node: CharacterData): string => {
		const known = client.box.characterDataSources.get(node);
		if (known !== undefined) return known;

		const owner = parent(node);
		if (!owner) return rawData(node);

		const what = kind(owner);
		if (what === null) return rawData(node);

		if (what === "script") {
			// the attribute carries the source of the *whole* element, so it only
			// answers for a node that is the whole of it - which is every script
			// the HTML rewriter produced
			const encoded = attrs.raw.get(owner, SCRIPT_SOURCE_ATTRIBUTE);
			if (encoded !== null) {
				const children = textChildren(owner);
				if (children.length === 1 && children[0] === node) {
					return base64Decode(encoded);
				}
			}

			return rawData(node);
		}

		// a style has nowhere to keep its source, so the un-rewriter is what
		// recovers a stylesheet that came down in the markup
		return unrewriteCss(rawData(node), client.context);
	};

	const source = (element: Element): string => {
		const children = textChildren(element);
		let out = "";
		for (let i = 0; i < children.length; i++) out += data(children[i]);

		return out;
	};

	/** Record the script source alongside the element, the way the parser does. */
	const recordSource = (element: Element, text: string) => {
		if (kind(element) !== "script") return;

		if (rewriterFor(element)) {
			attrs.raw.set(
				element,
				SCRIPT_SOURCE_ATTRIBUTE,
				bytesToBase64(TextEncoder_encode(text))
			);
		} else {
			// the text is not rewritten, so there is nothing to recover and a
			// stale attribute would answer for it forever
			attrs.raw.remove(element, SCRIPT_SOURCE_ATTRIBUTE);
		}
	};

	const sync = (element: Element) => {
		const rewrite = rewriterFor(element);
		const children = textChildren(element);

		if (!rewrite) {
			// not rewritten: the document holds what the page wrote, node for node
			for (let i = 0; i < children.length; i++) {
				const text = data(children[i]);
				client.box.characterDataSources.delete(children[i]);
				if (rawData(children[i]) !== text) writeData(children[i], text);
			}
			recordSource(element, "");

			return;
		}

		let text = "";
		for (let i = 0; i < children.length; i++) text += data(children[i]);

		const rewritten = rewrite(text);

		// recorded before any of the writes below, each of which can run the
		// script - and code that reads `document.currentScript.text` from inside
		// it has to get the page's source back, not the rewritten one
		recordSource(element, text);

		// the later nodes are emptied *first*. every one of these writes is a
		// children-changed, and a connected script that has not run yet is
		// prepared on each of them - so the last state the element passes through
		// has to be the complete rewritten program, never a half of it followed
		// by the tail of the last one
		for (let i = children.length - 1; i > 0; i--) {
			if (rawData(children[i]) !== "") writeData(children[i], "");
		}
		if (children.length > 0 && rawData(children[0]) !== rewritten) {
			writeData(children[0], rewritten);
		}
	};

	const setSource = (element: Element, text: string) => {
		const rewrite = rewriterFor(element);

		// first, for the reason `sync` gives: the write can run the script, and
		// until the new child has a record of its own the attribute is what
		// answers for it
		recordSource(element, text);

		Reflect_apply(nSetTextContent, element, [rewrite ? rewrite(text) : text]);

		const child = firstChild(element);
		if (child)
			client.box.characterDataSources.set(child as CharacterData, text);
	};

	const setData = (node: CharacterData, text: string) => {
		const owner = parent(node);

		if (!owner || kind(owner) === null) {
			// plain text: what the page wrote is what the document holds, and a
			// record left over from a script this node used to live in would
			// answer for it forever
			client.box.characterDataSources.delete(node);
			writeData(node, text);

			return;
		}

		adopt(owner);
		client.box.characterDataSources.set(node, text);
		sync(owner);
	};

	const containsRawText = (node: Node): boolean => {
		const what = type(node);
		if (what === ELEMENT_NODE && kind(node as Element) !== null) return true;

		const isFragment = what === DOCUMENT_FRAGMENT_NODE;
		const count = isFragment ? nFragmentChildElementCount : nChildElementCount;
		const query = isFragment ? nFragmentQuerySelector : nQuerySelector;

		// something with no element children can have no script or style under
		// it, and this is the read path of every `textContent` in the document
		if (Reflect_apply(count, node, []) === 0) return false;

		return !!Reflect_apply(query, node, ["script,style"]);
	};

	/**
	 * Only the branches that lead to a script or a style are walked here; a
	 * subtree with neither under it is answered by the native `textContent`
	 * in one call, which is what keeps `document.body.textContent` from being
	 * a JS walk over the whole document.
	 */
	const descendantText = (node: Node): string => {
		let out = "";

		for (let child = firstChild(node); child; child = nextSibling(child)) {
			const what = type(child);
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				out += data(child as CharacterData);
			} else if (what === ELEMENT_NODE) {
				if (kind(child as Element) !== null) out += source(child as Element);
				else if (containsRawText(child)) out += descendantText(child);
				else out += Reflect_apply(nGetTextContent, child, []);
			}
		}

		return out;
	};

	const createText = (near: Node, text: string): Text => {
		const document =
			Reflect_apply(nOwnerDocument, near, []) ?? client.global.document;

		return Reflect_apply(nCreateTextNode, document, [text]);
	};

	const blank = (node: CharacterData) => {
		client.box.characterDataSources.set(node, data(node));
		writeData(node, "");
	};

	const restore = (node: CharacterData) => {
		const text = data(node);
		client.box.characterDataSources.delete(node);
		writeData(node, text);
	};

	const adopt = (element: Element) => {
		if (kind(element) === null) return;

		const children = textChildren(element);
		for (let i = 0; i < children.length; i++) {
			if (!client.box.characterDataSources.has(children[i])) {
				client.box.characterDataSources.set(children[i], data(children[i]));
			}
		}
	};

	const isNode = (value: unknown): boolean => {
		if (typeof value !== "object" || value === null) return false;

		// the native getter's own brand check. `instanceof` walks a prototype
		// chain the page can rebuild, and consults a `Symbol.hasInstance` the
		// page can define - either one decides whether the text is blanked
		try {
			Reflect_apply(nNodeType, value, []);

			return true;
		} catch {
			return false;
		}
	};

	const asElement = (node: Node | null): Element | null =>
		node && type(node) === ELEMENT_NODE ? (node as Element) : null;

	/** The Text nodes an argument contributes to its new parent's text content. */
	const textNodesOf = (inserted: Node): CharacterData[] => {
		const what = type(inserted);
		if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
			return [inserted as CharacterData];
		}
		// a fragment is flattened into the parent, so its own Text children
		// become the parent's. anything deeper belongs to an element and never
		// counts as the parent's child text content
		if (what === DOCUMENT_FRAGMENT_NODE) {
			return textChildren(inserted as unknown as Element);
		}

		return [];
	};

	/**
	 * Give a connected script the node insertion its children just had.
	 *
	 * An insertion into a connected script that has not started prepares it,
	 * and that is when it runs. The insertion here landed blanked text - so the
	 * script was prepared with an empty source, which leaves it unstarted - and
	 * the rewritten program only arrived afterwards as a data write, which
	 * Blink does not prepare a script on. Inserting and removing an empty Text
	 * node is an insertion with the program already in place: the script runs
	 * then, still inside the page's call, where the native would have run it.
	 * A script that has already started ignores both.
	 */
	const reprepare = (element: Element) => {
		if (kind(element) !== "script" || !rewriterFor(element)) return;
		if (!Reflect_apply(nIsConnected, element, [])) return;

		const probe = createText(element, "");
		Reflect_apply(nAppendChild, element, [probe]);
		Reflect_apply(nRemoveChild, element, [probe]);
	};

	/**
	 * Everything an insertion has to do around the native call, or null when
	 * there is nothing to do.
	 *
	 * Text going *into* a script is recorded and blanked, so that the insertion
	 * itself - which is a children-changed, and can execute the element - lands
	 * nothing the rewriter has not seen. `done` then writes the rewritten
	 * whole; `undo` puts every blanked node back the way it was, for an
	 * insertion the native refused - a node that stays where it was must not
	 * come out of a failed call emptied.
	 *
	 * Text coming *out of* one is handed back its own data, because outside a
	 * script it is text like any other and the document should hold what it
	 * reads as.
	 */
	const insertion = (parent: Node | null, nodes: readonly unknown[]) => {
		const target = asElement(parent);
		const into = target ? kind(target) : null;
		const resync: Element[] = [];
		const restoring: CharacterData[] = [];
		const blanked: {
			node: CharacterData;
			raw: string;
			had: boolean;
			record: string | undefined;
		}[] = [];

		if (into && target) adopt(target);

		for (let i = 0; i < nodes.length; i++) {
			const inserted = nodes[i];
			// a string, or an object that is not a node at all - the IDL union
			// already turned one of those into a string, and reading `nodeType`
			// off it would throw where the native would have stringified it
			if (!isNode(inserted)) continue;

			const moving = textNodesOf(inserted as Node);
			for (let j = 0; j < moving.length; j++) {
				const node = moving[j];
				const from = parent_(node);
				if (from && kind(from) !== null) {
					// its siblings are about to lose it, and the record is the only
					// thing that remembers what they say
					adopt(from);
					resync[resync.length] = from;
				}

				if (into) {
					blanked[blanked.length] = {
						node,
						raw: rawData(node),
						had: client.box.characterDataSources.has(node),
						record: client.box.characterDataSources.get(node),
					};
					blank(node);
				} else if (client.box.characterDataSources.has(node)) {
					// restored on the way out rather than here: writing a script's
					// own source back into a node that is still inside it would be
					// the one unrewritten children-changed this all exists to avoid
					restoring[restoring.length] = node;
				}
			}
		}

		if (!into && resync.length === 0 && restoring.length === 0) return null;

		return {
			done: () => {
				for (let i = 0; i < restoring.length; i++) restore(restoring[i]);
				for (let i = 0; i < resync.length; i++) {
					if (resync[i] !== target) sync(resync[i]);
				}
				// only a script or a style has anything to re-derive; a plain
				// parent holds what the page wrote, which is what the restores
				// above put back
				if (into && target) {
					sync(target);
					if (blanked.length > 0) reprepare(target);
				}
			},
			undo: () => {
				for (let i = 0; i < blanked.length; i++) {
					const { node, raw, had, record } = blanked[i];
					if (had) client.box.characterDataSources.set(node, record!);
					else client.box.characterDataSources.delete(node);
					writeData(node, raw);
				}
			},
		};
	};

	const around = <T>(
		parent: Node | null,
		nodes: readonly unknown[],
		insert: () => T
	): T => {
		const commit = insertion(parent, nodes);
		if (!commit) return insert();

		let result: T;
		try {
			result = insert();
		} catch (err) {
			commit.undo();
			throw err;
		}
		commit.done();

		return result;
	};

	const insertText = (
		parent: Node,
		reference: Node | null,
		value: string
	): Text => {
		const node = createText(parent, value);

		return around(
			parent,
			[node],
			(): Text => Reflect_apply(nInsertBefore, parent, [node, reference])
		);
	};

	const split = (node: Text, offset: number): Text => {
		const owner = parent_(node)!;
		adopt(owner);

		const value = data(node);
		// the live data is the rewritten whole, so a native split at this
		// offset would cut the rewritten program, not the page's text
		const tail = createText(node, "");
		client.box.characterDataSources.set(tail, String_substring(value, offset));
		client.box.characterDataSources.set(
			node,
			String_substring(value, 0, offset)
		);

		Reflect_apply(nAfter, node, [tail]);
		sync(owner);

		return tail;
	};

	const access: TextAccess = {
		adopt,
		isNode,
		around,
		insertText,
		split,
		kind,
		source,
		setSource,
		data,
		blank,
		restore,
		setData,
		sync,
		descendantText,
		containsRawText,
		parent,
		type,
		createText,
		textChildren,
	};

	layers.set(client, access);

	return access;
}

export default function (client: ScramjetClient, _self: Self) {
	const text = textAccess(client);

	/**
	 * The arguments of an insertion that takes `(Node or DOMString)`, with every
	 * string turned into a Text node when the target is a script or a style.
	 *
	 * The conversion is what the native would do anyway
	 * (https://dom.spec.whatwg.org/#converting-nodes-into-a-node); doing it here
	 * means the text is a node we can blank before it lands.
	 */
	/**
	 * A node that has just left a script or a style is plain text again, and
	 * the document should hold what it reads as. It is detached, so writing its
	 * data runs nothing.
	 */
	const leftRawText = (node: Node) => {
		const what = text.type(node);
		if (what !== TEXT_NODE && what !== CDATA_SECTION_NODE) return;
		if (!client.box.characterDataSources.has(node as CharacterData)) return;

		text.restore(node as CharacterData);
	};

	const nDocumentQuerySelectorAll =
		client.nativeStore.get("Document")!.querySelectorAll.value;
	const nElementQuerySelectorAll =
		client.nativeStore.get("Element")!.querySelectorAll.value;
	const nFragmentQuerySelectorAll =
		client.nativeStore.get("DocumentFragment")!.querySelectorAll.value;

	/**
	 * `node`, if it is a script or a style, and every one under it - the ones
	 * `normalize` will actually merge, which is those with more than one Text
	 * child. The rest are left alone: re-deriving one means rewriting its whole
	 * program again, for nothing.
	 */
	const rawTextInclusiveDescendants = (node: Node): Element[] => {
		const what = text.type(node);
		const out: Element[] = [];
		const merges = (element: Element) =>
			text.kind(element) !== null && text.textChildren(element).length > 1;
		if (what === ELEMENT_NODE && merges(node as Element)) {
			out[out.length] = node as Element;
		}

		const query =
			what === ELEMENT_NODE
				? nElementQuerySelectorAll
				: what === DOCUMENT_FRAGMENT_NODE
					? nFragmentQuerySelectorAll
					: what === DOCUMENT_NODE
						? nDocumentQuerySelectorAll
						: null;
		if (!query) return out;

		const found: NodeListOf<Element> = Reflect_apply(query, node, [
			"script,style",
		]);
		for (let i = 0; i < found.length; i++) {
			if (merges(found[i])) out[out.length] = found[i];
		}

		return out;
	};

	const asNodes = (parent: Node | null, args: unknown[]): unknown[] => {
		if (!parent || text.type(parent) !== ELEMENT_NODE) return args;
		if (text.kind(parent as Element) === null) return args;

		const out: unknown[] = [];
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			out[i] = text.isNode(arg) ? arg : text.createText(parent, String(arg));
		}

		return out;
	};

	// https://dom.spec.whatwg.org/#interface-node
	client.Intercept(class extends Node {
		@Type("DOMString?")
		get nodeValue(): string | null {
			const what = super.nodeType;
			if (what === ATTRIBUTE_NODE) return attrValue(client, this as any);
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				return text.data(this as any);
			}

			return super.nodeValue;
		}

		@Type("DOMString?")
		set nodeValue(value: string | null) {
			const what = super.nodeType;
			if (what === ATTRIBUTE_NODE) {
				setAttrValue(client, this as any, value === null ? "" : String(value));

				return;
			}
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				text.setData(this as any, value === null ? "" : String(value));

				return;
			}

			super.nodeValue = value;
		}

		@Type("DOMString")
		get nodeName(): string {
			const name = super.nodeName;
			// an attribute's node name is its qualified name, and a mirror
			// standing in for a removed attribute answers under that attribute's
			if (super.nodeType !== ATTRIBUTE_NODE) return name;
			const mirrored = mirroredAttributeName(name);

			return mirrored ? mirrored : name;
		}

		@Type("DOMString?")
		get textContent(): string | null {
			const what = super.nodeType;
			if (what === ATTRIBUTE_NODE) return attrValue(client, this as any);
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				return text.data(this as any);
			}
			if (what !== ELEMENT_NODE && what !== DOCUMENT_FRAGMENT_NODE) {
				return super.textContent;
			}

			if (!text.containsRawText(this as Node)) return super.textContent;
			if (what === ELEMENT_NODE && text.kind(this as any) !== null) {
				return text.source(this as any);
			}

			return text.descendantText(this as Node);
		}

		@Type("DOMString?")
		set textContent(value: string | null) {
			const what = super.nodeType;
			const replacement = value === null ? "" : String(value);

			if (what === ATTRIBUTE_NODE) {
				setAttrValue(client, this as any, replacement);

				return;
			}
			if (what === TEXT_NODE || what === CDATA_SECTION_NODE) {
				text.setData(this as any, replacement);

				return;
			}
			if (what === ELEMENT_NODE && text.kind(this as any) !== null) {
				text.setSource(this as any, replacement);

				return;
			}

			super.textContent = value;
		}

		@Arguments("Node")
		@Returns("Node")
		appendChild<T extends Node>(node: T): T {
			void super.nodeType;

			return text.around(this as Node, [node], () => super.appendChild(node));
		}

		@Arguments("Node", "Node?")
		@Returns("Node")
		insertBefore<T extends Node>(node: T, child: Node | null): T {
			void super.nodeType;

			return text.around(this as Node, [node], () =>
				super.insertBefore(node, child)
			);
		}

		@Arguments("Node", "Node")
		@Returns("Node")
		replaceChild<T extends Node>(node: Node, child: T): T {
			void super.nodeType;

			const self = this as Node;
			const owner =
				text.type(self) === ELEMENT_NODE && text.kind(self as Element) !== null
					? (self as Element)
					: null;
			if (owner) text.adopt(owner);

			const replaced = text.around(self, [node], () =>
				super.replaceChild(node, child)
			);
			// the child that left a script is plain text again
			if (owner) leftRawText(replaced);

			return replaced;
		}

		@Arguments("Node")
		@Returns("Node")
		removeChild<T extends Node>(child: T): T {
			const self = this as Node;
			const owner =
				text.type(self) === ELEMENT_NODE && text.kind(self as Element) !== null
					? (self as Element)
					: null;
			if (owner) text.adopt(owner);

			const removed = super.removeChild(child);
			if (owner) {
				leftRawText(removed);
				text.sync(owner);
			}

			return removed;
		}

		@Arguments()
		@Returns("undefined")
		normalize(): void {
			// the merge concatenates the *live* data, which is already the
			// rewritten whole, so only the per-node records have to be rebuilt -
			// for this node if it is a script or a style, and for every one
			// under it, whose later Text children the native merges away along
			// with their records
			const self = this as Node;
			const affected = rawTextInclusiveDescendants(self);
			const sources: string[] = [];
			for (let i = 0; i < affected.length; i++) {
				sources[i] = text.source(affected[i]);
			}

			super.normalize();

			for (let i = 0; i < affected.length; i++) {
				const children = text.textChildren(affected[i]);
				if (children.length > 0) {
					client.box.characterDataSources.set(children[0], sources[i]);
				}
				text.sync(affected[i]);
			}
		}
	});

	// https://dom.spec.whatwg.org/#interface-parentnode, on the one kind of
	// parent that can hold code rather than text
	client.Intercept(class extends Element {
		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		append(...nodes: (Node | string)[]): void {
			void super.hasAttributes();

			const args = asNodes(this, nodes) as (Node | string)[];
			text.around(this, args, () => super.append(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		prepend(...nodes: (Node | string)[]): void {
			void super.hasAttributes();

			const args = asNodes(this, nodes) as (Node | string)[];
			text.around(this, args, () => super.prepend(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		replaceChildren(...nodes: (Node | string)[]): void {
			void super.hasAttributes();

			const args = asNodes(this, nodes) as (Node | string)[];
			text.around(this, args, () => super.replaceChildren(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		after(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.after(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		before(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.before(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		replaceWith(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.replaceWith(...args));
		}

		@Arguments("DOMString", "DOMString")
		@Returns("undefined")
		insertAdjacentText(where: string, data: string): void {
			// beforebegin and afterend insert into this element's parent;
			// afterbegin and beforeend into this element
			void super.hasAttributes();

			const position = String_toLowerCase(String(where));
			const outside = position === "beforebegin" || position === "afterend";
			const inside = position === "afterbegin" || position === "beforeend";
			const parent = outside ? super.parentNode : (this as Node);

			// an unknown position is the native's SyntaxError to throw, and a
			// parent that is not a script or a style is the native's to insert
			// into
			if (
				(!outside && !inside) ||
				!parent ||
				text.type(parent) !== ELEMENT_NODE ||
				text.kind(parent as Element) === null
			) {
				return super.insertAdjacentText(where as InsertPosition, data);
			}

			// as a node rather than as a string, so that it can be blanked
			// before it reaches the element and prepares the script
			const reference =
				position === "beforebegin"
					? (this as Node)
					: position === "afterend"
						? super.nextSibling
						: position === "afterbegin"
							? super.firstChild
							: null;
			text.insertText(parent, reference, String(data));
		}

		// https://dom.spec.whatwg.org/#dom-parentnode-movebefore - an atomic
		// move, which is an insertion like any other as far as a script's text
		// is concerned. absent before Chrome 133, which `Intercept` skips
		@Arguments("Node", "Node?")
		@Returns("undefined")
		moveBefore(node: Node, child: Node | null): void {
			void super.hasAttributes();

			text.around(this, [node], () => super.moveBefore(node, child));
		}
	});

	// https://dom.spec.whatwg.org/#interface-characterdata
	client.Intercept(class extends CharacterData {
		@Type("[LegacyNullToEmptyString] DOMString")
		get data(): string {
			void super.length;

			return text.data(this);
		}

		@Type("[LegacyNullToEmptyString] DOMString")
		set data(value: string) {
			void super.length;

			text.setData(this, String(value));
		}

		@Type("unsigned long")
		get length(): number {
			const native = super.length;
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) return native;

			return text.data(this).length;
		}

		@Arguments("unsigned long", "unsigned long")
		@Returns("DOMString")
		substringData(offset: number, count: number): string {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) {
				return super.substringData(offset, count);
			}
			void super.length;

			const value = text.data(this);
			if (offset > value.length) throw indexSize("substringData");

			return String_substring(value, offset, offset + count);
		}

		@Arguments("DOMString")
		@Returns("undefined")
		appendData(data: string): void {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) return super.appendData(data);
			void super.length;

			text.setData(this, text.data(this) + String(data));
		}

		@Arguments("unsigned long", "DOMString")
		@Returns("undefined")
		insertData(offset: number, data: string): void {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) {
				return super.insertData(offset, data);
			}
			void super.length;

			replaceData(this, offset, 0, data, "insertData");
		}

		@Arguments("unsigned long", "unsigned long")
		@Returns("undefined")
		deleteData(offset: number, count: number): void {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) {
				return super.deleteData(offset, count);
			}
			void super.length;

			replaceData(this, offset, count, "", "deleteData");
		}

		// https://dom.spec.whatwg.org/#concept-cd-replace, over the text the page
		// wrote rather than over the rewritten text the document holds - the two
		// have nothing to do with one another, and an offset into the second is
		// meaningless
		@Arguments("unsigned long", "unsigned long", "DOMString")
		@Returns("undefined")
		replaceData(offset: number, count: number, data: string): void {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) {
				return super.replaceData(offset, count, data);
			}
			void super.length;

			replaceData(this, offset, count, data, "replaceData");
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		after(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.after(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		before(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.before(...args));
		}

		@Arguments("(Node or DOMString)...")
		@Returns("undefined")
		replaceWith(...nodes: (Node | string)[]): void {
			const parent = super.parentNode;
			const args = asNodes(parent, nodes) as (Node | string)[];
			text.around(parent, args, () => super.replaceWith(...args));
		}

		@Arguments()
		@Returns("undefined")
		remove(): void {
			const parent = super.parentNode;
			const owner =
				parent &&
				text.type(parent) === ELEMENT_NODE &&
				text.kind(parent as Element) !== null
					? (parent as Element)
					: null;
			if (owner) text.adopt(owner);

			super.remove();

			if (owner) {
				leftRawText(this);
				text.sync(owner);
			}
		}
	});

	/**
	 * https://dom.spec.whatwg.org/#concept-cd-replace, over the text the page
	 * wrote rather than over the rewritten text the document holds - the two
	 * have nothing to do with one another, and an offset into the second is
	 * meaningless. `insertData` and `deleteData` are this with a zero count or
	 * an empty string; they call it here rather than through `this`, which is
	 * the page's to redefine.
	 */
	const replaceData = (
		node: CharacterData,
		offset: number,
		count: number,
		data: string,
		member: string
	) => {
		// 1. Let length be node's length
		const value = text.data(node);
		// 2. If offset is greater than length, throw an "IndexSizeError"
		if (offset > value.length) throw indexSize(member);
		// 3. If offset plus count is greater than length, set count to length
		//    minus offset
		const end = offset + count > value.length ? value.length : offset + count;

		// 4-6. splice the data
		text.setData(
			node,
			String_substring(value, 0, offset) +
				String(data) +
				String_substring(value, end)
		);
	};

	const indexSize = (member: string) =>
		client.errors.domException("IndexSizeError", {
			execute: member,
			on: "CharacterData",
			detail: "The offset is larger than the node's length.",
		});

	// https://dom.spec.whatwg.org/#interface-text
	client.Intercept(class extends Text {
		@Type("DOMString")
		get wholeText(): string {
			void super.wholeText;

			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) return super.wholeText;

			// contiguous Text siblings, which inside a script or a style is every
			// Text child the element has
			let out = "";
			const children = text.textChildren(owner);
			for (let i = 0; i < children.length; i++) out += text.data(children[i]);

			return out;
		}

		@Arguments("unsigned long")
		@Returns("Text")
		splitText(offset: number): Text {
			const owner = text.parent(this);
			if (!owner || text.kind(owner) === null) return super.splitText(offset);
			void super.wholeText;

			if (offset > text.data(this).length) throw indexSize("splitText");

			return text.split(this, offset);
		}
	});

	client.Intercept(class extends HTMLElement {
		@Type("[LegacyNullToEmptyString] DOMString")
		get innerText(): string {
			// a script or a style is never rendered, so its innerText is its text
			// content - which for these two is their source.
			// `title` is the brand check: reading the native innerText forces
			// layout, and on this path the answer is thrown away
			if (text.kind(this) !== null) {
				void super.title;

				return text.source(this);
			}

			return super.innerText;
		}

		@Type("[LegacyNullToEmptyString] DOMString")
		set innerText(value: string) {
			void super.title;

			if (text.kind(this) !== null) {
				text.setSource(this, String(value));

				return;
			}

			super.innerText = value;
		}

		@Type("[LegacyNullToEmptyString] DOMString")
		get outerText(): string {
			if (text.kind(this) !== null) {
				void super.title;

				return text.source(this);
			}

			return super.outerText;
		}

		@Type("[LegacyNullToEmptyString] DOMString")
		set outerText(value: string) {
			void super.title;

			// this replaces the element with text *in its parent*, so the element
			// itself is never the script - its parent might be
			const parent = super.parentNode;
			const owner =
				parent && text.type(parent) === ELEMENT_NODE
					? (parent as Element)
					: null;

			if (!owner || text.kind(owner) === null) {
				super.outerText = value;

				return;
			}

			// inside a script or a style nothing is rendered, so the line breaks
			// the spec's own steps turn into `br` elements have nothing to do
			// here, and this is a plain replacement
			const node = text.createText(this, String(value));
			text.around(owner, [node], () => super.replaceWith(node));
		}
	});

	// Blink defines `textContent` and `innerText` over again on
	// HTMLScriptElement.prototype - they are Trusted Types sinks there - and
	// those shadow the `Node` and `HTMLElement` interceptors above, so a
	// script's own copies need intercepting in their own right. Only where they
	// are own: elsewhere the inherited interceptors already answer, and naming
	// them here would patch those a second time
	const scriptPrototype = client.global.HTMLScriptElement.prototype;
	if (
		Object_hasOwn(scriptPrototype, "textContent") &&
		Object_hasOwn(scriptPrototype, "innerText")
	) {
		client.Intercept(class extends HTMLScriptElement {
			@Type("(TrustedScript or [LegacyNullToEmptyString] DOMString)?")
			get textContent(): string | null {
				void super.type;

				return text.source(this);
			}

			@Type("(TrustedScript or [LegacyNullToEmptyString] DOMString)?")
			set textContent(value: string | null) {
				void super.type;

				text.setSource(this, value === null ? "" : String(value));
			}

			@Type("(TrustedScript or [LegacyNullToEmptyString] DOMString)")
			get innerText(): string {
				void super.type;

				return text.source(this);
			}

			@Type("(TrustedScript or [LegacyNullToEmptyString] DOMString)")
			set innerText(value: string) {
				void super.type;

				text.setSource(this, String(value));
			}
		});
	}

	// https://html.spec.whatwg.org/multipage/scripting.html#dom-script-text
	client.Intercept(class extends HTMLScriptElement {
		@Type("DOMString")
		get text(): string {
			void super.type;

			return text.source(this);
		}

		@Type("DOMString")
		set text(value: string) {
			void super.type;

			text.setSource(this, String(value));
		}
	});
}
