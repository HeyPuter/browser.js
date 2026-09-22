/**
 * `Attr` and `NamedNodeMap` - the other two ways to reach an attribute.
 *
 * Everything here is the same mirror the `Element` members in `dom/element.ts`
 * present, seen from the node side: an `Attr` answers with its element's mirror
 * rather than with what the document holds, a mirror that stands in for an
 * attribute a rule removed answers under that attribute's name, and the map
 * lists exactly what `getAttributeNames` lists.
 *
 * The map is the one place a Proxy is unavoidable. Its indices and named
 * properties are exotic - the browser generates them from the attribute list,
 * which contains our mirrors - so they cannot be intercepted as members. Its
 * *methods* can, and are, so a borrowed `NamedNodeMap.prototype.getNamedItem`
 * answers the same as the one the wrapper hands out.
 *
 * https://dom.spec.whatwg.org/#interface-namednodemap
 * https://dom.spec.whatwg.org/#interface-attr
 */

import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import {
	attributeAccess,
	isInternalAttribute,
	mirrorAttributeName,
	mirroredAttributeName,
} from "@client/dom/element";
import {
	Number,
	Number_isInteger,
	Object_getOwnPropertyDescriptor,
	Object_getPrototypeOf,
	Reflect_apply,
	Reflect_get,
	Reflect_has,
	Reflect_ownKeys,
	String,
	_Map,
} from "@/shared/snapshot";

/**
 * The value an `Attr` should report, which is its element's mirror when it has
 * one. Shared with `dom/text.ts`, which owns `Node.prototype.nodeValue` and
 * `textContent` - both of which are an attribute's value when the node is one.
 */
export function attrValue(client: ScramjetClient, attr: Attr): string {
	const attrs = attributeAccess(client);
	const name = attrs.attrName(attr);
	// a mirror's own value *is* the page's value
	if (isInternalAttribute(name)) return attrs.attrValue(attr);

	const owner = attrs.owner(attr);
	if (!owner) return attrs.attrValue(attr);

	const mirror = attrs.raw.get(owner, mirrorAttributeName(name));

	return mirror === null ? attrs.attrValue(attr) : mirror;
}

/** The write half of {@link attrValue}, so a rule sees the value first. */
export function setAttrValue(
	client: ScramjetClient,
	attr: Attr,
	value: string
): void {
	const attrs = attributeAccess(client);
	const name = attrs.attrName(attr);
	const owner = attrs.owner(attr);

	// detached, or the mirror itself: there is no rule to apply, and writing the
	// mirror is how the page's value is meant to be changed
	if (!owner || isInternalAttribute(name)) {
		attrs.setAttrValue(attr, value);

		return;
	}

	attrs.set(owner, name, value);
}

/**
 * The position `prop` names in the map, or -1 when it does not name one.
 *
 * A property key is an index only if it is the *canonical* spelling of one, so
 * that "01", " 1" and "1e0" stay ordinary property names the way they do on an
 * array. Round-tripping the number back to a string is what tests that.
 */
function indexOf(prop: string | symbol): number {
	if (typeof prop !== "string") return -1;

	const index = Number(prop);
	if (!Number_isInteger(index) || index < 0) return -1;

	return `${index}` === prop ? index : -1;
}

