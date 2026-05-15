import { rewriteCss } from "@rewriters/css";
import { rewriteHtml, rewriteSrcset } from "@rewriters/html";
import { rewriteUrl, unrewriteBlob, URLMeta } from "@rewriters/url";
import { ScramjetContext } from "@/shared";
import { _URL } from "./snapshot";

export type HtmlRuleElement = {
	name: string;
	attribs: Record<string, string>;
};

/**
 * Per Fetch / HTML, `<link rel="preload" as="X">` and (for browsers that
 * implement it) `<link rel="prefetch" as="X">` set the request's destination
 * to `X` for the network request. The SW's `event.request.destination` is
 * `""` for prefetch though, so we capture `as` here and forward it to
 * `rewriteUrl` which encodes it as `sj$dest=…` on the proxy URL — the
 * service-side Sec-Fetch-Dest computation reads that back.
 *
 * The same `<link>` rels also affect the request's credentials mode: with no
 * `crossorigin` attribute they default to "include", which is what gates
 * Sec-Fetch-Storage-Access on cross-site prefetch / preload requests.
 */
const LINK_DESTINATION_RELS = new Set(["prefetch", "preload", "modulepreload"]);

const VALID_REQUEST_DESTINATIONS = new Set<RequestDestination>([
	"audio",
	"audioworklet",
	"document",
	"embed",
	"font",
	"frame",
	"iframe",
	"image",
	"manifest",
	"object",
	"paintworklet",
	"report",
	"script",
	"sharedworker",
	"style",
	"track",
	"video",
	"worker",
	"xslt",
]);

function linkRel(attribs: Record<string, string> | undefined): string | null {
	if (!attribs) return null;
	const rel = (attribs.rel ?? "").trim().toLowerCase();
	return LINK_DESTINATION_RELS.has(rel) ? rel : null;
}

function destFromLinkAttribs(
	attribs: Record<string, string> | undefined
): RequestDestination | undefined {
	if (!linkRel(attribs)) return undefined;
	const as = (attribs!.as ?? "").trim().toLowerCase();
	if (!VALID_REQUEST_DESTINATIONS.has(as as RequestDestination))
		return undefined;
	return as as RequestDestination;
}

function credentialsFromLinkAttribs(
	attribs: Record<string, string> | undefined
): string | undefined {
	if (!linkRel(attribs)) return undefined;
	if (attribs!.crossorigin === undefined) {
		return "include";
	}
	const value = (attribs!.crossorigin ?? "").trim().toLowerCase();
	if (value === "use-credentials") return "include";
	return undefined;
}

export const htmlRules: {
	[key: string]: "*" | string[] | ((...any: any[]) => string | null);
	fn: (
		value: string,
		context: ScramjetContext,
		meta: URLMeta,
		element?: HtmlRuleElement
	) => string | null;
}[] = [
	{
		fn: (value, context, meta, element) => {
			const isLink = element?.name === "link";
			return rewriteUrl(value, context, meta, {
				navigateType: "location",
				destination: isLink ? destFromLinkAttribs(element!.attribs) : undefined,
				credentials: isLink
					? credentialsFromLinkAttribs(element!.attribs)
					: undefined,
			});
		},

		// url rewrites
		src: ["embed", "script", "img", "frame", "input", "track"],
		href: ["a", "link", "area", "image"],
		data: ["object"],
		action: ["form"],
		formaction: ["button", "input", "textarea", "submit"],
		poster: ["video"],
		"xlink:href": ["image"],
	},
	{
		fn: (value, context, meta) => {
			const url = rewriteUrl(value, context, meta, {
				topFrame: meta.topFrameName,
				parentFrame: meta.parentFrameName,
				isIframe: "1",
			});

			return url;
		},
		src: ["iframe"],
	},
	{
		// is this a good idea?
		fn: (_value, _context, _meta) => {
			return null;
		},
		sandbox: ["iframe"],
	},
	{
		fn: (value, context, meta) => {
			if (value.startsWith("blob:")) {
				// for media elements specifically they must take the original blob
				// because they can't be fetch'd
				return unrewriteBlob(value, context, meta);
			}

			return rewriteUrl(value, context, meta);
		},
		src: ["video", "audio", "source"],
	},
	{
		fn: () => "",

		integrity: ["script", "link"],
	},
	{
		fn: () => null,

		// csp stuff that must be deleted
		nonce: "*",
		csp: ["iframe"],
		credentialless: ["iframe"],
	},
	{
		fn: (value, context, meta) => rewriteSrcset(value, context, meta),

		// srcset
		srcset: ["img", "source"],
		imagesrcset: ["link"],
	},
	{
		fn: (value, context, meta) =>
			rewriteHtml(
				value,
				context,
				{
					// for srcdoc origin is the origin of the page that the iframe is on. base and path get dropped
					origin: new _URL(meta.origin.origin),
					base: new _URL(meta.origin.origin),
					topFrameName: meta.topFrameName,
					parentFrameName: meta.parentFrameName,
					referrerPolicy: meta.referrerPolicy,
				},
				{
					loadScripts: true,
					inline: true,
					source: meta.origin.href,
					apisource: "set HTMLIFrameElement.prototype.srcdoc",
				}
			),

		// srcdoc
		srcdoc: ["iframe"],
	},
	{
		fn: (value, context, meta) => rewriteCss(value, context, meta),
		style: "*",
	},
	{
		fn: (value, context, meta) => {
			if (value === "_top" || value === "_unfencedTop")
				return meta.topFrameName;
			else if (value === "_parent") return meta.parentFrameName;
			else return value;
		},
		target: ["a", "base"],
	},
	{
		// svg elements with an href property
		fn: (value, context, meta) => {
			// #id values are not rewritten
			if (value.startsWith("#")) return value;
			return rewriteUrl(value, context, meta);
		},
		href: [
			"use",
			"textPath",
			"mpath",
			"feImage",
			"animate",
			"animateMotion",
			"animateTransform",
			"set",
			"discard",
			"linearGradient",
			"radialGradient",
			"pattern",
			"filter",
		],
	},
];
