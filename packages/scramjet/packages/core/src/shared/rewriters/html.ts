import {
	type AnyNode,
	type CDATA,
	type ChildNode,
	type Document,
	DomBuilder,
	Element,
	ElementType,
	Parser,
	parseDocument,
	render,
	renderStartTag,
	Text,
} from "@/shared/htmlparser";
import { type NullArray, nullArray } from "@/shared/htmlparser/safe";
import { URLMeta, frozenBaseUrl, rewriteUrl } from "@rewriters/url";
import { rewriteCss, unrewriteCss } from "@rewriters/css";
import { rewriteJs } from "@rewriters/js";
import { rewriteImportMap } from "@rewriters/importmap";
import { ScramjetContext } from "@/shared";
import { htmlRules } from "@/shared/htmlRules";
import { base64Decode, bytesToBase64 } from "@/shared/util";
import { Tap } from "@/Tap";
import { RawHeaders } from "@mercuryworkshop/proxy-transports";
import {
	Error,
	Performance_now,
	Object_getOwnPropertyDescriptor,
	Object_keys,
	TextEncoder_encode,
	Array_indexOf,
	String_slice,
	String_startsWith,
	String_toLowerCase,
	String_trim,
	_URL,
	_WeakSet,
	_RegExp,
	RegExp_exec,
} from "@/shared/snapshot";
import { flagEnabled } from "..";
import {
	getScriptBlockTypeString,
	isModuleScriptType,
	isScriptType,
} from "@/shared/mime";

export type ForeignContext = "svg" | "math" | "html";

/**
 * Where a script element's original source is kept, in base64.
 *
 * Under the prefix every internal attribute shares, so it is hidden like the
 * rest - but not under the `scramjet-attr-` a mirror is named with. As
 * `scramjet-attr-script-source-src` it was also the mirror of a page's own
 * `script-source-src` attribute, and every lookup of that name found the
 * source instead.
 */
export const SCRIPT_SOURCE_ATTRIBUTE = "scramjet-attr_script-source";

/** The name the mirror of `attr` is kept under. */
const mirrorName = (attr: string) => `scramjet-attr-${attr}`;

// Initialized on first rewrite because htmlRules imports rewriteHtml from this
// module. Keep rule order, but avoid enumerating every rule for every element.
let ruleAttributeNames: string[][] | undefined;
function getRuleAttributeNames(): string[][] {
	if (ruleAttributeNames) return ruleAttributeNames;
	const all: string[][] = [];
	for (let i = 0; i < htmlRules.length; i++) {
		const names = Object_keys(htmlRules[i]);
		const attributes: string[] = [];
		for (let j = 0; j < names.length; j++) {
			if (names[j] !== "fn") attributes[attributes.length] = names[j];
		}
		all[i] = attributes;
	}
	ruleAttributeNames = all;
	return all;
}

/**
 * Put `to` where `from` is in an element's attribute list.
 *
 * An attribute a rule removes leaves its mirror to represent it, and the page
 * reads the list back in the order the parser gave it - so the mirror takes
 * the removed attribute's place rather than joining the end.
 */
function replaceAttribute(
	attribs: Record<string, string>,
	from: string,
	to: string,
	value: string
) {
	const keys = Object_keys(attribs);
	const values: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		values[i] = attribs[keys[i]];
		delete attribs[keys[i]];
	}
	for (let i = 0; i < keys.length; i++) {
		if (keys[i] === from) attribs[to] = value;
		else if (keys[i] !== to) attribs[keys[i]] = values[i];
	}
}

export type HtmlContext = {
	// should we inject scramjet scripts at the top of the document?
	loadScripts: boolean;
	// did the document come from the service worker, or from document.write/innerHTML?
	inline: boolean;
	// for worker originating documents, the source URL, otherwise the url of the page that triggered the rewrite
	source: string;
	// for api originating documents, the name of the api that triggered the rewrite
	apisource?: string;
	// response headers for worker originating documents
	headers?: RawHeaders;
	foreignContext?: ForeignContext;
	// XML MIME types use the XML tokenizer and serializer, while sharing the
	// attribute rewriting rules with HTML documents.
	xmlMode?: boolean;
	// `DOMParser`'s HTML parser has scripting disabled, which changes how it
	// treats `noscript` content.
	scriptingEnabled?: boolean;
	/**
	 * document.referrer for the document being rewritten, when it is one the
	 * proxy served. Documents it never saw, like srcdoc, have none.
	 */
	referrer?: string;
};

