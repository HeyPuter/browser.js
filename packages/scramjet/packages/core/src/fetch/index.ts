import {
	BareCompatibleClient,
	BareResponse,
	ProxyTransport,
	RawHeaders,
	TransferrableResponse,
	BareRequestInit,
} from "@mercuryworkshop/proxy-transports";

import {
	rewriteUrl,
	unrewriteBlob,
	unrewriteUrl,
	type URLMeta,
} from "@rewriters/url";
import { rewriteJs } from "@rewriters/js";
import { ScramjetHeaders } from "@/shared/headers";
import { flagEnabled, HtmlRewriterHooks, ScramjetContext } from "@/shared";
import { rewriteHtml } from "@rewriters/html";
import { rewriteCss } from "@rewriters/css";
import { rewriteWorkers } from "@rewriters/worker";
import { ScramjetConfig } from "@/types";
import DomHandler from "domhandler";
import { Tap, TapInstance } from "@/Tap";
import { sniffEncoding } from "@/shared/sniffEncoding";
import { isHtmlMimeType, isJavascriptMimeType } from "@/shared/mime";
import { generateClientId } from "@/shared/util";

export interface ScramjetFetchRequest {
	rawUrl: URL;
	rawReferrer: string | null;
	rawReferrerPolicy: string | null;
	destination: RequestDestination;
	mode: RequestMode;
	referrer: string;
	method: string;
	body: BodyType | null;
	cache: RequestCache;

	initialHeaders: ScramjetHeaders;

	rawClientUrl?: URL;
}

export interface ScramjetFetchParsed {
	url: URL;
	clientUrl?: URL;

	meta: URLMeta;
	scriptType: "module" | "regular";
	referrerPolicy?: string;
}

export interface ScramjetFetchResponse {
	body: BodyType;
	headers: ScramjetHeaders;
	status: number;
	statusText: string;
}

export type FetchHandlerInit = {
	transport: ProxyTransport;
	context: ScramjetContext;
	crossOriginIsolated?: boolean;

	sendSetCookie: (url: URL, cookie: string) => Promise<void>;
	fetchDataUrl(dataUrl: string): Promise<BareResponse>;
	fetchBlobUrl(blobUrl: string): Promise<BareResponse>;
};

export class ScramjetFetchHandler extends EventTarget {
	public client: BareCompatibleClient;
	public crossOriginIsolated: boolean = false;
	public context: ScramjetContext;

	public hooks: {
		rewriter: {
			html: TapInstance<HtmlRewriterHooks>;
		};
		fetch: TapInstance<FetchHooks>;
	};

	public fetchDataUrl: (dataUrl: string) => Promise<Response>;
	public fetchBlobUrl: (blobUrl: string) => Promise<Response>;
	public sendSetCookie: (url: URL, cookie: string) => Promise<void>;

	constructor(init: FetchHandlerInit) {
		super();
		this.client = new BareCompatibleClient(init.transport);
		this.context = init.context;
		this.crossOriginIsolated = init.crossOriginIsolated || false;
		this.sendSetCookie = init.sendSetCookie;
		this.fetchDataUrl = init.fetchDataUrl;
		this.fetchBlobUrl = init.fetchBlobUrl;
		this.hooks = {
			rewriter: {
				html: Tap.create<HtmlRewriterHooks>(),
			},
			fetch: Tap.create<FetchHooks>(),
		};
		this.context.hooks = {
			rewriter: this.hooks.rewriter,
		};
	}

	async handleFetch(
		request: ScramjetFetchRequest
	): Promise<ScramjetFetchResponse> {
		return doHandleFetch(this, request);
	}
}

