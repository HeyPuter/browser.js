/**
 * The attribute layer.
 *
 * Scramjet rewrites content attributes: `src` on an image is a proxy URL in the
 * live DOM, `nonce` is gone entirely, `style` has been through the CSS
 * rewriter. None of that may be visible to the page, so every rewritten
 * attribute is *mirrored* - the value the page wrote is kept alongside it in
 * `scramjet-attr-<name>`, and every read answers out of the mirror.
 *
 * The rules are the same ones the HTML rewriter applies while parsing
 * (`shared/htmlRules.ts`, plus the event handler attributes), so an attribute
 * written by script ends up in exactly the state it would have been in had it
 * come down in the markup: one table, one write path, one read path, whichever
 * member the page reached for.
 *
 * Everything that touches an attribute goes through the client's
 * {@link AttributeLayer} - `dom/element.ts`'s `Element` members, `dom/attr.ts`
 * for `Attr` and `NamedNodeMap`, `dom/reflect.ts` for the reflected IDL
 * attributes, and the text layer for a script's source. Nothing reads
 * `scramjet-attr-` by hand.
 */

import type { ScramjetClient } from "@client/index";
import { htmlRules } from "@/shared/htmlRules";
import { eventAttributes } from "@rewriters/html";
import { rewriteJs } from "@rewriters/js";
import {
	Array_indexOf,
	String_charCodeAt,
	String_indexOf,
	String_startsWith,
	String_substring,
	String_toLowerCase,
} from "@/shared/snapshot";

/**
 * The prefix on every attribute scramjet keeps for itself.
 *
 * Matched without the trailing dash when *hiding*, case-insensitively, so
 * nothing under the name can be read or written by a page however it spells
 * it. A trailing dash is required when computing a mirror, and that is the
 * only form we ever write.
 */
const INTERNAL_PREFIX = "scramjet-attr";
const MIRROR_PREFIX = "scramjet-attr-";

/**
 * Where a script element's original source is kept, in base64.
 *
 * It carries the mirror prefix but is not a mirror - there is no
 * `script-source-src` content attribute for it to stand in for - so it is
 * hidden outright rather than surfaced under a shortened name. The name is the
 * HTML rewriter's; both ends of the round trip have to agree on it.
 */
export const SCRIPT_SOURCE_ATTRIBUTE = "scramjet-attr-script-source-src";

/** The HTML namespace, for the spec's "is in the HTML namespace" tests. */
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** The XLink namespace, which the legacy `xlink:href` lives in. */
export const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** The part of a qualified name after its prefix, if it has one. */
export function localPart(qualifiedName: string): string {
	const colon = String_indexOf(qualifiedName, ":");

	return colon === -1
		? qualifiedName
		: String_substring(qualifiedName, colon + 1);
}

/**
 * The name the rule table knows a namespaced attribute by.
 *
 * The rules key on `xlink:href`, which is the spelling the HTML parser gives
 * the attribute. Through `setAttributeNS` the prefix is the page's to choose,
 * and `setAttributeNS(XLINK, "x:href", url)` is the same attribute - one the
 * browser fetches from - under a name no rule would otherwise match.
 */
export function ruleAttributeName(
	namespace: string | null,
	qualifiedName: string
): string {
	if (namespace === XLINK_NAMESPACE && localPart(qualifiedName) === "href") {
		return "xlink:href";
	}

	return qualifiedName;
}

/**
 * The "if namespace is the empty string, set it to null" step every `*NS`
 * member opens with, so that the rest can test for null alone.
 * https://dom.spec.whatwg.org/#validate-and-extract
 */
export function nullNamespace(namespace: string | null): string | null {
	return namespace === "" ? null : namespace;
}

/** Whether `qualifiedName` names an attribute of scramjet's own. */
export function isInternalAttribute(qualifiedName: string): boolean {
	return String_startsWith(String_toLowerCase(qualifiedName), INTERNAL_PREFIX);
}

/** The internal name mirroring `qualifiedName`. */
export function mirrorAttributeName(qualifiedName: string): string {
	return MIRROR_PREFIX + qualifiedName;
}

/**
 * The attribute `internalName` mirrors: `"scramjet-attr-src"` -> `"src"`.
 *
 * `""` for an internal attribute that mirrors nothing, and null for a name that
 * is not internal at all. The three cases are distinct - a caller walking the
 * attribute list surfaces the first, drops the second and passes the third
 * through.
 */