export class IncrementalHtmlRewriter {
	private readonly builder = new DomBuilder();
	private readonly parser: Parser;
	/** Per child of the root, by index: how much of its output went out. */
	private readonly emittedLengths: NullArray<number> = nullArray();
	/** Per child of the root, by index: its rewrite, once it is complete. */
	private readonly rewrittenNodes: NullArray<string> = nullArray();
	private ended = false;

	constructor(
		private readonly context: ScramjetContext,
		private readonly meta: URLMeta,
		private readonly htmlcontext: HtmlContext
	) {
		this.parser = new Parser(this.builder, {
			startingForeignContext: htmlcontext.foreignContext,
			xmlMode: htmlcontext.xmlMode,
		});
	}

	write(html: string) {
		if (this.ended) {
			throw new Error("IncrementalHtmlRewriter stream already ended");
		}

		this.parser.write(html);

		return this.flush();
	}

	end(html = "") {
		if (this.ended) {
			return "";
		}

		if (html) {
			this.parser.write(html);
		}

		this.parser.end();
		this.ended = true;

		return this.flush();
	}

	private flush() {
		const { children } = this.builder.root;
		let output = "";

		for (let index = 0; index < children.length; index++) {
			const rewritten = this.getAvailableOutput(children, index);
			if (rewritten === null) {
				break;
			}

			const emittedLength = this.emittedLengths[index] ?? 0;
			if (rewritten.length > emittedLength) {
				output += String_slice(rewritten, emittedLength);
				this.emittedLengths[index] = rewritten.length;
			}
		}

		return output;
	}

	private getAvailableOutput(children: NullArray<ChildNode>, index: number) {
		const node = children[index];
		if (node.type !== ElementType.Tag) {
			return render(node);
		}

		// Only the last child of the root can still be open: anything after it
		// was added once the parser was back at the top level.
		if (index === children.length - 1 && this.builder.openElements > 0) {
			return null;
		}

		let rewritten = this.rewrittenNodes[index];
		if (rewritten === undefined) {
			rewritten = rewriteHtmlInner(
				node,
				this.context,
				this.meta,
				this.htmlcontext
			);
			this.rewrittenNodes[index] = rewritten;
		}

		return rewritten;
	}
}

/** Elements whose text the rewrite changes, and so has to see whole. */
const REWRITTEN_TEXT = ["script", "style"];

/**
 * A document rewritten as it arrives, so the browser can parse, fetch and
 * paint the start of a page while the rest is still on the wire.
 *
 * The output is the document's own source, byte for byte, with three kinds of
 * change spliced in: a start tag the rewrite changed the attributes of is
 * written out again; a script or style is held until it closes and its text
 * replaced; and the inject scripts go in after `<head>`, or ahead of whatever
 * comes first instead of it. Everything else - text, comments, the doctype,
 * whitespace, tags the parser only implied - is left for the browser to
 * parse as the page wrote it.
 *
 * Each element goes through the same {@link traverseParsedHtml} a whole
 * document's do, one at a time, so a `<base>` is adopted where it appears and
 * applies to what follows, as it does in the browser.
 *
 * Not for a context with HTML rewriter hooks, which are handed the whole
 * parsed document: see {@link htmlRewriterHooked}.
 */
export class StreamingHtmlRewriter {
	private readonly parser: Parser;
	/** the source from `base` on that has not been written out yet */
	private source = "";
	private base = 0;
	/** how far the source has been accounted for */
	private cursor = 0;
	/** how far the parser's events reach */
	private covered = 0;
	private out = "";
	private injected = false;
	private held: { element: Element; start: number; end: number } | null = null;

	constructor(
		private readonly context: ScramjetContext,
		private readonly meta: URLMeta,
		private readonly htmlcontext: HtmlContext
	) {
		this.parser = new Parser(this, {
			scriptingEnabled: htmlcontext.scriptingEnabled,
		});
	}

	write(chunk: string): string {
		this.source += chunk;
		this.parser.write(chunk);

		return this.flush();
	}

