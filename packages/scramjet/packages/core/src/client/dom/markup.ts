/**
 * The markup sinks: every member that takes a string of HTML and parses it into
 * the document, and every one that serializes a subtree back out.
 *
 * Each of them is the same pair of operations - `rewriteHtml` on the way in,
 * `unrewriteHtml` on the way out - and the only thing that varies is which
 * element supplies the *foreign context*. HTML, SVG and MathML tokenize
 * differently, so a fragment parsed with the wrong one comes out as a different
 * tree; the rewriter has to be told which it is, and which element to ask
 * depends on where the fragment is going.
 *
 * https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html
 * https://html.spec.whatwg.org/multipage/parsing.html#html-fragment-parsing-algorithm
 */

import { ScramjetClient } from "@client/index";
import { Arguments, Returns, Type } from "@client/webidl";
import { textAccess } from "@client/dom/node";
import { rewriteHtml, unrewriteHtml } from "@rewriters/html";
import { ForeignContext } from "@/shared/rewriters/html";
import { isHtmlMimeType } from "@/shared/mime";
import { String, String_toLowerCase } from "@/shared/snapshot";

/** The tokenizer context *inside* `element`. */
export function foreignContextForElement(
	client: ScramjetClient,
	element: Element
): ForeignContext {
	if (client.box.instanceof(element, "SVGElement")) return "svg";
	if (client.box.instanceof(element, "MathMLElement")) return "math";

	return "html";
}

/**
 * The tokenizer context `element` itself sits in - what its parent supplies.
 *
 * NOT inclusive of the element: a `<foreignObject>`'s own context is svg, and
 * an HTML element inside one is html.
 */
export function insideForeignContext(
	client: ScramjetClient,
	element: Element | null
): ForeignContext {
	let current: Element | null = element && element.parentElement;

	while (current) {
		const context = foreignContextForElement(client, current);
		if (context !== "html") return context;
		// EXPLICITLY an html context, don't go up further
		if (client.box.instanceof(current, "SVGForeignObjectElement"))
			return "html";
		current = current.parentElement;
	}

	return "html";
}