export function mirroredAttributeName(internalName: string): string | null {
	if (!isInternalAttribute(internalName)) return null;
	if (internalName === SCRIPT_SOURCE_ATTRIBUTE) return "";
	if (!String_startsWith(internalName, MIRROR_PREFIX)) return "";

	return String_substring(internalName, MIRROR_PREFIX.length);
}

/**
 * https://dom.spec.whatwg.org/#valid-attribute-local-name
 *
 * Checked here rather than left to the native because a rewritten attribute is
 * written mirror-first: handing an invalid name to the native would either name
 * the mirror in the message the page catches, or - worse - let the raw value
 * land under the real name before anything threw.
 */
export function isValidAttributeLocalName(name: string): boolean {
	if (name.length === 0) return false;

	for (let i = 0; i < name.length; i++) {
		const c = String_charCodeAt(name, i);
		if (
			c === 0x09 || // tab
			c === 0x0a || // LF
			c === 0x0c || // FF
			c === 0x0d || // CR
			c === 0x20 || // space
			c === 0x00 || // NUL
			c === 0x2f || // /
			c === 0x3d || // =
			c === 0x3e // >
		) {
			return false;
		}
	}

	return true;
}

/** Whether `name` contains an ASCII upper alpha, so lowercasing would change it. */
function hasUppercase(name: string): boolean {
	for (let i = 0; i < name.length; i++) {
		const c = String_charCodeAt(name, i);
		if (c >= 0x41 && c <= 0x5a) return true;
	}

	return false;
}

/** What a rule does to one attribute value; null means "remove the attribute". */
export type AttributeRewriter = (value: string) => string | null;

/**
 * The attribute primitives, bound to one client - `client.attributes`, built in
 * its constructor.
 *
 * Every member takes a *qualified* name, already run through {@link qualify}
 * by whoever accepted it from the page.
 */
export class AttributeLayer {
	/**
	 * The document as it really is, mirrors and all. Only for a caller that
	 * *means* the internal attribute - the script source, or a mirror it is
	 * maintaining itself.
	 */
	readonly raw: {
		get(element: Element, name: string): string | null;
		set(element: Element, name: string, value: string): void;
		remove(element: Element, name: string): void;
		has(element: Element, name: string): boolean;
	};

	constructor(private readonly client: ScramjetClient) {
		this.raw = {
			get: (element, name) =>
				new client.native.Element(element).getAttribute(name),
			set: (element, name, value) => {
				new client.native.Element(element).setAttribute(name, value);
			},
			remove: (element, name) => {
				new client.native.Element(element).removeAttribute(name);
			},
			has: (element, name) =>
				new client.native.Element(element).hasAttribute(name),
		};
	}

	/** `element`'s local name, case-preserved - the rules key on it. */
	localName(element: Element): string {
		return new this.client.native.Element(element).localName;
	}

	/** Whether `element` is an HTML element in an HTML document. */
	isHtml(element: Element): boolean {
		const nElement = new this.client.native.Element(element);

		return (
			nElement.namespaceURI === HTML_NAMESPACE &&
			this.client.box.instanceof(nElement.ownerDocument, "HTMLDocument")
		);
	}

	/**
	 * Step 2 of the spec's attribute algorithms: the lowercasing is conditional.
	 * An SVG or MathML element keeps `viewBox` as `viewBox`, and folding it
	 * writes a different, meaningless attribute.
	 */
	qualify(element: Element, qualifiedName: string): string {
		return hasUppercase(qualifiedName) && this.isHtml(element)
			? String_toLowerCase(qualifiedName)
			: qualifiedName;
	}

	/** The value the page should see, or null when the attribute is absent. */
	get(element: Element, qualifiedName: string): string | null {
		if (isInternalAttribute(qualifiedName)) return null;

		const mirror = this.raw.get(element, mirrorAttributeName(qualifiedName));
		if (mirror !== null) return mirror;

		return this.raw.get(element, qualifiedName);
	}

	/** Whether the page should see the attribute at all. */
	has(element: Element, qualifiedName: string): boolean {
		if (isInternalAttribute(qualifiedName)) return false;

		return (
			this.raw.has(element, qualifiedName) ||
			this.raw.has(element, mirrorAttributeName(qualifiedName))
		);
	}