	end(): string {
		this.parser.end();
		this.covered = this.base + this.source.length;
		if (!this.injected) this.copyTo(this.covered);
		this.inject();

		return this.flush();
	}

	private slice(from: number, to: number) {
		return String_slice(this.source, from - this.base, to - this.base);
	}

	/** write out the source up to `to` unchanged */
	private copyTo(to: number) {
		if (to > this.cursor) {
			this.out += this.slice(this.cursor, to);
			this.cursor = to;
		}
	}

	private flush(): string {
		if (!this.held) this.copyTo(this.covered);
		// drop what has been written out
		this.source = String_slice(this.source, this.cursor - this.base);
		this.base = this.cursor;
		const out = this.out;
		this.out = "";

		return out;
	}

	private inject() {
		if (this.injected) return;
		this.injected = true;
		if (!this.htmlcontext.loadScripts) return;
		const script = (src: string) =>
			new Element("script", { src, "scramjet-injected": "true" });
		const scripts = this.context.interface.getInjectScripts(
			this.meta,
			// nothing reads the root; there is none yet to give
			null as unknown as Document,
			this.htmlcontext,
			script
		);
		for (let i = 0; i < scripts.length; i++) this.out += render(scripts[i]);
	}

	// parser events

	onopentag(name: string, attribs: Record<string, string>, implied: boolean) {
		// an implied tag has no source; the browser implies it too
		if (implied) return;
		// a script or style in SVG is a container: one with an element in it
		// keeps its text as it was, and its start tag is rewritten now
		if (this.held) this.release();
		const start = this.parser.startIndex;
		const end = this.parser.endIndex + 1;

		if (!this.injected && name !== "html") {
			// the scripts go first in the head, or ahead of anything that
			// would open one - never ahead of the doctype, which would make
			// the document quirky
			if (name === "head") {
				this.copyTo(end);
				this.inject();
				this.covered = end;
				return;
			}
			this.copyTo(start);
			this.inject();
		}

		const element = new Element(name, attribs);
		if (Array_indexOf(REWRITTEN_TEXT, name) !== -1) {
			this.copyTo(start);
			this.held = { element, start, end };
			return;
		}

		const before = attributeList(element);
		traverseParsedHtml(element, this.context, this.meta);
		if (attributeList(element) !== before) {
			this.copyTo(start);
			this.out += renderStartTag(element, this.slice(end - 2, end) === "/>");
			this.cursor = end;
		}
		this.covered = end;
	}

	onclosetag(name: string, implied: boolean) {
		const held = this.held;
		if (held && held.element.name === name) {
			this.held = null;
			// the end tag, or what implied it, starts where the text stopped
			const textEnd = this.parser.startIndex;
			const text = this.slice(held.end, textEnd);
			const element = new Element(
				name,
				held.element.attribs,
				text ? [new Text(text)] : []
			);
			traverseParsedHtml(element, this.context, this.meta);
			const child = element.children[0];
			this.out +=
				renderStartTag(element, this.slice(held.end - 2, held.end) === "/>") +
				(child && "data" in child ? child.data : "");
			this.cursor = textEnd;
			if (implied) return;
		}
		if (!implied) this.covered = this.parser.endIndex + 1;
	}

	private release() {
		const held = this.held!;
		this.held = null;
		traverseParsedHtml(held.element, this.context, this.meta);
		this.out += renderStartTag(
			held.element,
			this.slice(held.end - 2, held.end) === "/>"
		);
		this.cursor = held.end;
	}

	ontext(data: string) {
		if (!this.held && !this.injected && !isParserWhitespace(data)) {
			this.copyTo(this.parser.startIndex);
			this.inject();
		}
		this.covered = this.parser.endIndex + 1;
	}

	oncomment() {
		this.covered = this.parser.endIndex + 1;
	}

	onprocessinginstruction() {
		this.covered = this.parser.endIndex + 1;
	}

	oncdataend() {
		this.covered = this.parser.endIndex + 1;
	}
}

/** an element's attributes, as something to compare */
function attributeList(element: Element) {
	const keys = Object_keys(element.attribs);
	let list = "";
	for (let i = 0; i < keys.length; i++)
		list += keys[i] + "\0" + element.attribs[keys[i]] + "\0";

	return list;
}