export default function (client: ScramjetClient, _self: Self) {
	const attrs = attributeAccess(client);
	const namedNodeMap = client.nativeStore.get("NamedNodeMap")!;
	const nItem = namedNodeMap.item.value;

	/**
	 * The element a map belongs to.
	 *
	 * Recorded when the map is handed out, because `NamedNodeMap` exposes no way
	 * back to its element and an empty map has no attribute to ask. The fallback
	 * covers a map that reached us another way: any map with something in it can
	 * be traced through its first attribute, and one with nothing in it has
	 * nothing for the mirror layer to say about it either.
	 */
	const ownerOf = (map: NamedNodeMap): Element | null => {
		const known = client.box.attributeOwners.get(map);
		if (known) return known;

		const first: Attr | null = Reflect_apply(nItem, map, [0]);

		return first ? attrs.owner(first) : null;
	};

	/** The attribute at `index` of what the page can see. */
	const itemAt = (map: NamedNodeMap, index: number): Attr | null => {
		const element = ownerOf(map);
		if (!element) return Reflect_apply(nItem, map, [index]);

		const names = attrs.names(element);
		if (index >= names.length) return null;

		return attrs.node(element, names[index]);
	};

	/**
	 * The wrapper the page is handed for `element.attributes`.
	 *
	 * Only the exotic half is implemented here. Every method and `length` falls
	 * through to the prototype, where the interceptors below already answer in
	 * terms of the visible list - bound to the real map, because a Proxy carries
	 * none of the internal slots the natives brand check for.
	 */
	const wrap = (element: Element, map: NamedNodeMap): NamedNodeMap => {
		const prototype = Object_getPrototypeOf(map);
		const bound = new _Map<string | symbol, any>([]);

		const rebind = (prop: string | symbol, value: any) => {
			if (typeof value !== "function") return value;

			const existing = bound.get(prop);
			if (existing) return existing;

			const fn = new Proxy(value, {
				apply: (target, _that, args) => Reflect_apply(target, map, args),
			});
			client.box.unproxy.set(fn, value);
			bound.set(prop, fn);

			return fn;
		};

		/** The `Attr` for a named property, or null when `prop` is not one. */
		const named = (prop: string | symbol): Attr | null => {
			if (typeof prop !== "string") return null;
			// a property the object or its prototype chain already has is not a
			// named property at all - which is why `attributes.length` is the
			// count even on an element carrying a `length` attribute
			// https://webidl.spec.whatwg.org/#dfn-named-property-visibility
			if (Reflect_has(prototype, prop)) return null;
			if (indexOf(prop) !== -1) return null;

			return attrs.node(element, prop);
		};

		return new Proxy(map, {
			// deliberately not forwarding the receiver: it is this proxy, and a
			// native accessor called with a proxy as its receiver fails its own
			// brand check. `length` is an accessor
			get(target, prop) {
				const index = indexOf(prop);
				if (index !== -1) return itemAt(target, index) ?? undefined;

				const attr = named(prop);
				if (attr) return attr;
				// a mirror, or anything else of ours that the native would answer
				// with under its real name
				if (typeof prop === "string" && isInternalAttribute(prop)) {
					return undefined;
				}

				return rebind(prop, Reflect_get(target, prop));
			},

			has(target, prop) {
				const index = indexOf(prop);
				if (index !== -1) return index < attrs.names(element).length;
				if (named(prop)) return true;
				if (typeof prop === "string" && isInternalAttribute(prop)) return false;

				return Reflect_has(target, prop);
			},

			ownKeys(target) {
				const names = attrs.names(element);
				const keys: (string | symbol)[] = [];
				const seen = new _Map<string, true>([]);

				for (let i = 0; i < names.length; i++) keys[keys.length] = String(i);
				for (let i = 0; i < names.length; i++) {
					if (seen.get(names[i])) continue;
					seen.set(names[i], true);
					keys[keys.length] = names[i];
				}
				// anything the native owns that is neither an index nor an
				// attribute name. there is nothing in practice, but a key that
				// exists and is left out of `ownKeys` is a proxy invariant
				// violation waiting to happen
				const own = Reflect_ownKeys(target);
				for (let i = 0; i < own.length; i++) {
					const key = own[i];
					if (typeof key !== "string") {
						keys[keys.length] = key;
						continue;
					}
					if (
						indexOf(key) !== -1 ||
						seen.get(key) ||
						isInternalAttribute(key)
					) {
						continue;
					}
					if (attrs.node(element, key)) continue;
					keys[keys.length] = key;
				}

				return keys;
			},

			getOwnPropertyDescriptor(target, prop) {
				const index = indexOf(prop);
				if (index !== -1) {
					const attr = itemAt(target, index);
					if (!attr) return undefined;

					return {
						value: attr,
						writable: false,
						// an indexed property is enumerable; a named one is not,
						// because NamedNodeMap is [LegacyUnenumerableNamedProperties]
						enumerable: true,
						configurable: true,
					};
				}

				const attr = named(prop);
				if (attr) {
					return {
						value: attr,
						writable: false,
						enumerable: false,
						configurable: true,
					};
				}

				if (typeof prop === "string" && isInternalAttribute(prop)) {
					return undefined;
				}

				return Object_getOwnPropertyDescriptor(target, prop);
			},
		});
	};

	client.Intercept(class extends Element {
		@Type("NamedNodeMap")
		get attributes(): NamedNodeMap {
			const map = super.attributes;

			let wrapper = client.box.attributeMaps.get(map);
			if (!wrapper) {
				wrapper = wrap(this, map);
				client.box.attributeMaps.set(map, wrapper);
				client.box.attributeOwners.set(map, this);
			}

			return wrapper;
		}
	});

	// https://dom.spec.whatwg.org/#interface-namednodemap
	client.Intercept(class extends NamedNodeMap {
		@Type("unsigned long")
		get length(): number {
			const native = super.length;
			const element = ownerOf(this);
			if (!element) return native;

			return attrs.names(element).length;
		}

		@Arguments("unsigned long")
		@Returns("Attr?")
		item(index: number): Attr | null {
			void super.length;

			return itemAt(this, index);
		}

		@Arguments("DOMString")
		@Returns("Attr?")
		getNamedItem(qualifiedName: string): Attr | null {
			void super.length;

			const element = ownerOf(this);
			if (!element) return super.getNamedItem(qualifiedName);

			return attrs.node(element, attrs.qualify(element, qualifiedName));
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("Attr?")
		getNamedItemNS(namespace: string | null, localName: string): Attr | null {
			const node = super.getNamedItemNS(namespace, localName);
			if (node) return isInternalAttribute(attrs.attrName(node)) ? null : node;

			const element = ownerOf(this);
			if (!element || namespace) return null;

			return attrs.node(element, localName);
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setNamedItem(attr: Attr): Attr | null {
			void super.length;

			const element = ownerOf(this);
			if (!element) return super.setNamedItem(attr);

			// the same operation as `Element.setAttributeNode`, under another
			// name, so it goes through the same element
			return element.setAttributeNode(attr);
		}

		@Arguments("Attr")
		@Returns("Attr?")
		setNamedItemNS(attr: Attr): Attr | null {
			void super.length;

			const element = ownerOf(this);
			if (!element) return super.setNamedItemNS(attr);

			return element.setAttributeNodeNS(attr);
		}

		@Arguments("DOMString")
		@Returns("Attr")
		removeNamedItem(qualifiedName: string): Attr {
			void super.length;

			const element = ownerOf(this);
			if (!element) return super.removeNamedItem(qualifiedName);

			const name = attrs.qualify(element, qualifiedName);
			const node = attrs.node(element, name);
			// nothing visible under that name: hand it to the native, which
			// throws the spec's NotFoundError
			if (!node) return super.removeNamedItem(name);

			const removed = super.removeNamedItem(attrs.attrName(node));
			attrs.raw.remove(element, mirrorAttributeName(name));

			return removed;
		}

		@Arguments("DOMString?", "DOMString")
		@Returns("Attr")
		removeNamedItemNS(namespace: string | null, localName: string): Attr {
			const node = super.getNamedItemNS(namespace, localName);
			const element = ownerOf(this);

			if (node && element) {
				attrs.raw.remove(element, mirrorAttributeName(attrs.attrName(node)));
			}

			return super.removeNamedItemNS(namespace, localName);
		}
	});

	// https://dom.spec.whatwg.org/#interface-attr
	client.Intercept(class extends Attr {
		@Type("DOMString")
		get name(): string {
			const name = super.name;
			const mirrored = mirroredAttributeName(name);

			// "" is an internal attribute standing in for nothing, which is never
			// handed to the page in the first place; renaming it would only make
			// it harder to recognize in a debugger
			return mirrored ? mirrored : name;
		}

		@Type("DOMString")
		get localName(): string {
			const name = super.name;
			const mirrored = mirroredAttributeName(name);

			// a mirror is written without a namespace, so its local name and its
			// qualified name are the same string
			return mirrored ? mirrored : super.localName;
		}

		@Type("DOMString")
		get value(): string {
			void super.name;

			return attrValue(client, this);
		}

		@Type("DOMString")
		set value(value: string) {
			void super.name;

			setAttrValue(client, this, String(value));
		}
	});
}