	/** The rule for this attribute on this element, or null if it isn't rewritten. */
	rewriter(element: Element, qualifiedName: string): AttributeRewriter | null {
		const client = this.client;
		// keyed on the lowercased attribute name and on the element's *local*
		// name, which is the spelling the HTML rewriter matches against too.
		// `tagName` would uppercase every HTML element, and lowercasing that in
		// turn would never match `linearGradient`
		const name = String_toLowerCase(qualifiedName);
		const tag = this.localName(element);

		for (let i = 0; i < htmlRules.length; i++) {
			const rule = htmlRules[i];
			const selector = rule[name];
			if (!selector) continue;
			// `fn` is a key of the rule object like any other; an attribute
			// actually named "fn" would otherwise find the rewriter itself
			if (typeof selector === "function") continue;
			if (selector !== "*" && Array_indexOf(selector, tag) === -1) continue;

			return (value) =>
				rule.fn(value, client.context, client.meta, (other) =>
					this.get(element, other)
				);
		}

		// an event handler content attribute is javascript, and the parser
		// rewrites it. a page writing one through `setAttribute` has to reach the
		// same rewriter, or the handler runs against the real globals
		if (Array_indexOf(eventAttributes, name) !== -1) {
			return (value) =>
				rewriteJs(
					value,
					`(inline ${name} on element)`,
					client.context,
					client.meta
				) as string;
		}

		return null;
	}

	/**
	 * The attribute change steps scramjet keeps for itself, run after every
	 * write or removal that did not go through {@link set} or {@link remove}
	 * (both of which run it themselves). `value` is the page's value, or null
	 * for a removal.
	 */
	changed(element: Element, qualifiedName: string, value: string | null) {
		// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#attr-nonce -
		// the nonce content attribute's change steps copy it into the
		// element's [[CryptographicNonce]], which is what the `nonce` IDL
		// attribute answers with. Writing the IDL attribute touches only the
		// slot, never the content attribute
		if (qualifiedName === "nonce") {
			this.client.box.nonces.set(element, value === null ? "" : value);
		}

		// `iframe.sandbox` is handed out from a stand-in element, because the
		// rule strips the real attribute and a token list over it would edit
		// the live iframe. the stand-in has to follow every other write
		if (qualifiedName === "sandbox") {
			const standIn = this.client.box.sandboxStandIns.get(element);
			if (standIn) {
				if (value === null) this.raw.remove(standIn, "sandbox");
				else this.raw.set(standIn, "sandbox", value);
			}
		}

		// a refresh's content is only a URL once `http-equiv` says so, and the
		// page may well set the two in the other order - so the content is
		// re-rewritten, from the page's own value, whenever that changes
		if (qualifiedName === "http-equiv" && this.localName(element) === "meta") {
			const content = this.get(element, "content");
			if (content !== null) this.set(element, "content", content);
		}

		// A script's block type controls whether its child text is code, data, or
		// an import map. When either legacy type attribute changes, re-derive the
		// live text from the saved source before a later child change can prepare
		// the script (HTML's "prepare the script element" algorithm, step 8).
		// https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
		if (
			(qualifiedName === "type" || qualifiedName === "language") &&
			this.localName(element) === "script"
		) {
			this.client.text.sync(element);
		}
	}

	/** Write `value`, rewriting it and recording the mirror if a rule applies. */
	set(element: Element, qualifiedName: string, value: string): void {
		if (isInternalAttribute(qualifiedName)) return;

		const rewrite = this.rewriter(element, qualifiedName);
		if (!rewrite) {
			this.raw.set(element, qualifiedName, value);
			this.changed(element, qualifiedName, value);

			return;
		}

		const rewritten = rewrite(value);

		// the mirror goes down first: the rewritten value can start a fetch the
		// moment it lands, and anything that reads the attribute back out of
		// that side effect has to already see the page's own value
		this.raw.set(element, mirrorAttributeName(qualifiedName), value);

		if (rewritten === null) this.raw.remove(element, qualifiedName);
		else this.raw.set(element, qualifiedName, rewritten);

		this.changed(element, qualifiedName, value);
	}