/**
 * Whether HTML rewriter hooks are tapped. They are handed the parsed
 * document and the markup it came from, so a context with any gets the
 * whole-document rewrite.
 */
export function htmlRewriterHooked(context: ScramjetContext): boolean {
	const hooks = context.hooks?.rewriter.html as any;
	const tapped = (hook: any) => hook?.tap.callbacks[hook.key]?.length > 0;

	return !!hooks && (tapped(hooks.pre) || tapped(hooks.post));
}

/** ASCII whitespace, which the parser skips ahead of the doctype. */
function isParserWhitespace(data: string): boolean {
	for (let i = 0; i < data.length; i++) {
		const c = data[i];
		if (c !== " " && c !== "\t" && c !== "\n" && c !== "\f" && c !== "\r") {
			return false;
		}
	}

	return true;
}

function rewriteHtmlInner(
	html: string | ChildNode,
	context: ScramjetContext,
	meta: URLMeta,
	htmlcontext: HtmlContext
) {
	if (typeof html !== "string") {
		html = render(html);
	}

	const root = parseDocument(html, {
		startingForeignContext: htmlcontext.foreignContext,
		xmlMode: htmlcontext.xmlMode,
		scriptingEnabled: htmlcontext.scriptingEnabled,
	});

	Tap.dispatch(
		context.hooks!.rewriter.html.pre,
		{
			root,
			meta,
			htmlcontext,
			origHtml: html,
		},
		undefined
	);
	traverseParsedHtml(root, context, meta);

	let htmlRoot: Element | undefined;
	let headElement: Element | undefined;
	let bodyElement: Element | undefined;

	function detectQuirks() {
		for (let index = 0; index < root.children.length; index++) {
			const child = root.children[index];
			if (
				child.type === ElementType.Directive ||
				child.type === ElementType.Comment ||
				child.type === ElementType.Text
			) {
				continue;
			}

			if (child.type === ElementType.Tag && child.name === "html") {
				htmlRoot = child;
			} else {
				// there's a child of the root that isn't an html element or a doctype/comment/text
				return true;
			}
		}

		if (!htmlRoot) return true; // no html tag or it's somewhere else other than first child

		for (let index = 0; index < htmlRoot.children.length; index++) {
			const child = htmlRoot.children[index];
			if (
				child.type === ElementType.Directive ||
				child.type === ElementType.Comment ||
				child.type === ElementType.Text
			) {
				continue;
			}

			if (child.type === ElementType.Tag && child.name === "head") {
				if (bodyElement) {
					// head comes after body
					return true;
				}
				headElement = child;
			} else if (child.type === ElementType.Tag && child.name === "body") {
				bodyElement = child;
			} else {
				// there's a child of html that isn't head or body
				// fine if head already exists, bad if it doesn't
				if (!headElement) {
					return true;
				}
			}

			return false;
		}
	}

	const isQuirky = detectQuirks();

	if (htmlcontext.loadScripts) {
		const script = (src: string) =>
			new Element("script", { src, "scramjet-injected": "true" });
		const injectScripts = context.interface.getInjectScripts(
			meta,
			root,
			htmlcontext,
			script
		);

		if (isQuirky) {
			dbg.warn(
				`detected quirky document structure parsing @ ${meta.origin.href}!`
			);
			// Weird document structure could get page scripts loaded before our
			// inject scripts, so they go as early as possible -- but AFTER the
			// doctype.
			//
			// "Position 0" put them in front of it, and that is what made the
			// document quirky. In the "initial" insertion mode a DOCTYPE token
			// is consumed normally, but a start tag falls to "Anything else",
			// which sets the Document to quirks mode before reprocessing it
			// (HTML Standard 13.2.6.4.1). A <script> ahead of the DOCTYPE
			// therefore guarantees BackCompat, and the detector caused the
			// condition it is named for -- taking compatMode and every layout
			// metric derived from it (clientHeight, scrollHeight) with it.
			//
			// A comment token in that mode is just inserted and the mode does
			// not change, so leading comments are legal ahead of the doctype and
			// are skipped too. The scripts land at the first position that is
			// still ahead of anything the page can run.
			let at = 0;
			while (at < root.children.length) {
				const node = root.children[at];
				if (
					node.type === ElementType.Directive ||
					node.type === ElementType.Comment ||
					// whitespace ahead of the doctype is dropped by the parser,
					// and a template engine's leading newline is everywhere
					(node.type === ElementType.Text && isParserWhitespace(node.data))
				) {
					at++;
					continue;
				}
				break;
			}
			root.insertAt(at, injectScripts);
		} else {
			if (!headElement) {
				headElement = new Element("head", {});
				htmlRoot.prepend([headElement]);
			}

			headElement.prepend(injectScripts);
		}
	}

	const props: typeof context.hooks.rewriter.html.post.props = {};
	Tap.dispatch(
		context.hooks!.rewriter.html.post,
		{
			root,
			meta,
			htmlcontext,
			origHtml: html,
		},
		props
	);

	if (props.setRawHtml !== undefined) {
		return props.setRawHtml;
	}

	return render(root, htmlcontext.xmlMode);
}