function normalizeContentType(
	request: ScramjetFetchRequest,
	headers: ScramjetHeaders
) {
	if (request.destination !== "document" && request.destination !== "iframe")
		return;

	const ct = headers.get("content-type");
	if (!ct) return;
	if (!isHtmlMimeType(ct)) return;

	headers.set("content-type", "text/html; charset=utf-8");
}
async function doHandleFetch(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest
): Promise<ScramjetFetchResponse> {
	const parsed = parseRequest(request, handler);

	if (
		request.rawUrl.pathname.startsWith(
			`${handler.context.prefix.pathname}blob:`
		) ||
		request.rawUrl.pathname.startsWith(
			`${handler.context.prefix.pathname}data:`
		)
	) {
		return handleBlobOrDataUrlFetch(handler, request, parsed);
	}

	const newheaders = rewriteRequestHeaders(request, handler, parsed);

	const init = {
		body: request.body,
		headers: newheaders.toRawHeaders(),
		method: request.method,
		redirect: "manual",
	} as BareRequestInit;

	let reqcontext: typeof handler.hooks.fetch.request.context = {
		client: handler.client,
		request,
		parsed,
	};
	let reqprops: typeof handler.hooks.fetch.request.props = {
		init,
		url: parsed.url,
	};
	await Tap.dispatch(handler.hooks.fetch.request, reqcontext, reqprops);
	let earlyResponse: BareResponse;

	if (reqprops.earlyResponse) {
		let resp = reqprops.earlyResponse;
		if ("rawHeaders" in resp) {
			// it's a bare response
			earlyResponse = resp;
		} else {
			// it's a native response, convert it
			earlyResponse = BareResponse.fromNativeResponse(resp);
		}
	} else {
		earlyResponse = await handler.client.fetch(reqprops.url, reqprops.init);
	}

	let prerespcontext: typeof handler.hooks.fetch.preresponse.context = {
		request,
		parsed,
	};

	let prerespprops: typeof handler.hooks.fetch.preresponse.props = {
		response: earlyResponse,
	};

	await Tap.dispatch(
		handler.hooks.fetch.preresponse,
		prerespcontext,
		prerespprops
	);
	let response = prerespprops.response;

	let responseBody: BodyType;

	// set-cookie needs to take the raw headers. after this, we can flatten the headers into a ScramjetHeaders object
	await handleCookies(handler, request, parsed, response.rawHeaders);

	const responseHeaders = await rewriteResponseHeaders(
		handler,
		request,
		parsed,
		response.rawHeaders
	);

	if (isRedirect(response)) {
		const redirectUrl = new URL(
			unrewriteUrl(responseHeaders.get("location"), handler.context)
		);

		// ensure that ?type=module is not lost in a redirect
		if (parsed.scriptType === "module") {
			const url = new URL(responseHeaders.get("location"));
			url.searchParams.set("type", parsed.scriptType);
			responseHeaders.set("location", url.href);
		}
	}

	if (response.body && !isRedirect(response)) {
		responseBody = await rewriteBody(handler, request, parsed, response);

		// After rewriting HTML, the body is a JS string which will be encoded as
		// UTF-8 by the Response constructor. Normalize the Content-Type charset so
		// the browser doesn't try to decode UTF-8 bytes with the original encoding.
		normalizeContentType(request, responseHeaders);
	}

	let respcontext: typeof handler.hooks.fetch.response.context = {
		request,
		parsed,
	};
	let respprops: typeof handler.hooks.fetch.response.props = {
		response: {
			body: responseBody,
			headers: responseHeaders,
			status: response.status,
			statusText: response.statusText,
		},
	};

	await Tap.dispatch(handler.hooks.fetch.response, respcontext, respprops);

	return respprops.response;
}

function isRedirect(response: BareResponse) {
	return response.status >= 300 && response.status < 400;
}