	/** Remove the attribute and its mirror together. */
	remove(element: Element, qualifiedName: string): void {
		if (isInternalAttribute(qualifiedName)) return;

		// unconditionally, and both halves: a rule that removes the attribute
		// outright (`nonce`, `sandbox`) leaves nothing but the mirror behind, and
		// a removal that checked for the real one first would leave that mirror
		// to answer `getAttribute` forever
		const node: Attr | null = new this.client.native.Element(
			element
		).getAttributeNode(qualifiedName);
		const mirror = this.raw.get(element, mirrorAttributeName(qualifiedName));
		this.raw.remove(element, mirrorAttributeName(qualifiedName));
		this.raw.remove(element, qualifiedName);
		this.detached(node, mirror);

		this.changed(element, qualifiedName, null);
	}

	/** The qualified names the page should see, in the document's order. */
	names(element: Element): string[] {
		const all: string[] = new this.client.native.Element(
			element
		).getAttributeNames();

		let internal = false;
		for (let i = 0; i < all.length; i++) {
			if (isInternalAttribute(all[i])) {
				internal = true;
				break;
			}
		}
		if (!internal) return all;

		const out: string[] = [];
		for (let i = 0; i < all.length; i++) {
			const name = all[i];
			const mirrored = mirroredAttributeName(name);

			// an ordinary attribute, in its own position
			if (mirrored === null) {
				out[out.length] = name;
				continue;
			}
			// internal, and standing in for nothing
			if (mirrored === "") continue;
			// a mirror whose attribute is still there is a duplicate of it
			if (this.raw.has(element, mirrored)) continue;

			// the rule removed the attribute, so its mirror is all that is left
			// to represent it
			out[out.length] = mirrored;
		}

		return out;
	}

	/** The `Attr` node the page should see for `qualifiedName`, or null. */
	node(element: Element, qualifiedName: string): Attr | null {
		if (isInternalAttribute(qualifiedName)) return null;

		const nElement = new this.client.native.Element(element);
		const real: Attr | null = nElement.getAttributeNode(qualifiedName);
		if (real) return real;

		// a removed attribute is represented by its mirror's node, which
		// `dom/attr.ts` renames back
		return nElement.getAttributeNode(mirrorAttributeName(qualifiedName));
	}

	/**
	 * The mirror node standing in for a stripped attribute named `localName`,
	 * for a namespace-less `*NS` lookup the native could not answer. Only when
	 * nothing in the document holds that qualified name: a namespaced
	 * `xlink:href` is not in the null namespace, and its mirror must not make
	 * it look as though it were.
	 */
	strippedNode(element: Element, localName: string): Attr | null {
		if (isInternalAttribute(localName)) return null;
		if (this.raw.has(element, localName)) return null;

		return new this.client.native.Element(element).getAttributeNode(
			mirrorAttributeName(localName)
		);
	}

	/**
	 * Hand a node that has just left its element the page's value back.
	 *
	 * Detached, an `Attr` answers with what it holds, which for a rewritten
	 * attribute is the proxy's value - so the mirror it was answering out of
	 * a moment ago is written into it. `mirror` is read before the removal.
	 */
	detached(attr: Attr | null, mirror: string | null): void {
		if (!attr || mirror === null) return;
		if (isInternalAttribute(this.attrName(attr))) return;
		if (this.owner(attr) !== null) return;

		this.setAttrValue(attr, mirror);
	}

	/** The element an `Attr` node belongs to, or null when it is detached. */
	owner(attr: Attr): Element | null {
		return new this.client.native.Attr(attr).ownerElement;
	}

	/** An `Attr`'s qualified name, as the document holds it. */
	attrName(attr: Attr): string {
		return new this.client.native.Attr(attr).name;
	}

	/** An `Attr`'s value, as the document holds it. */
	attrValue(attr: Attr): string {
		return new this.client.native.Attr(attr).value;
	}

	/** An `Attr`'s namespace. */
	attrNamespace(attr: Attr): string | null {
		return new this.client.native.Attr(attr).namespaceURI;
	}

	/** Write an `Attr`'s value without going through its element. */
	setAttrValue(attr: Attr, value: string): void {
		new this.client.native.Attr(attr).value = value;
	}

	/**
	 * The value an `Attr` should report to the page, which is its element's
	 * mirror when it has one. What `Attr.value` answers, and `nodeValue` and
	 * `textContent` when the node is an attribute.
	 */
	visibleValue(attr: Attr): string {
		const name = this.attrName(attr);
		// a mirror's own value *is* the page's value
		if (isInternalAttribute(name)) return this.attrValue(attr);

		const owner = this.owner(attr);
		if (!owner) return this.attrValue(attr);

		const mirror = this.raw.get(owner, mirrorAttributeName(name));

		return mirror === null ? this.attrValue(attr) : mirror;
	}