let triggers: RegExp | undefined;

/**
 * Whether a fragment could hold anything {@link rewriteHtml} changes: an
 * attribute some rule or event handler rewrites, or a script or style.
 *
 * Read off the raw markup, not a parse of it. Tag and attribute names cannot be
 * escaped, so an attribute the browser's parser would find is spelled out in
 * the source, after whitespace, a `/` or a closing quote, and before
 * whitespace, `/`, `>`, `=` or the end. Anything that looks like one counts;
 * finding none means the browser can be handed the page's own string.
 *
 * Only for a fragment parsed whole - a `document.write` split mid-tag hides
 * the name from any one chunk - and only with no HTML rewriter hooks, which
 * see every rewrite.
 */
export function fragmentNeedsRewrite(
	html: string,
	context: ScramjetContext
): boolean {
	if (htmlRewriterHooked(context)) return true;

	if (!triggers) {
		// built on first use, which can be after the page has run, so from
		// snapshotted intrinsics only. Attribute names are letters, digits,
		// `-` and `:`, none of which needs escaping
		let names = "";
		const add = (name: string) => {
			names += (names ? "|" : "") + name;
		};
		const rules = getRuleAttributeNames();
		for (let i = 0; i < rules.length; i++)
			for (let j = 0; j < rules[i].length; j++) add(rules[i][j]);
		for (let i = 0; i < eventAttributes.length; i++) add(eventAttributes[i]);
		triggers = new _RegExp(
			`(?:^|[\\s/"'])(?:${names})(?=[\\s/>=]|$)|<(?:script|style)(?=[\\s/>]|$)`,
			"i"
		);
	}

	return RegExp_exec(triggers!, html) !== null;
}

export function rewriteHtml(
	html: string,
	context: ScramjetContext,
	meta: URLMeta,
	htmlcontext: HtmlContext
) {
	const before = Performance_now();
	const ret = rewriteHtmlInner(html, context, meta, htmlcontext);
	if (flagEnabled("rewriterLogs", context)) {
		dbg.time(meta, before, "html rewrite");
	}

	return ret;
}

/**
 * Undo {@link rewriteHtml} over a serialization.
 *
 * `context` is what lets a style element's text be un-rewritten; without it the
 * markup comes back with the rewritten stylesheet still in it, which is a
 * difference the page can see in `innerHTML`. Every client call passes one.
 */
// everything unrewriteHtml undoes: an attribute scramjet added, or a style
// element's text
const UNREWRITE_TRIGGERS = new _RegExp("scramjet-|<style", "i");