export function parseRequest(
	request: ScramjetFetchRequest,
	handler: ScramjetFetchHandler
): ScramjetFetchParsed {
	const strippedUrl = new URL(request.rawUrl.href);
	const extraParams: Record<string, string> = {};

	let scriptType: "module" | "regular" = "regular";
	let topFrameName: string | undefined;
	let parentFrameName: string | undefined;
	let clientId: string | undefined;
	let referrerPolicy: string | undefined;
	for (const [param, value] of [...request.rawUrl.searchParams.entries()]) {
		switch (param) {
			case "type":
				if (value === "module") scriptType = value;
				break;
			case "dest":
				break;
			case "topFrame":
				topFrameName = value;
				break;
			case "parentFrame":
				parentFrameName = value;
				break;
			case "cid":
				clientId = value;
				break;
			case "referrerPolicy":
				referrerPolicy = value;
				break;
			default:
				dbg.warn(
					`${request.rawUrl.href} extraneous query parameter ${param}. Assuming <form> element`
				);
				extraParams[param] = value;
				break;
		}

		strippedUrl.searchParams.delete(param);
	}

	if (!URL.canParse(unrewriteUrl(strippedUrl, handler.context))) {
		throw new Error(`unable to parse rewritten url: ${strippedUrl.href}`);
	}
	const url = new URL(unrewriteUrl(strippedUrl, handler.context));

	if (url.origin === new URL(request.rawUrl).origin) {
		// uh oh!
		throw new Error(
			"attempted to fetch from same origin - this means the site has obtained a reference to the real origin, aborting"
		);
	}

	// now that we're past unrewriting it's safe to add back the params
	for (const [param, value] of Object.entries(extraParams)) {
		url.searchParams.set(param, value);
	}

	let documentFetch =
		request.destination === "document" || request.destination === "iframe";
	if (documentFetch || !clientId) {
		if (
			!documentFetch &&
			(url.protocol === "https:" || url.protocol === "http:")
		) {
			console.error(
				`no clientId provided for non-document/iframe fetch: ${request.rawUrl.href}`
			);
		}

		clientId = generateClientId();
	}

	// TODO: figure out what origin and base actually mean
	const meta: URLMeta = {
		origin: url,
		base: url,
		topFrameName,
		parentFrameName,
		clientId,
	};

	const parsed: ScramjetFetchParsed = {
		meta,
		url,
		scriptType,
		referrerPolicy,
	};

	if (request.rawClientUrl) {
		// TODO: probably need to make a meta for it
		parsed.clientUrl = new URL(
			unrewriteUrl(request.rawClientUrl, handler.context)
		);
	}

	return parsed;
}

function createReferrerString(
	clientUrl: URL,
	resource: URL,
	policy: string | null
): string {
	policy ||= "strict-origin-when-cross-origin";
	const originIsHttps = clientUrl.protocol === "https:";
	const destIsHttps = resource.protocol === "https:";

	// A "more private" request: https -> http
	const isPotentialDowngrade = originIsHttps && !destIsHttps;

	// Step 3: Determine if same-origin
	const isSameOrigin =
		clientUrl.protocol === resource.protocol &&
		clientUrl.host === resource.host;

	// Step 4: Strip referrer to just origin (scheme + host + port)
	const referrerOrigin = clientUrl.origin; // e.g. "https://example.com"

	const referrerUrl = new URL(clientUrl.href);
	referrerUrl.hash = "";
	const referrerUrlString = referrerUrl.href;

	switch (policy) {
		case "no-referrer":
			return "";

		case "no-referrer-when-downgrade":
			if (isPotentialDowngrade) return "";
			return referrerUrlString;

		case "same-origin":
			if (isSameOrigin) return referrerUrlString;
			return "";

		case "origin":
			return referrerOrigin === "null" ? "" : referrerOrigin + "/";

		case "strict-origin":
			if (isPotentialDowngrade) return "";
			return referrerOrigin === "null" ? "" : referrerOrigin + "/";

		case "origin-when-cross-origin":
			if (isSameOrigin) return referrerUrlString;
			return referrerOrigin === "null" ? "" : referrerOrigin + "/";

		case "strict-origin-when-cross-origin":
			if (isSameOrigin) return referrerUrlString;
			if (isPotentialDowngrade) return "";
			return referrerOrigin === "null" ? "" : referrerOrigin + "/";

		case "unsafe-url":
			return referrerUrlString;

		default:
			return "";
	}
}

