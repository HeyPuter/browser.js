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
	ruleAttributeName,
} from "@client/attributes";
import { String } from "@/shared/snapshot";

const internalAttributeSelector =
	/\[\s*(?:\*?\|)?scramjet-attr(?:-|\s|\]|[~|^$*=])/i;

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
			const result = super.querySelector(selectors);

			return internalAttributeSelector.test(selectors) ? null : result;
		}

		@Arguments("DOMString")
		@Returns("NodeList")
		querySelectorAll(selectors: string): NodeListOf<Element> {
			const result = super.querySelectorAll(selectors);

			return internalAttributeSelector.test(selectors)
				? super.querySelectorAll(":not(*)")
				: result;
		}

		@Arguments("DOMString")
		@Returns("boolean")
		matches(selectors: string): boolean {
			const result = super.matches(selectors);

			return internalAttributeSelector.test(selectors) ? false : result;
		}

		@Arguments("DOMString")
		@Returns("Element?")
		closest(selectors: string): Element | null {
			const result = super.closest(selectors);

			return internalAttributeSelector.test(selectors) ? null : result;
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
			// `removeAttributeNS` takes the *local* name, and a prefixed qualified
			// name handed to it matches nothing - leaving the empty attribute in
			// place of the one the rule wanted gone
			if (rewritten === null) {
				super.removeAttributeNS(namespace, localPart(qualifiedName));
			}

			// keyed on the qualified name, which is what the document holds and
			// what a namespace-less read asks for
			attrs.raw.set(this, mirrorAttributeName(qualifiedName), text);
			if (namespace === null) attrs.changed(this, qualifiedName, text);
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
				const name = attrs.attrName(node);
				if (isInternalAttribute(name)) return;
				attrs.raw.remove(this, mirrorAttributeName(name));
				super.removeAttributeNS(namespace, localName);
				if (namespace === null) attrs.changed(this, name, null);

				return;
			}

			// a rule that strips the attribute outright (`nonce`, `sandbox`)
			// leaves only the mirror, which carries no namespace - so a
			// namespace-less removal has to find it by name
			if (namespace === null && !isInternalAttribute(localName)) {
				const mirror = mirrorAttributeName(localName);
				if (attrs.raw.has(this, mirror)) {
					attrs.raw.remove(this, mirror);
					attrs.changed(this, localName, null);
				}
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
			// first, so an attribute this element does not have throws the spec's
			// NotFoundError before anything has been touched
			const removed = super.removeAttributeNode(attr);

			if (!isInternalAttribute(name)) {
				attrs.raw.remove(this, mirrorAttributeName(name));
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