export function unrewriteHtml(
	html: string,
	foreignContext?: ForeignContext,
	context?: ScramjetContext
) {
	// none of it there: the serialization is the page's already, and the
	// browser's own is a closer one than a reparse rendered back out
	if (RegExp_exec(UNREWRITE_TRIGGERS, html) === null) return html;

	const root = parseDocument(html, {
		startingForeignContext: foreignContext,
	});

	function traverse(node: AnyNode) {
		if (node.type === ElementType.Tag) {
			const { attribs } = node;
			const keys = Object_keys(attribs);
			for (let index = 0; index < keys.length; index++) {
				const key = keys[index];
				const lower = String_toLowerCase(key);
				if (lower === SCRIPT_SOURCE_ATTRIBUTE) {
					const child = node.children[0];
					if (child && "data" in child) child.data = base64Decode(attribs[key]);
					delete attribs[key];
					continue;
				}

				// The marker put on a script the rewriter injected. It is not a
				// mirror, so the prefix branch below never sees it: it does not
				// start with `scramjet-attr-`. No browser has an attribute by
				// that name and nothing outside scramjet should read it, but it
				// survived into the serialised output, where anything
				// fingerprinting an element by its attribute names can see it.
				if (lower === "scramjet-injected" && node.name === "script") {
					delete attribs[key];
					continue;
				}

				if (String_startsWith(lower, "scramjet-attr-")) {
					attribs[String_slice(key, "scramjet-attr-".length)] = attribs[key];
					delete attribs[key];
				}
			}

			// a style element has no mirror to restore from - the stylesheet is
			// recovered by running the rewrite backwards
			const child = node.children[0];
			if (
				context &&
				node.name === "style" &&
				child !== undefined &&
				"data" in child
			) {
				child.data = unrewriteCss(child.data, context);
			}
		}

		if ("children" in node) {
			for (let index = 0; index < node.children.length; index++) {
				traverse(node.children[index]);
			}
		}
	}

	traverse(root);

	return render(root);
}

/**
 * The metas whose base URL a base element has already set.
 *
 * https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url -
 * only the *first* base element with an href sets it; any later one is
 * ignored.
 */
const basedMetas = new _WeakSet<URLMeta>();

/**
 * https://html.spec.whatwg.org/multipage/semantics.html#set-the-frozen-base-url -
 * the href parsed against the document's fallback base URL, which one the
 * browser ignores leaves in place (see `frozenBaseUrl`).
 *
 * Only a meta whose `base` is a plain value adopts it: that is the service
 * worker's, describing the whole document being parsed. The client's is a
 * getter reading the live document, which is where the base element is going
 * - so it already answers for it once it lands, and has no setter to call.
 */
function adoptBaseElement(href: string, meta: URLMeta) {
	if (basedMetas.has(meta)) return;

	const desc = Object_getOwnPropertyDescriptor(meta, "base");
	if (!desc || !desc.writable) return;

	// one the browser ignores still counts as the first, and the ones after
	// it are ignored all the same
	basedMetas.add(meta);

	const base = frozenBaseUrl(href, meta.origin);
	if (base) meta.base = base;
}