	/** The write half of {@link visibleValue}, so a rule sees the value first. */
	setVisibleValue(attr: Attr, value: string): void {
		const name = this.attrName(attr);
		const owner = this.owner(attr);

		// detached, or the mirror itself: there is no rule to apply, and writing
		// the mirror is how the page's value is meant to be changed
		if (!owner || isInternalAttribute(name)) {
			this.setAttrValue(attr, value);

			return;
		}

		this.set(owner, name, value);
	}

	/**
	 * `setAttributeNode` and `setAttributeNodeNS`, which `NamedNodeMap`'s
	 * `setNamedItem` and `setNamedItemNS` are the same operation as.
	 *
	 * The rewriting happens *before* the node is inserted: for `src` on a
	 * connected element the browser starts fetching the moment the attribute
	 * lands, so fixing the value up afterwards would be one request to the real
	 * origin every time.
	 */
	insertNode(element: Element, attr: Attr, namespaced: boolean): Attr | null {
		const nElement = new this.client.native.Element(element);
		const insert = (): Attr | null =>
			namespaced
				? nElement.setAttributeNodeNS(attr)
				: nElement.setAttributeNode(attr);

		// an attribute that already belongs to an element is either this
		// element's - a no-op the native answers with the node itself - or
		// another's, which is an InUseAttributeError. neither may be rewritten
		// first: the value is already the rewritten one, and rewriting it again
		// would land a proxy URL in the mirror
		if (this.owner(attr) !== null) return insert();

		const name = this.attrName(attr);
		// a page-built attribute under our own prefix would poison a mirror, so
		// it is dropped the same way `setAttribute` drops one
		if (isInternalAttribute(name)) {
			void nElement.hasAttributes();

			return null;
		}

		const value = this.attrValue(attr);
		const rewrite = this.rewriter(
			element,
			ruleAttributeName(this.attrNamespace(attr), name)
		);

		// what the node being replaced answered with, so it can go on answering
		// with it once it is detached. `setAttributeNodeNS` replaces by namespace
		// and local name, which need not be the same qualified name
		const namespace = this.attrNamespace(attr);
		const previous: Attr | null = namespaced
			? nElement.getAttributeNodeNS(
					namespace,
					new this.client.native.Attr(attr).localName
				)
			: nElement.getAttributeNode(name);
		const previousMirror = previous
			? this.raw.get(element, mirrorAttributeName(this.attrName(previous)))
			: null;

		if (!rewrite) {
			const replaced = insert();
			// a stale mirror from an earlier rewritten value under this name
			// would otherwise go on answering for the one just inserted
			this.raw.remove(element, mirrorAttributeName(name));
			this.detached(replaced, previousMirror);
			this.changed(element, name, value);

			return replaced;
		}

		const rewritten = rewrite(value);
		this.setAttrValue(attr, rewritten === null ? "" : rewritten);

		// the mirror goes down first, for the reason `set` gives - and because
		// inserting the node runs a custom element's attributeChangedCallback,
		// which reads the attribute back
		const mirrorName = mirrorAttributeName(name);
		const staleMirror = this.raw.get(element, mirrorName);
		this.raw.set(element, mirrorName, value);

		let replaced: Attr | null;
		try {
			replaced = insert();
		} catch (err) {
			// a namespace clash, or an element that is not one - the node the
			// page still holds must not come back carrying the rewritten value,
			// and the element must not come back carrying its mirror
			if (staleMirror === null) this.raw.remove(element, mirrorName);
			else this.raw.set(element, mirrorName, staleMirror);
			this.setAttrValue(attr, value);
			throw err;
		}

		this.detached(replaced, previousMirror);
		this.changed(element, name, value);

		if (rewritten !== null) return replaced;

		// the rule wants the attribute gone. it had to be inserted all the same -
		// that is what makes this a *replacement* of whatever was there, which is
		// the node the page is handed back
		this.raw.remove(element, name);
		// and the node the page still holds gets its own value back, now that it
		// is detached and writing it has no effect on the document
		this.setAttrValue(attr, value);

		return replaced;
	}
}
