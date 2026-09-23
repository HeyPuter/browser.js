/**
 * The `Element` half of the attribute layer: every member that reads or writes
 * an attribute by name, answered through `client.attributes` (see
 * `client/attributes.ts`).
 *
 * https://dom.spec.whatwg.org/#interface-element
 */

import { ScramjetClient } from "@client/index";
import { Arguments, Returns } from "@client/webidl";
import {
	isInternalAttribute,
	isValidAttributeLocalName,
	localPart,
	mirrorAttributeName,
	mirroredAttributeName,
	nullNamespace,
	ruleAttributeName,
} from "@client/attributes";
import { String } from "@/shared/snapshot";
import { hideInternalAttributes } from "@client/selectors";

export default function (client: ScramjetClient, _self: Self) {
	const attrs = client.attributes;

	const invalidName = (name: string, member: string) =>
		client.errors.domException("InvalidCharacterError", {
			execute: member,
			on: "Element",
			detail: `'${name}' is not a valid attribute name.`,
		});

	// https://dom.spec.whatwg.org/#interface-element
	client.Intercept(class extends Element {
		@Arguments("DOMString")
		@Returns("Element?")
		querySelector(selectors: string): Element | null {
			// the native first, on what the page wrote: an invalid selector
			// throws a SyntaxError that has to quote the page's own string
			const result = super.querySelector(selectors);
			const hidden = hideInternalAttributes(selectors);

			return hidden === null ? result : super.querySelector(hidden);
		}

		@Arguments("DOMString")
		@Returns("NodeList")
		querySelectorAll(selectors: string): NodeListOf<Element> {
			const result = super.querySelectorAll(selectors);
			const hidden = hideInternalAttributes(selectors);

			return hidden === null ? result : super.querySelectorAll(hidden);
		}

		@Arguments("DOMString")
		@Returns("boolean")
		matches(selectors: string): boolean {
			const result = super.matches(selectors);
			const hidden = hideInternalAttributes(selectors);

			return hidden === null ? result : super.matches(hidden);
		}

		@Arguments("DOMString")
		@Returns("Element?")
		closest(selectors: string): Element | null {
			const result = super.closest(selectors);
			const hidden = hideInternalAttributes(selectors);

			return hidden === null ? result : super.closest(hidden);
		}

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
			namespace = nullNamespace(namespace);
			const node = super.getAttributeNodeNS(namespace, localName);
			if (!node) {
				// a namespace-less lookup can still be answered by a mirror, which
				// carries no namespace and a name the native would never match
				if (namespace) return null;
				const mirror = attrs.strippedNode(this, localName);

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
			namespace = nullNamespace(namespace);
			const text = String(value);
			if (isInternalAttribute(qualifiedName)) {
				void super.hasAttributes();

				return;
			}
			const rewrite = attrs.rewriter(
				this,
				ruleAttributeName(namespace, qualifiedName)
			);
			if (!rewrite) {
				super.setAttributeNS(namespace, qualifiedName, text);
				if (namespace === null) {
					attrs.changed(this, qualifiedName, text);
				}

				return;
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
			// keyed on the qualified name the document holds, which is what a
			// namespace-less read asks for. that is not necessarily the one just
			// passed: an existing attribute in the same namespace under another
			// prefix only has its value changed, and keeps its own name
			const local = localPart(qualifiedName);
			const node = super.getAttributeNodeNS(namespace, local);
			const name = node ? attrs.attrName(node) : qualifiedName;
			// `removeAttributeNS` takes the *local* name, and a prefixed qualified
			// name handed to it matches nothing - leaving the empty attribute in
			// place of the one the rule wanted gone
			if (rewritten === null) super.removeAttributeNS(namespace, local);

			attrs.raw.set(this, mirrorAttributeName(name), text);
			if (namespace === null) attrs.changed(this, name, text);
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
			namespace = nullNamespace(namespace);
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) {
				const name = attrs.attrName(node);
				if (isInternalAttribute(name)) return;
				const mirror = attrs.raw.get(this, mirrorAttributeName(name));
				attrs.raw.remove(this, mirrorAttributeName(name));
				super.removeAttributeNS(namespace, localName);
				attrs.detached(node, mirror);
				if (namespace === null) attrs.changed(this, name, null);

				return;
			}

			// a rule that strips the attribute outright (`nonce`, `sandbox`)
			// leaves only the mirror, which carries no namespace - so a
			// namespace-less removal has to find it by name
			if (namespace === null && attrs.strippedNode(this, localName)) {
				attrs.raw.remove(this, mirrorAttributeName(localName));
				attrs.changed(this, localName, null);
			}
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
			namespace = nullNamespace(namespace);
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) return !isInternalAttribute(attrs.attrName(node));

			return namespace ? false : !!attrs.strippedNode(this, localName);
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
			namespace = nullNamespace(namespace);
			const node = super.getAttributeNodeNS(namespace, localName);
			if (node) return isInternalAttribute(attrs.attrName(node)) ? null : node;

			return namespace ? null : attrs.strippedNode(this, localName);
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setAttributeNode(attr: Attr): Attr | null {
			void super.hasAttributes();

			return attrs.insertNode(this, attr, false);
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setAttributeNodeNS(attr: Attr): Attr | null {
			void super.hasAttributes();

			return attrs.insertNode(this, attr, true);
		}

		@Arguments("Attr")
		@Returns("Attr")
		removeAttributeNode(attr: Attr): Attr {
			const name = attrs.attrName(attr);
			const mirror = isInternalAttribute(name)
				? null
				: attrs.raw.get(this, mirrorAttributeName(name));
			// first, so an attribute this element does not have throws the spec's
			// NotFoundError before anything has been touched
			const removed = super.removeAttributeNode(attr);

			if (!isInternalAttribute(name)) {
				attrs.raw.remove(this, mirrorAttributeName(name));
				attrs.detached(removed, mirror);
				attrs.changed(this, name, null);
			} else {
				// the mirror node standing in for a stripped attribute is what
				// `getAttributeNode("nonce")` hands out, and removing it is
				// removing that attribute
				const mirrored = mirroredAttributeName(name);
				if (mirrored) attrs.changed(this, mirrored, null);
			}

			return removed;
		}
	});
}