function traverseParsedHtml(
	node: AnyNode,
	context: ScramjetContext,
	meta: URLMeta
): AnyNode {
	if (node.type !== ElementType.Tag) {
		if ("children" in node) traverseChildren(node, context, meta);

		return node;
	}

	const { attribs } = node;
	const ruleAttributeNames = getRuleAttributeNames();

	if (node.name === "base" && attribs.href !== undefined) {
		adoptBaseElement(attribs.href, meta);
	}

	for (let ruleIndex = 0; ruleIndex < htmlRules.length; ruleIndex++) {
		const rule = htmlRules[ruleIndex];
		const ruleKeys = ruleAttributeNames[ruleIndex];
		for (let keyIndex = 0; keyIndex < ruleKeys.length; keyIndex++) {
			const attr = ruleKeys[keyIndex];
			// Most elements do not carry any attribute a given rule handles.
			if (attribs[attr] === undefined) continue;
			const sel = rule[attr];
			if (typeof sel === "function") continue;

			if (sel === "*" || Array_indexOf(sel, node.name) !== -1) {
				const value = attribs[attr];
				const v = rule.fn(
					value,
					context,
					meta,
					(name) => attribs[name] || null
				);

				if (v === null) {
					replaceAttribute(attribs, attr, mirrorName(attr), value);
				} else {
					attribs[attr] = v;
					attribs[mirrorName(attr)] = value;
				}
			}
		}
	}
	const attrKeys = Object_keys(attribs);
	for (let index = 0; index < attrKeys.length; index++) {
		const attr = attrKeys[index];
		if (
			attr[0] === "o" &&
			attr[1] === "n" &&
			Array_indexOf(eventAttributes, attr) !== -1
		) {
			const value = attribs[attr];
			attribs[mirrorName(attr)] = value;
			attribs[attr] = rewriteJs(
				value,
				`(inline ${attr} on element)`,
				context,
				meta,
				false,
				undefined,
				eventHandlerPrelude(context, node.name, attr)
			) as string;
		}
	}

	const text = node.children[0];
	const hasText = text !== undefined && text.type === ElementType.Text;

	if (node.name === "style" && hasText)
		text.data = rewriteCss(text.data, context, meta);

	if (
		node.name === "script" &&
		attribs.type !== undefined &&
		String_toLowerCase(attribs.type) === "importmap" &&
		hasText
	) {
		// the page reads its own map back, and the client resolves `import()`
		// against it - both from the source, not the rewritten map
		attribs[SCRIPT_SOURCE_ATTRIBUTE] = bytesToBase64(
			TextEncoder_encode(text.data)
		);
		try {
			text.data = rewriteImportMap(text.data, context, meta);
		} catch (e) {
			dbg.error("Failed to parse importmap JSON:", e);
		}
	}
	if (node.name === "script" && hasText) {
		const scriptBlockType = getScriptBlockTypeString(
			"type" in attribs ? attribs.type : undefined,
			"language" in attribs ? attribs.language : undefined,
			"type" in attribs,
			"language" in attribs
		);
		if (isScriptType(scriptBlockType)) {
			let js = text.data;
			const module = isModuleScriptType(scriptBlockType);
			attribs[SCRIPT_SOURCE_ATTRIBUTE] = bytesToBase64(TextEncoder_encode(js));
			const htmlcomment = /<!--[\s\S]*?-->/g;
			js = js.replace(htmlcomment, "");
			text.data = rewriteJs(
				js,
				"(inline script element)",
				context,
				meta,
				module
			) as string;
		}
	}

	traverseChildren(node, context, meta);

	return node;
}

function traverseChildren(
	node: Document | Element | CDATA,
	context: ScramjetContext,
	meta: URLMeta
) {
	for (let index = 0; index < node.children.length; index++) {
		const child = node.children[index];
		const rewritten = traverseParsedHtml(child, context, meta);
		if (rewritten !== child) node.replaceChild(index, rewritten as ChildNode);
	}
}

/**
 * https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 *
 * A candidate's URL runs to the next whitespace, commas and all - CDN image
 * URLs carry them (`…_SX300,QL70_.jpg 2x`) - and its descriptors run to the
 * next comma outside parentheses. Splitting on commas cut such URLs apart.
 */
export function rewriteSrcset(
	srcset: string,
	context: ScramjetContext,
	meta: URLMeta
) {
	const isSpace = (c: string) =>
		c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
	const out: string[] = [];
	const n = srcset.length;
	let i = 0;
	while (i < n) {
		while (i < n && (isSpace(srcset[i]) || srcset[i] === ",")) i++;
		if (i >= n) break;

		const start = i;
		while (i < n && !isSpace(srcset[i])) i++;
		let url = String_slice(srcset, start, i);
		let descriptors = "";

		if (url[url.length - 1] === ",") {
			// a URL ending in commas has no descriptors, and the commas end it
			let end = url.length;
			while (end > 0 && url[end - 1] === ",") end--;
			url = String_slice(url, 0, end);
		} else {
			const from = i;
			let depth = 0;
			while (i < n) {
				const c = srcset[i];
				if (c === "(") depth++;
				else if (c === ")") depth--;
				else if (c === "," && depth <= 0) break;
				i++;
			}
			descriptors = String_trim(String_slice(srcset, from, i));
			i++;
		}

		const rewritten = rewriteUrl(url, context, meta);
		out[out.length] = descriptors ? rewritten + " " + descriptors : rewritten;
	}

	return out.join(", ");
}

/**
 * The event handler content attributes, which carry javascript rather than a
 * value. Exported because the client's attribute layer has to rewrite the same
 * set when a page writes one through `setAttribute` - a name that is rewritten
 * at parse time and not at run time is a hole, not an optimisation.
 */
/**
 * The window's handlers for the events a listener is handed a stand-in for
 * (see `client/shared/event.ts`): the only content attributes a trusted one
 * of them ever reaches, and only on these elements, which hold the window's
 * handlers.
 */