function rewriteRequestHeaders(
	request: ScramjetFetchRequest,
	handler: ScramjetFetchHandler,
	parsed: ScramjetFetchParsed
): ScramjetHeaders {
	const headers = request.initialHeaders.clone();

	if (request.rawReferrer) {
		const clientUrl = request.rawClientUrl || new URL(request.rawReferrer);
		if (clientUrl.pathname.startsWith(handler.context.prefix.pathname)) {
			let unrewritten = new URL(unrewriteUrl(clientUrl, handler.context));

			const referer = createReferrerString(
				unrewritten,
				parsed.url,
				request.rawReferrerPolicy
			);
			if (referer) headers.set("Referer", referer);
		}
	}

	const cookies = handler.context.cookieJar.getCookies(parsed.url, false);

	if (cookies.length) {
		headers.set("Cookie", cookies);
	}

	return headers;
}

async function handleBlobOrDataUrlFetch(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed
): Promise<ScramjetFetchResponse> {
	let dataUrl = request.rawUrl.pathname.substring(
		handler.context.prefix.pathname.length
	);
	let response: BareResponse;

	if (dataUrl.startsWith("blob:")) {
		dataUrl = unrewriteBlob(dataUrl, handler.context, parsed.meta);
		response = BareResponse.fromNativeResponse(
			await handler.fetchBlobUrl(dataUrl)
		);
	} else {
		response = BareResponse.fromNativeResponse(
			await handler.fetchDataUrl(dataUrl)
		);
	}

	let body: BodyType;
	if (response.body) {
		body = await rewriteBody(
			handler,
			request,
			parsed,
			response as BareResponse
		);
	}
	const headers = ScramjetHeaders.fromRawHeaders(response.rawHeaders);

	// blob urls actually *can* set charsets, so we need to normalize them if it goes down the html path
	normalizeContentType(request, headers);

	if (handler.crossOriginIsolated) {
		headers.set("Cross-Origin-Opener-Policy", "same-origin");
		headers.set("Cross-Origin-Embedder-Policy", "require-corp");
	}

	return {
		body,
		status: response.status,
		statusText: response.statusText,
		headers: headers,
	};
}

async function handleCookies(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	rawHeaders: RawHeaders
) {
	for (const [key, value] of rawHeaders) {
		if (key.toLowerCase() !== "set-cookie") continue;

		handler.context.cookieJar.setCookies([value], parsed.url);
		const promise = handler.sendSetCookie(parsed.url, value);

		// we want the client to have the cookies before fetch returns
		// for navigations though, there's no race since we send the entire cookie dump in the same request
		if (
			request.destination !== "document" &&
			request.destination !== "iframe"
		) {
			await promise;
		}
	}
}

/**
 * Headers for security policy features that haven't been emulated yet
 */
const SEC_HEADERS = new Set([
	"cross-origin-embedder-policy",
	"cross-origin-opener-policy",
	"cross-origin-resource-policy",
	"content-security-policy",
	"content-security-policy-report-only",
	"expect-ct",
	"feature-policy",
	"origin-isolation",
	"strict-transport-security",
	"upgrade-insecure-requests",
	"x-content-type-options",
	"x-download-options",
	"x-frame-options",
	"x-permitted-cross-domain-policies",
	"x-powered-by",
	"x-xss-protection",
	// This needs to be emulated, but for right now it isn't that important of a feature to be worried about
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data
	"clear-site-data",
]);

/**
 * Headers that are actually URLs that need to be rewritten
 */
const URL_HEADERS = new Set(["location", "content-location", "referer"]);

function rewriteLinkHeader(
	link: string,
	context: ScramjetContext,
	meta: URLMeta
) {
	return link.replace(/<([^>]+)>/gi, (_match, p1) => {
		return `<${rewriteUrl(p1, context, meta)}>`;
	});
}