export default function (client: ScramjetClient, _self: Self) {
	const text = textAccess(client);

	const parse = (
		html: string,
		apisource: string,
		foreignContext: ForeignContext
	) =>
		rewriteHtml(html, client.context, client.meta, {
			loadScripts: false,
			inline: true,
			source: client.url.href,
			apisource,
			foreignContext,
		});

	const serialize = (html: string, foreignContext: ForeignContext) =>
		unrewriteHtml(html, foreignContext, client.context);

	// https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-element-innerhtml
	client.Intercept(class extends Element {
		// the IDL union hands a TrustedHTML through as the object it is - that is
		// what the brand check is for - and on an engine with no TrustedHTML at
		// all the whole union degrades to a passthrough. the rewriters take a
		// string either way
		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		set innerHTML(value: string) {
			// `tagName` rather than `innerHTML`: the brand check has to happen on
			// every path, and reading the native innerHTML to get one would
			// serialize the whole subtree for nothing
			void super.tagName;

			const html = String(value);

			// a script or a style is a raw text element: its "markup" is never
			// parsed as markup, it is the element's source
			if (text.kind(this) !== null) {
				text.setSource(this, html);

				return;
			}

			super.innerHTML = parse(
				html,
				"set Element.prototype.innerHTML",
				foreignContextForElement(client, this)
			);
		}

		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		get innerHTML(): string {
			if (text.kind(this) !== null) {
				void super.tagName;

				return text.source(this);
			}

			return serialize(super.innerHTML, foreignContextForElement(client, this));
		}

		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		set outerHTML(value: string) {
			super.outerHTML = parse(
				String(value),
				"set Element.prototype.outerHTML",
				// the fragment replaces this element, so it is parsed in the
				// context its *parent* supplies
				insideForeignContext(client, this)
			);
		}

		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		get outerHTML(): string {
			// the serialization contains this element's own tag, so it has to be
			// re-parsed in the context that tag sits in
			return serialize(super.outerHTML, insideForeignContext(client, this));
		}

		@Arguments("(TrustedHTML or DOMString)", "optional SetHTMLUnsafeOptions")
		@Returns("undefined")
		setHTMLUnsafe(html: string, options?: SetHTMLUnsafeOptions): void {
			super.setHTMLUnsafe(
				parse(
					String(html),
					"Element.prototype.setHTMLUnsafe",
					foreignContextForElement(client, this)
				),
				options
			);
		}

		// the sanitizing sibling of setHTMLUnsafe. what it removes is scripting,
		// not URLs, so everything it leaves behind still has to be rewritten
		@Arguments("DOMString", "optional SetHTMLOptions")
		@Returns("undefined")
		setHTML(html: string, options?: SetHTMLOptions): void {
			super.setHTML(
				parse(
					String(html),
					"Element.prototype.setHTML",
					foreignContextForElement(client, this)
				),
				options
			);
		}

		@Arguments("optional GetHTMLOptions")
		@Returns("DOMString")
		getHTML(options?: GetHTMLOptions): string {
			return serialize(
				super.getHTML(options),
				foreignContextForElement(client, this)
			);
		}

		@Arguments("DOMString", "(TrustedHTML or DOMString)")
		@Returns("undefined")
		insertAdjacentHTML(position: string, string: string): void {
			const where = String_toLowerCase(String(position));
			// beforebegin and afterend parse against this element's parent, the
			// other two against this element
			const context =
				where === "beforebegin" || where === "afterend"
					? insideForeignContext(client, this)
					: foreignContextForElement(client, this);

			super.insertAdjacentHTML(
				position as InsertPosition,
				parse(String(string), "Element.prototype.insertAdjacentHTML", context)
			);
		}
	});

	// a shadow root's markup is parsed against its host, which is the element
	// the fragment will be rendered inside
	client.Intercept(class extends ShadowRoot {
		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		set innerHTML(value: string) {
			super.innerHTML = parse(
				String(value),
				"set ShadowRoot.prototype.innerHTML",
				foreignContextForElement(client, super.host)
			);
		}

		@Type("(TrustedHTML or [LegacyNullToEmptyString] DOMString)")
		get innerHTML(): string {
			return serialize(
				super.innerHTML,
				foreignContextForElement(client, super.host)
			);
		}

		@Arguments("(TrustedHTML or DOMString)", "optional SetHTMLUnsafeOptions")
		@Returns("undefined")
		setHTMLUnsafe(html: string, options?: SetHTMLUnsafeOptions): void {
			super.setHTMLUnsafe(
				parse(
					String(html),
					"ShadowRoot.prototype.setHTMLUnsafe",
					foreignContextForElement(client, super.host)
				),
				options
			);
		}

		@Arguments("DOMString", "optional SetHTMLOptions")
		@Returns("undefined")
		setHTML(html: string, options?: SetHTMLOptions): void {
			super.setHTML(
				parse(
					String(html),
					"ShadowRoot.prototype.setHTML",
					foreignContextForElement(client, super.host)
				),
				options
			);
		}

		@Arguments("optional GetHTMLOptions")
		@Returns("DOMString")
		getHTML(options?: GetHTMLOptions): string {
			return serialize(
				super.getHTML(options),
				foreignContextForElement(client, super.host)
			);
		}
	});

	// https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring
	client.Intercept(class extends DOMParser {
		@Arguments("(TrustedHTML or DOMString)", "DOMParserSupportedType")
		@Returns("Document")
		parseFromString(string: string, type: DOMParserSupportedType): Document {
			// TODO: an XML or SVG document is parsed by a different parser, and
			// running it through the HTML rewriter would rewrite the wrong things
			if (!isHtmlMimeType(String(type))) {
				return super.parseFromString(string, type);
			}

			return super.parseFromString(
				parse(String(string), "DOMParser.prototype.parseFromString", "html"),
				type
			);
		}
	});
}
