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
 * come down in the markup. That is the point of this file: one table, one write
 * path, one read path, whichever member the page reached for.
 *
 * Everything that touches an attribute goes through {@link attributeAccess}:
 * this module's `Element` members, `dom/attr.ts` for `Attr` and `NamedNodeMap`,
 * `dom/reflect.ts` for the reflected IDL attributes, `dom/text.ts` for the
 * script source. Nothing reads `scramjet-attr-` by hand.
 *
 * https://dom.spec.whatwg.org/#interface-element
 */

import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";
import { htmlRules } from "@/shared/htmlRules";
import { eventAttributes } from "@rewriters/html";
import { rewriteJs } from "@rewriters/js";
import {
	Array_indexOf,
	Reflect_apply,
	String,
	String_charCodeAt,
	String_startsWith,
	String_substring,
	String_toLowerCase,
	_WeakMap,
} from "@/shared/snapshot";

/**
 * The prefix on every attribute scramjet keeps for itself.
 *
 * Matched without the trailing dash when *hiding*, so nothing under the name
 * can be read or written by a page however it spells it, and with the dash when
 * computing a mirror, which is the only form we ever write.
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

/** Whether `qualifiedName` names an attribute of scramjet's own. */
export function isInternalAttribute(qualifiedName: string): boolean {
	return String_startsWith(qualifiedName, INTERNAL_PREFIX);
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
 * The attribute primitives, bound to one client.
 *
 * Every member takes a *qualified* name, already run through {@link
 * AttributeAccess.qualify} by whoever accepted it from the page.
 */
export type AttributeAccess = {
	/**
	 * Step 2 of the spec's attribute algorithms: the lowercasing is conditional.
	 * An SVG or MathML element keeps `viewBox` as `viewBox`, and folding it
	 * writes a different, meaningless attribute.
	 */
	qualify(element: Element, qualifiedName: string): string;
	/** The value the page should see, or null when the attribute is absent. */
	get(element: Element, qualifiedName: string): string | null;
	/** Whether the page should see the attribute at all. */
	has(element: Element, qualifiedName: string): boolean;
	/** Write `value`, rewriting it and recording the mirror if a rule applies. */
	set(element: Element, qualifiedName: string, value: string): void;
	/** Remove the attribute and its mirror together. */
	remove(element: Element, qualifiedName: string): void;
	/** The qualified names the page should see, in the document's order. */
	names(element: Element): string[];
	/** The rule for this attribute on this element, or null if it isn't rewritten. */
	rewriter(element: Element, qualifiedName: string): AttributeRewriter | null;
	/** The `Attr` node the page should see for `qualifiedName`, or null. */
	node(element: Element, qualifiedName: string): Attr | null;
	/** The element an `Attr` node belongs to, or null when it is detached. */
	owner(attr: Attr): Element | null;
	/** An `Attr`'s qualified name, as the document holds it. */
	attrName(attr: Attr): string;
	/** An `Attr`'s value, as the document holds it. */
	attrValue(attr: Attr): string;
	/** Write an `Attr`'s value without going through its element. */
	setAttrValue(attr: Attr, value: string): void;
	/** Whether `element` is an HTML element in an HTML document. */
	isHtml(element: Element): boolean;
	/** `element`'s local name, case-preserved - the rules key on it. */
	localName(element: Element): string;
	/**
	 * The document as it really is, mirrors and all. Only for a caller that
	 * *means* the internal attribute - the script source, or a mirror it is
	 * maintaining itself.
	 */
	raw: {
		get(element: Element, name: string): string | null;
		set(element: Element, name: string, value: string): void;
		remove(element: Element, name: string): void;
		has(element: Element, name: string): boolean;
	};
};

const accessors = new _WeakMap<ScramjetClient, AttributeAccess>([]);

/**
 * The attribute primitives for `client`, built once.
 *
 * Reaches the natives through the snapshotted descriptors rather than
 * `client.native.Element`, which mints two proxies per property access. These
 * sit on the read path of every reflected attribute in the document.
 */
export function attributeAccess(client: ScramjetClient): AttributeAccess {
	const existing = accessors.get(client);
	if (existing) return existing;

	const element = client.nativeStore.get("Element")!;
	const attr = client.nativeStore.get("Attr")!;

	const nGetAttribute = element.getAttribute.value;
	const nSetAttribute = element.setAttribute.value;
	const nRemoveAttribute = element.removeAttribute.value;
	const nHasAttribute = element.hasAttribute.value;
	const nGetAttributeNames = element.getAttributeNames.value;
	const nGetAttributeNode = element.getAttributeNode.value;
	const nLocalName = element.localName.get;
	const nNamespaceURI = element.namespaceURI.get;
	const nOwnerDocument = element.ownerDocument.get;
	const nAttrName = attr.name.get;
	const nAttrValue = attr.value.get;
	const nSetAttrValue = attr.value.set;
	const nOwnerElement = attr.ownerElement.get;

	const raw = {
		get: (element: Element, name: string): string | null =>
			Reflect_apply(nGetAttribute, element, [name]),
		set: (element: Element, name: string, value: string): void => {
			Reflect_apply(nSetAttribute, element, [name, value]);
		},
		remove: (element: Element, name: string): void => {
			Reflect_apply(nRemoveAttribute, element, [name]);
		},
		has: (element: Element, name: string): boolean =>
			Reflect_apply(nHasAttribute, element, [name]),
	};

	const localName = (element: Element): string =>
		Reflect_apply(nLocalName, element, []);

	const isHtml = (element: Element): boolean =>
		Reflect_apply(nNamespaceURI, element, []) === HTML_NAMESPACE &&
		client.box.instanceof(
			Reflect_apply(nOwnerDocument, element, []),
			"HTMLDocument"
		);

	const qualify = (element: Element, qualifiedName: string): string =>
		hasUppercase(qualifiedName) && isHtml(element)
			? String_toLowerCase(qualifiedName)
			: qualifiedName;

	const get = (element: Element, qualifiedName: string): string | null => {
		if (isInternalAttribute(qualifiedName)) return null;

		const mirror = raw.get(element, mirrorAttributeName(qualifiedName));
		if (mirror !== null) return mirror;

		return raw.get(element, qualifiedName);
	};

	const has = (element: Element, qualifiedName: string): boolean => {
		if (isInternalAttribute(qualifiedName)) return false;

		return (
			raw.has(element, qualifiedName) ||
			raw.has(element, mirrorAttributeName(qualifiedName))
		);
	};

	const rewriter = (
		element: Element,
		qualifiedName: string
	): AttributeRewriter | null => {
		// keyed on the lowercased attribute name and on the element's *local*
		// name, which is the spelling the HTML rewriter matches against too.
		// `tagName` would uppercase every HTML element, and lowercasing that in
		// turn would never match `linearGradient`
		const name = String_toLowerCase(qualifiedName);
		const tag = localName(element);

		for (let i = 0; i < htmlRules.length; i++) {
			const rule = htmlRules[i];
			const selector = rule[name];
			if (!selector) continue;
			// `fn` is a key of the rule object like any other; an attribute
			// actually named "fn" would otherwise find the rewriter itself
			if (typeof selector === "function") continue;
			if (selector !== "*" && Array_indexOf(selector, tag) === -1) continue;

			return (value) =>
				rule.fn(value, client.context, client.meta, (name) =>
					get(element, name)
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
	};

	const set = (element: Element, qualifiedName: string, value: string) => {
		if (isInternalAttribute(qualifiedName)) return;

		const rewrite = rewriter(element, qualifiedName);
		if (!rewrite) {
			raw.set(element, qualifiedName, value);

			return;
		}

		const rewritten = rewrite(value);

		// the mirror goes down first: the rewritten value can start a fetch the
		// moment it lands, and anything that reads the attribute back out of
		// that side effect has to already see the page's own value
		raw.set(element, mirrorAttributeName(qualifiedName), value);

		if (rewritten === null) raw.remove(element, qualifiedName);
		else raw.set(element, qualifiedName, rewritten);
	};

	const remove = (element: Element, qualifiedName: string) => {
		if (isInternalAttribute(qualifiedName)) return;

		// unconditionally, and both halves: a rule that removes the attribute
		// outright (`nonce`, `sandbox`) leaves nothing but the mirror behind, and
		// a removal that checked for the real one first would leave that mirror
		// to answer `getAttribute` forever
		raw.remove(element, mirrorAttributeName(qualifiedName));
		raw.remove(element, qualifiedName);
	};

	const names = (element: Element): string[] => {
		const all: string[] = Reflect_apply(nGetAttributeNames, element, []);

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
			if (raw.has(element, mirrored)) continue;

			// the rule removed the attribute, so its mirror is all that is left
			// to represent it
			out[out.length] = mirrored;
		}

		return out;
	};

	const node = (element: Element, qualifiedName: string): Attr | null => {
		if (isInternalAttribute(qualifiedName)) return null;

		const real: Attr | null = Reflect_apply(nGetAttributeNode, element, [
			qualifiedName,
		]);
		if (real) return real;

		// a removed attribute is represented by its mirror's node, which
		// `dom/attr.ts` renames back
		return Reflect_apply(nGetAttributeNode, element, [
			mirrorAttributeName(qualifiedName),
		]);
	};

	const access: AttributeAccess = {
		qualify,
		get,
		has,
		set,
		remove,
		names,
		rewriter,
		node,
		owner: (attr) => Reflect_apply(nOwnerElement, attr, []),
		attrName: (attr) => Reflect_apply(nAttrName, attr, []),
		attrValue: (attr) => Reflect_apply(nAttrValue, attr, []),
		setAttrValue: (attr, value) => {
			Reflect_apply(nSetAttrValue, attr, [value]);
		},
		isHtml,
		localName,
		raw,
	};

	accessors.set(client, access);

	return access;
}

export default function (client: ScramjetClient, _self: Self) {
	const attrs = attributeAccess(client);

	const invalidName = (name: string, member: string) =>
		client.errors.domException("InvalidCharacterError", {
			execute: member,
			on: "Element",
			detail: `'${name}' is not a valid attribute name.`,
		});

	/**
	 * What `setAttributeNode` has to do before the node is inserted, which is
	 * where the rewriting happens: for `src` on a connected element the browser
	 * starts fetching the moment the attribute lands, so fixing the value up
	 * afterwards would be one request to the real origin every time.
	 *
	 * Returns the page's own value to be mirrored once the insertion has been
	 * accepted, or null when there is nothing to do.
	 */
	const prepareNode = (element: Element, attr: Attr) => {
		const name = attrs.attrName(attr);
		// a page-built attribute under our own prefix would poison a mirror, so
		// it is dropped the same way `setAttribute` drops one
		if (isInternalAttribute(name)) return null;

		const rewrite = attrs.rewriter(element, name);
		if (!rewrite) return null;

		const value = attrs.attrValue(attr);
		const rewritten = rewrite(value);
		attrs.setAttrValue(attr, rewritten === null ? "" : rewritten);

		return { name, value, removed: rewritten === null };
	};

	/** The other half of {@link prepareNode}, run once the node is in place. */
	const finishNode = (
		element: Element,
		attr: Attr,
		pending: { name: string; value: string; removed: boolean }
	) => {
		attrs.raw.set(element, mirrorAttributeName(pending.name), pending.value);

		if (!pending.removed) return;

		// the rule wants the attribute gone. it had to be inserted all the same -
		// that is what makes this a *replacement* of whatever was there, which is
		// the node the page is handed back
		attrs.raw.remove(element, pending.name);
		// and the node the page still holds gets its own value back, now that it
		// is detached and writing it has no effect on the document
		attrs.setAttrValue(attr, pending.value);
	};

	// https://dom.spec.whatwg.org/#interface-element
	client.Intercept(class extends Element {
		@Arguments()
		@Returns("boolean")
		hasAttributes(): boolean {
			// the cheap answer is right unless something of ours is in the list:
			// an element carrying only a script source has attributes the page
			// must not be told about
			if (!super.hasAttributes()) return false;

			return attrs.names(this).length > 0;
		}

		@Arguments()
		@Returns("sequence<DOMString>")
		getAttributeNames(): string[] {
			void super.hasAttributes();

			return attrs.names(this);
		}

		@Arguments("DOMString")
		@Returns("DOMString?")
		getAttribute(qualifiedName: string): string | null {
			void super.hasAttributes();

			return attrs.get(this, attrs.qualify(this, qualifiedName));
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("DOMString?")
		getAttributeNS(namespace: string | null, localName: string): string | null {
			const node = super.getAttributeNodeNS(namespace, localName);
			if (!node) {
				// a namespace-less lookup can still be answered by a mirror, which
				// carries no namespace and a name the native would never match
				if (namespace) return null;
				const mirror = attrs.node(this, localName);

				return mirror ? attrs.attrValue(mirror) : null;
			}

			const name = attrs.attrName(node);
			if (isInternalAttribute(name)) return null;

			const mirror = attrs.raw.get(this, mirrorAttributeName(name));

			return mirror === null ? attrs.attrValue(node) : mirror;
		}

		// the IDL takes `(TrustedType or DOMString)`. `TrustedType` is a typedef
		// for the union of the three trusted types, expanded here because the
		// union coercer brand checks its members by name and has never heard of
		// the typedef
		@Arguments(
			"DOMString",
			"(TrustedHTML or TrustedScript or TrustedScriptURL or DOMString)"
		)
		@Returns("undefined")
		setAttribute(qualifiedName: string, value: string): void {
			void super.hasAttributes();

			// 1. If qualifiedName is not a valid attribute local name, throw an
			//    "InvalidCharacterError" DOMException
			if (!isValidAttributeLocalName(qualifiedName)) {
				throw invalidName(qualifiedName, "setAttribute");
			}

			attrs.set(this, attrs.qualify(this, qualifiedName), String(value));
		}

		@Arguments(
			"DOMString?",
			"DOMString",
			"(TrustedHTML or TrustedScript or TrustedScriptURL or DOMString)"
		)
		@Returns("undefined")
		setAttributeNS(
			namespace: string | null,
			qualifiedName: string,
			value: string
		): void {
			const text = String(value);
			const rewrite = isInternalAttribute(qualifiedName)
				? null
				: attrs.rewriter(this, qualifiedName);
			if (!rewrite) {
				return super.setAttributeNS(namespace, qualifiedName, text);
			}

			const rewritten = rewrite(text);

			// the native goes first here, unlike the namespace-less write: it
			// validates the namespace against the qualified name, and a call that
			// throws must not leave a mirror behind for every later read to
			// answer out of
			super.setAttributeNS(
				namespace,
				qualifiedName,
				rewritten === null ? "" : rewritten
			);
			if (rewritten === null) super.removeAttributeNS(namespace, qualifiedName);

			// keyed on the qualified name, which is what the document holds and
			// what a namespace-less read asks for
			super.setAttribute(mirrorAttributeName(qualifiedName), text);
		}

		@Arguments("DOMString")
		@Returns("undefined")
		removeAttribute(qualifiedName: string): void {
			void super.hasAttributes();

			attrs.remove(this, attrs.qualify(this, qualifiedName));
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("undefined")
		removeAttributeNS(namespace: string | null, localName: string): void {
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) {
				super.removeAttribute(mirrorAttributeName(attrs.attrName(node)));
			}

			super.removeAttributeNS(namespace, localName);
		}

		// `force` is `optional boolean`, not a nullable required one. declaring
		// it required made every one-argument call fail validation and fall
		// through to the native, which toggled the real attribute and left the
		// mirror behind to answer `getAttribute` forever
		@Arguments("DOMString", "optional boolean")
		@Returns("boolean")
		toggleAttribute(qualifiedName: string, force?: boolean): boolean {
			void super.hasAttributes();

			// 1. If qualifiedName is not a valid attribute local name, throw an
			//    "InvalidCharacterError" DOMException
			if (!isValidAttributeLocalName(qualifiedName)) {
				throw invalidName(qualifiedName, "toggleAttribute");
			}
			if (isInternalAttribute(qualifiedName)) return false;
			// 2. If this is in the HTML namespace and its node document is an HTML
			//    document, lowercase qualifiedName
			const name = attrs.qualify(this, qualifiedName);
			// 3. Let attribute be the first attribute whose qualified name is
			//    qualifiedName, and null otherwise
			// 4. If attribute is null:
			if (!attrs.has(this, name)) {
				// 4.2. Return false, if force is given and is false
				if (force === false) return false;
				// 4.1. Append an attribute with the empty value, and return true
				attrs.set(this, name, "");

				return true;
			}
			// 6. Return true, if force is given and is true
			if (force === true) return true;
			// 5. If force is not given or is false, remove it and return false
			attrs.remove(this, name);

			return false;
		}

		@Arguments("DOMString")
		@Returns("boolean")
		hasAttribute(qualifiedName: string): boolean {
			void super.hasAttributes();

			return attrs.has(this, attrs.qualify(this, qualifiedName));
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("boolean")
		hasAttributeNS(namespace: string | null, localName: string): boolean {
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) return !isInternalAttribute(attrs.attrName(node));

			return namespace ? false : !!attrs.node(this, localName);
		}

		@Arguments("DOMString")
		@Returns("Attr?")
		getAttributeNode(qualifiedName: string): Attr | null {
			void super.hasAttributes();

			return attrs.node(this, attrs.qualify(this, qualifiedName));
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("Attr?")
		getAttributeNodeNS(
			namespace: string | null,
			localName: string
		): Attr | null {
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) return isInternalAttribute(attrs.attrName(node)) ? null : node;

			return namespace ? null : attrs.node(this, localName);
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setAttributeNode(attr: Attr): Attr | null {
			const pending = prepareNode(this, attr);
			if (!pending) {
				if (isInternalAttribute(attrs.attrName(attr))) {
					void super.hasAttributes();

					return null;
				}

				return super.setAttributeNode(attr);
			}

			const replaced = super.setAttributeNode(attr);
			finishNode(this, attr, pending);

			return replaced;
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setAttributeNodeNS(attr: Attr): Attr | null {
			const pending = prepareNode(this, attr);
			if (!pending) {
				if (isInternalAttribute(attrs.attrName(attr))) {
					void super.hasAttributes();

					return null;
				}

				return super.setAttributeNodeNS(attr);
			}

			const replaced = super.setAttributeNodeNS(attr);
			finishNode(this, attr, pending);

			return replaced;
		}

		@Arguments("Attr")
		@Returns("Attr")
		removeAttributeNode(attr: Attr): Attr {
			const name = attrs.attrName(attr);
			// first, so an attribute this element does not have throws the spec's
			// NotFoundError before anything has been touched
			const removed = super.removeAttributeNode(attr);

			if (!isInternalAttribute(name)) {
				super.removeAttribute(mirrorAttributeName(name));
			}

			return removed;
		}
	});
}