export async function rewriteResponseHeaders(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	rawHeaders: RawHeaders
): Promise<ScramjetHeaders> {
	const headers = ScramjetHeaders.fromRawHeaders(rawHeaders);

	for (const cspHeader of SEC_HEADERS) {
		headers.delete(cspHeader);
	}

	for (const urlHeader of URL_HEADERS) {
		if (headers.has(urlHeader)) {
			let url = headers.get(urlHeader)!;
			let rewrittenUrl = rewriteUrl(url, handler.context, parsed.meta);
			headers.set(urlHeader, rewrittenUrl);
		}
	}

	if (headers.has("link")) {
		let link = headers.get("link")!;
		let rewritten = rewriteLinkHeader(link, handler.context, parsed.meta);
		headers.set("link", rewritten);
	}

	if (headers.get("accept") === "text/event-stream") {
		headers.set("content-type", "text/event-stream");
	}

	// scramjet runtime can use features that permissions-policy blocks
	headers.delete("permissions-policy");

	if (
		handler.crossOriginIsolated &&
		[
			"document",
			"iframe",
			"worker",
			"sharedworker",
			"style",
			"script",
		].includes(request.destination)
	) {
		headers.set("Cross-Origin-Embedder-Policy", "require-corp");
		headers.set("Cross-Origin-Opener-Policy", "same-origin");
	}

	if (request.destination === "document" || request.destination === "iframe") {
		headers.set("Referrer-Policy", "unsafe-url");
	}

	return headers;
}

async function rewriteBody(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	response: BareResponse
): Promise<BodyType> {
	switch (request.destination) {
		case "iframe":
		case "document":
			if (isHtmlMimeType(response.headers.get("content-type") ?? "")) {
				const buf = await response.arrayBuffer();
				const bytes = new Uint8Array(buf);
				const encoding = sniffEncoding(
					bytes,
					response.headers.get("content-type")
				);
				const htmlContent = new TextDecoder(encoding).decode(bytes);

				return rewriteHtml(htmlContent, handler.context, parsed.meta, {
					loadScripts: true,
					inline: true,
					source: parsed.url.href,
					headers: response.rawHeaders,
				});
			} else {
				return response.body;
			}
		case "script": {
			// do not attempt to rewrite a 404 response
			if (response.ok) {
				const ct = response.headers.get("content-type");
				// don't rewrite invalid module scripts when the server declares a non-JS type
				if (parsed.scriptType === "module" && ct && !isJavascriptMimeType(ct)) {
					return response.body;
				}

				return rewriteJs(
					new Uint8Array(await response.arrayBuffer()),
					response.url,
					handler.context,
					parsed.meta,
					parsed.scriptType === "module"
				) as unknown as ArrayBuffer;
			}
			return response.body;
		}
		case "style":
			return rewriteCss(await response.text(), handler.context, parsed.meta);
		case "sharedworker":
		case "worker":
			return rewriteWorkers(
				handler.context,
				new Uint8Array(await response.arrayBuffer()),
				// TODO: this takes a scriptType and rewritejs takes a bool..
				parsed.scriptType,
				response.url,
				parsed.meta
			);
		default:
			return response.body;
	}
}

export type FetchHooks = {
	request: {
		context: {
			request: ScramjetFetchRequest;
			parsed: ScramjetFetchParsed;
			client: BareCompatibleClient;
		};
		props: {
			init: BareRequestInit;
			url: URL;
			earlyResponse?: BareResponse;
		};
	};
	preresponse: {
		context: {
			request: ScramjetFetchRequest;
			parsed: ScramjetFetchParsed;
		};
		props: {
			response: BareResponse;
		};
	};
	response: {
		context: {
			request: ScramjetFetchRequest;
			parsed: ScramjetFetchParsed;
		};
		props: {
			response: ScramjetFetchResponse;
		};
	};
};

type BodyType = string | ArrayBuffer | Blob | ReadableStream<any>;
