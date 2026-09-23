import { basicTest } from "../../testcommon.ts";

/* eslint-disable quotes -- browser snippets are clearer as template literals */

// Reproductions for findings in the review of #112. These exercise
// the public DOM surface, so the same assertions run in the bare harness.

export default [
	basicTest({
		name: "elementlayer-review112-empty-namespace-nonce-change",
		js: `
			const script = document.createElement("script");
			script.nonce = "old-slot";
			script.setAttributeNS("", "nonce", "new-content");
			assertEqual(script.nonce, "new-content", "empty namespace is the null namespace for nonce change steps");
			assertEqual(script.getAttributeNS(null, "nonce"), "new-content", "content attribute remains visible");
			script.removeAttributeNS("", "nonce");
			assertEqual(script.nonce, "", "empty-namespace removal clears the slot");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-detached-attr-after-removal",
		js: `
			const img = document.createElement("img");
			const url = "https://example.test/old.png";
			img.setAttribute("src", url);
			const attr = img.getAttributeNode("src");
			assertEqual(img.removeAttributeNode(attr), attr, "returned attribute identity");
			assertEqual(attr.ownerElement, null, "the attribute is detached");
			assertEqual(attr.value, url, "detached attribute retains the page value");
			assertEqual(attr.nodeValue, url, "detached nodeValue retains the page value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-detached-attr-after-replacement",
		js: `
			const img = document.createElement("img");
			const oldUrl = "https://example.test/old.png";
			const newUrl = "https://example.test/new.png";
			img.setAttribute("src", oldUrl);
			const replacement = document.createAttribute("src");
			replacement.value = newUrl;
			const old = img.setAttributeNode(replacement);
			assertEqual(old.value, oldUrl, "replaced Attr retains the page value");
			assertEqual(replacement.value, newUrl, "inserted Attr exposes the page value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-detached-attr-from-namednodemap",
		js: `
			const img = document.createElement("img");
			const url = "https://example.test/old.png";
			img.setAttribute("src", url);
			const removed = img.attributes.removeNamedItem("src");
			assertEqual(removed.value, url, "NamedNodeMap removal retains the page value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-null-namespace-does-not-find-xlink",
		js: `
			const xlink = "http://www.w3.org/1999/xlink";
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			use.setAttributeNS(xlink, "xlink:href", "https://example.test/icon.svg#shape");
			assertEqual(use.getAttributeNS(null, "xlink:href"), null, "getAttributeNS requires the namespace");
			assertEqual(use.hasAttributeNS(null, "xlink:href"), false, "hasAttributeNS requires the namespace");
			assertEqual(use.getAttributeNodeNS(null, "xlink:href"), null, "getAttributeNodeNS requires the namespace");
			assertEqual(use.attributes.getNamedItemNS(null, "xlink:href"), null, "getNamedItemNS requires the namespace");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-xlink-prefix-change-mirror",
		js: `
			const xlink = "http://www.w3.org/1999/xlink";
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			const first = "https://example.test/first.svg#shape";
			const second = "https://example.test/second.svg#shape";
			use.setAttributeNS(xlink, "x:href", first);
			use.setAttributeNS(xlink, "y:href", second);
			assertEqual(use.getAttributeNS(xlink, "href"), second, "updated namespaced value");
			assertEqual(use.getAttribute("x:href"), second, "existing qualified name reflects the update");
			assertEqual(use.getAttribute("y:href"), null, "no phantom attribute under the new prefix");
			assertEqual(use.getAttributeNames().filter((name) => name === "y:href").length, 0, "no phantom name");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-numeric-attribute-map-keys",
		js: `
			const div = document.createElement("div");
			div.setAttribute("0", "zero");
			const keys = Reflect.ownKeys(div.attributes);
			assert(keys.includes("0"), "numeric attribute is present in own keys");
			assertEqual(div.attributes[0].name, "0", "indexed property remains available");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-selector-list-with-internal-branch",
		js: `
			const host = document.createElement("section");
			const div = document.createElement("div");
			host.append(div);
			assertEqual(host.querySelector("div, [scramjet-attr-src]"), div, "ordinary selector branch still matches");
			assertEqual(host.querySelectorAll("div, [scramjet-attr-src]").length, 1, "selector list retains ordinary matches");
			assertEqual(div.matches("div, [scramjet-attr-src]"), true, "matches accepts either branch");
			assertEqual(div.matches(":not([scramjet-attr-src])"), true, "a hidden attribute is absent for negation");
			assertEqual(div.closest("div, [scramjet-attr-src]"), div, "closest accepts either branch");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-wholetext-stops-at-comment",
		js: `
			const script = document.createElement("script");
			const first = document.createTextNode("left");
			const second = document.createTextNode("right");
			script.append(first, document.createComment("separator"), second);
			assertEqual(first.wholeText, "left", "first run of contiguous Text nodes");
			assertEqual(second.wholeText, "right", "second run of contiguous Text nodes");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-rawtext-innerhtml-serializes-children",
		js: `
			const script = document.createElement("script");
			script.appendChild(document.createComment("marker"));
			assertEqual(script.innerHTML, "<!--marker-->", "script innerHTML serializes comment children");
			if (typeof script.getHTML === "function") {
				assertEqual(script.getHTML(), "<!--marker-->", "script getHTML serializes comment children");
			}
		`,
	}),
	basicTest({
		name: "elementlayer-review112-attr-callback-sees-page-value",
		js: `
			const observed = [];
			class Review112StyleElement extends HTMLElement {
				static observedAttributes = ["style"];
				attributeChangedCallback() {
					observed.push(this.getAttribute("style"));
				}
			}
			customElements.define("review112-style", Review112StyleElement);
			const element = document.createElement("review112-style");
			const value = "background-image: url(https://example.test/image.png)";
			const attr = document.createAttribute("style");
			attr.value = value;
			element.setAttributeNode(attr);
			assertEqual(observed.length, 1, "one callback for the style attribute");
			assertEqual(observed[0], value, "callback sees the page's value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-prefixed-xlink-attr-value",
		js: `
			const xlink = "http://www.w3.org/1999/xlink";
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			const first = "https://example.test/first.svg#shape";
			const second = "https://example.test/second.svg#shape";
			use.setAttributeNS(xlink, "p:href", first);
			const attr = use.getAttributeNodeNS(xlink, "href");
			attr.value = second;
			assertEqual(attr.value, second, "Attr.value reflects the new page URL");
			assertEqual(use.getAttributeNS(xlink, "href"), second, "the XLink attribute is updated");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-namespace-mirror-collision",
		js: `
			const img = document.createElement("img");
			const first = "https://example.test/image.png";
			const second = "https://example.test/other.png";
			img.setAttribute("src", first);
			img.setAttributeNS("urn:review112", "src", second);
			assertEqual(img.getAttribute("src"), first, "the null-namespace src keeps its own value");
			assertEqual(img.getAttributeNS(null, "src"), first, "null-namespace lookup keeps its own value");
			assertEqual(img.getAttributeNS("urn:review112", "src"), second, "the unrelated namespaced attribute keeps its value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-namespaced-callback-sees-page-value",
		js: `
			const observed = [];
			class Review112NamespacedStyleElement extends HTMLElement {
				static observedAttributes = ["style"];
				attributeChangedCallback() {
					observed.push(this.getAttribute("style"));
				}
			}
			customElements.define("review112-ns-style", Review112NamespacedStyleElement);
			const element = document.createElement("review112-ns-style");
			const value = "background-image: url(https://example.test/image.png)";
			element.setAttributeNS(null, "style", value);
			assertEqual(observed.length, 1, "the style change fires one callback");
			assertEqual(observed[0], value, "the synchronous callback sees the page's CSS");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-attribute-map-duplicate-qualified-names",
		js: `
			const element = document.createElement("div");
			element.setAttributeNS("urn:first", "p:x", "one");
			element.setAttributeNS("urn:second", "p:x", "two");
			assertEqual(element.attributes.length, 2, "both namespace-distinct attributes are listed");
			assertEqual(element.attributes.item(0).namespaceURI, "urn:first", "first indexed attribute");
			assertEqual(element.attributes.item(1).namespaceURI, "urn:second", "second indexed attribute");
			assert(element.attributes[0] !== element.attributes[1], "indexed properties identify distinct Attr nodes");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-setattributenode-replaces-other-prefix",
		js: `
			const xlink = "http://www.w3.org/1999/xlink";
			const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
			const first = "https://example.test/first.svg#shape";
			const second = "https://example.test/second.svg#shape";
			use.setAttributeNS(xlink, "xlink:href", first);
			const old = use.getAttributeNodeNS(xlink, "href");
			const replacement = document.createAttributeNS(xlink, "p:href");
			replacement.value = second;
			assertEqual(use.setAttributeNode(replacement), old, "the matching namespace and local name are replaced");
			assertEqual(old.ownerElement, null, "the old Attr is detached");
			assertEqual(old.value, first, "the detached Attr retains its page value");
			assertEqual(use.getAttributeNS(xlink, "href"), second, "the replacement exposes its page value");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-cloned-script-text-source",
		js: `
			const script = document.createElement("script");
			const source = "var __review112 = location.href.length + 1;";
			script.textContent = source;
			const clone = script.firstChild.cloneNode();
			assertEqual(clone.data, source, "a cloned Text node exposes the page's source");
			assertEqual(clone.textContent, source, "cloned textContent exposes the page's source");
		`,
	}),
	basicTest({
		name: "elementlayer-review112-fragment-moved-script-text-source",
		js: `
			const script = document.createElement("script");
			const source = "var __review112 = location.href.length + 1;";
			script.textContent = source;
			const text = script.firstChild;
			const fragment = document.createDocumentFragment();
			fragment.append(text);
			assertEqual(text.data, source, "the moved Text node keeps the page source");
			assertEqual(fragment.textContent, source, "the fragment exposes the page source");
		`,
	}),
];