const standInHandlers = ["onmessage", "onhashchange", "onstorage"];
const windowHandlerElements = ["body", "frameset"];

/**
 * What an event handler content attribute's body runs first, so that its
 * `event` is the same stand-in a listener would have been handed - or
 * nothing at all when a listener would never have seen it.
 *
 * The browser compiles the attribute as a function of `event` and calls it
 * with the real event itself, past every listener wrapper scramjet has. So
 * the stand-in has to be made from inside: `event` is rebound to it before a
 * line of the page's code runs. The function answers itself for an event to
 * drop, since a falsy value is one a handler can be given. Only on the
 * elements where it is `event`: an SVG element's handler calls it `evt`, and
 * an assignment there would replace `window.event`.
 */
export function eventHandlerPrelude(
	context: ScramjetContext,
	element: string,
	attribute: string
): string {
	if (
		Array_indexOf(windowHandlerElements, element) === -1 ||
		Array_indexOf(standInHandlers, attribute) === -1
	) {
		return "";
	}

	const standin = context.config.globals.standinfn;

	return `if((event=${standin}(event))===${standin})return;`;
}

export const eventAttributes = [
	"onbeforexrselect",
	"onabort",
	"onbeforeinput",
	"onbeforematch",
	"onbeforetoggle",
	"onblur",
	"oncancel",
	"oncanplay",
	"oncanplaythrough",
	"onchange",
	"onclick",
	"onclose",
	"oncontentvisibilityautostatechange",
	"oncontextlost",
	"oncontextmenu",
	"oncontextrestored",
	"oncuechange",
	"ondblclick",
	"ondrag",
	"ondragend",
	"ondragenter",
	"ondragleave",
	"ondragover",
	"ondragstart",
	"ondrop",
	"ondurationchange",
	"onemptied",
	"onended",
	"onerror",
	"onfocus",
	"onformdata",
	"oninput",
	"oninvalid",
	"onkeydown",
	"onkeypress",
	"onkeyup",
	"onload",
	"onloadeddata",
	"onloadedmetadata",
	"onloadstart",
	"onmousedown",
	"onmouseenter",
	"onmouseleave",
	"onmousemove",
	"onmouseout",
	"onmouseover",
	"onmouseup",
	"onmousewheel",
	"onpause",
	"onplay",
	"onplaying",
	"onprogress",
	"onratechange",
	"onreset",
	"onresize",
	"onscroll",
	"onsecuritypolicyviolation",
	"onseeked",
	"onseeking",
	"onselect",
	"onslotchange",
	"onstalled",
	"onsubmit",
	"onsuspend",
	"ontimeupdate",
	"ontoggle",
	"onvolumechange",
	"onwaiting",
	"onwebkitanimationend",
	"onwebkitanimationiteration",
	"onwebkitanimationstart",
	"onwebkittransitionend",
	"onwheel",
	"onauxclick",
	"ongotpointercapture",
	"onlostpointercapture",
	"onpointerdown",
	"onpointermove",
	"onpointerrawupdate",
	"onpointerup",
	"onpointercancel",
	"onpointerover",
	"onpointerout",
	"onpointerenter",
	"onpointerleave",
	"onselectstart",
	"onselectionchange",
	"onanimationend",
	"onanimationiteration",
	"onanimationstart",
	"ontransitionrun",
	"ontransitionstart",
	"ontransitionend",
	"ontransitioncancel",
	"oncopy",
	"oncut",
	"onpaste",
	"onscrollend",
	"onscrollsnapchange",
	"onscrollsnapchanging",
	"onanimationcancel",
	"onbeforecopy",
	"onbeforecut",
	"onbeforepaste",
	"oncommand",
	// https://html.spec.whatwg.org/multipage/webappapis.html#windoweventhandlers -
	// on a body or frameset they are the window's handlers, and run like any
	// other
	"onafterprint",
	"onbeforeprint",
	"onbeforeunload",
	"onhashchange",
	"onlanguagechange",
	"onmessage",
	"onmessageerror",
	"onoffline",
	"ononline",
	"onpagehide",
	"onpagereveal",
	"onpageshow",
	"onpageswap",
	"onpopstate",
	"onrejectionhandled",
	"onstorage",
	"onunhandledrejection",
	"onunload",
];
