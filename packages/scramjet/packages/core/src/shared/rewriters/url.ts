import { ScramjetContext } from "@/shared";
import { rewriteJs } from "@rewriters/js";
import { QP } from "@/fetch/parse";

import {
	TextEncoder_encode,
	_URL,
	_URLSearchParams,
	_Uint8Array,
	_Blob,
	atob,
	selfLocation,
	String,
	String_startsWith,
	URL_createObjectURL,
} from "../snapshot";

// user: manually triggered navigation
// link: link clicked by the user. still user initiated, but doesn't wipe
// location: location = ...
export type NavigationType = "user" | "link" | "location";

export type RewriteUrlOptions = {
	isModule?: boolean;
	navigateType?: NavigationType;
	topFrame?: string;
	parentFrame?: string;
	isIframe?: string;
	mode?: string;
	credentials?: string;
	destination?: RequestDestination;
};

export type URLMeta = {
	origin: _URL;
	base: _URL;
	/**
	 * The URL of the top-level frame this context belongs to, which is the one
	 * `siteFlags` are matched against: a subframe, a worker and a script from
	 * another site all run with the flags of the page they are part of.
	 */
	topUrl?: _URL;
	topFrameName?: string;
	parentFrameName?: string;
	/** Stamped on every URL rewritten here as `$rff`, see {@link referrerFallback}. */
	referrerFallback?: string;
};

/** Longer referrers are cut down to their origin, as Chrome does. */
export const MAX_REFERRER_LENGTH = 4096;

/**
 * The site's URL for `source`, when the browser will send the proxy's URL for
 * it as nothing but an origin for its length alone.
 *
 * The browser measures the referrer it sends - the proxy's URL, prefix, codec
 * and query and all - where the site's browser would have measured the site's
 * own. Past the limit, what reaches the service worker is the proxy's origin,
 * and the path is gone. So the requests made from such a source carry its URL
 * for the service worker to take the referrer from instead. Nothing needs it
 * when the site's URL is over the limit too: then its origin is all that is
 * sent either way.
 *
 * https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
 * (step 6, as Chrome sets the limit)
 */
export function referrerFallback(
	proxyHref: string,
	source: URL
): string | undefined {
	// the fragment is never part of the referrer
	const hash = proxyHref.indexOf("#");
	const measured = hash === -1 ? proxyHref.length : hash;
	if (measured <= MAX_REFERRER_LENGTH) return undefined;
	if (source.protocol !== "http:" && source.protocol !== "https:") {
		return undefined;
	}

	const stripped = new _URL(source.href);
	stripped.username = "";
	stripped.password = "";
	stripped.hash = "";
	if (stripped.href.length > MAX_REFERRER_LENGTH) return undefined;

	return stripped.href;
}

function isWorkerDestination(destination?: RequestDestination) {
	return destination === "worker" || destination === "sharedworker";
}

function tryCanParseURL(url: string, origin?: string | URL): _URL | null {
	try {
		return new _URL(url, origin);
	} catch {
		return null;
	}
}

export function rewriteBlob(
	url: string,
	context: ScramjetContext,
	meta: URLMeta
) {
	const blob = new _URL(url.substring("blob:".length));

	return "blob:" + meta.origin.origin + blob.pathname;
}

export function unrewriteBlob(
	url: string,
	context: ScramjetContext,
	_meta: URLMeta
) {
	const blob = new _URL(url.substring("blob:".length));

	return "blob:" + context.prefix.origin + blob.pathname;
}

function dataToBlob(url: string) {
	const commaIndex = url.indexOf(",");
	if (commaIndex === -1) return null;

	const meta = url.slice("data:".length, commaIndex);
	const data = url.slice(commaIndex + 1);

	const metaParts = meta.split(";");
	const mediaType = metaParts.shift() || "";
	const isBase64 = metaParts.some((part) => part.toLowerCase() === "base64");
	const params = metaParts.filter(
		(part) => part && part.toLowerCase() !== "base64"
	);

	let type = mediaType || "text/plain";
	if (!mediaType) {
		const hasCharset = params.some((part) =>
			String_startsWith(part.toLowerCase(), "charset=")
		);
		if (!hasCharset) {
			params.push("charset=US-ASCII");
		}
	}
	if (params.length) type += ";" + params.join(";");

	let bytes: Uint8Array<ArrayBuffer>;
	if (isBase64) {
		let base64 = data.replace(/\s/g, "");
		base64 = base64.replace(/-/g, "+").replace(/_/g, "/");
		const binString = atob(base64);
		bytes = new _Uint8Array(binString.length) as Uint8Array<ArrayBuffer>;
		for (let i = 0; i < binString.length; i++) {
			bytes[i] = binString.charCodeAt(i);
		}
	} else {
		let decoded = data;
		try {
			decoded = decodeURIComponent(data);
		} catch {
			// If decode fails, fall back to raw data.
		}
		bytes = TextEncoder_encode(decoded);
	}

	const blob = new _Blob([bytes], { type });
	const objectUrl = URL_createObjectURL(blob);
	return { blob, objectUrl };
}

export function rewriteUrl(
	url: string | URL,
	context: ScramjetContext,
	meta: URLMeta,
	options?: RewriteUrlOptions
) {
	url = String(url);

	if (String_startsWith(url, "javascript:")) {
		return (
			"javascript:" +
			rewriteJs(
				url.slice("javascript:".length),
				"(javascript: url)",
				context,
				meta
			)
		);
	} else if (String_startsWith(url, "blob:")) {
		return context.prefix.href + url;
	} else if (String_startsWith(url, "data:")) {
		const URL_MAX_LENGTH = 1024 * 1024 * 2;
		const BUFFER = 1024;
		// chrome will explode if you make a request to a service worker with a 2MB+ URL
		// there's an okayish workaround which is just Pretending It's a Blob
		if (url.length + context.prefix.href.length + BUFFER > URL_MAX_LENGTH) {
			const { objectUrl } = dataToBlob(url);
			return (
				context.prefix.href +
				rewriteBlob(objectUrl, context, meta) +
				"?" +
				QP.fakeDataURL +
				"=1"
			);
		}

		return context.prefix.href + url;
	} else if (
		String_startsWith(url, "mailto:") ||
		String_startsWith(url, "about:")
	) {
		return url;
	} else {
		let base = meta.base.href;

		if (String_startsWith(base, "about:"))
			base = unrewriteUrl(selfLocation!.href, context); // jank!!!!! weird jank!!!
		const realUrl = tryCanParseURL(url, base);
		if (!realUrl) return url;

		if (realUrl.protocol != "http:" && realUrl.protocol != "https:") {
			// custom protocol. best thing to do is pass it through so it can open an app etc
			// there's also extension:// pages we might need to worry about later
			return url;
		}

		const encodedHash = context.interface.codecEncode(realUrl.hash.slice(1));
		const realHash = encodedHash
			? "#" + encodedHash
			: realUrl.href.endsWith("#")
				? "#"
				: "";
		realUrl.hash = "";

		const paramsInit = new _URLSearchParams();

		if (options?.isModule) paramsInit.set(QP.isModule, "module");
		if (options?.topFrame) paramsInit.set(QP.topFrame, options.topFrame);
		if (options?.parentFrame)
			paramsInit.set(QP.parentFrame, options.parentFrame);
		if (options?.isIframe) paramsInit.set(QP.isIframe, options.isIframe);
		// only where the service worker could not work it out from the client
		// that made the request: a frame or a worker, which becomes its own
		// client, or a context whose top-level frame is not itself
		if (
			meta.topUrl &&
			(options?.isIframe ||
				isWorkerDestination(options?.destination) ||
				meta.topUrl.href !== meta.origin.href)
		)
			paramsInit.set(QP.topUrl, meta.topUrl.href);
		if (options?.mode) paramsInit.set(QP.mode, options.mode);
		if (options?.credentials)
			paramsInit.set(QP.credentials, options.credentials);
		if (options?.destination)
			paramsInit.set(QP.destination, options.destination);

		// specific tracking for sec-fetch-site
		// don't send for the top level controller calling it in go()
		if (meta.origin.origin !== context.prefix.origin) {
			paramsInit.set(QP.initiatorOrigin, meta.origin.origin);
		}
		const fallback = meta.referrerFallback;
		if (fallback) paramsInit.set(QP.referrerFallback, fallback);

		let paramstring = "";
		if (paramsInit.toString()) paramstring = "?" + paramsInit.toString();

		return (
			context.prefix.href +
			context.interface.codecEncode(realUrl.href) +
			paramstring +
			realHash
		);
	}
}

export function unrewriteUrl(url: string | URL, context: ScramjetContext) {
	url = String(url);
	if (String_startsWith(url, "javascript:")) {
		//TODO
		return url;
	} else if (String_startsWith(url, "blob:")) {
		// realistically this shouldn't happen
		return url;
	} else if (String_startsWith(url, context.prefix.href + "blob:")) {
		return url.substring(context.prefix.href.length);
	} else if (String_startsWith(url, context.prefix.href + "data:")) {
		return url.substring(context.prefix.href.length);
	} else if (
		String_startsWith(url, "mailto:") ||
		String_startsWith(url, "about:")
	) {
		return url;
	} else if (
		String_startsWith(url, "http:") ||
		String_startsWith(url, "https:")
	) {
		const realUrl = tryCanParseURL(url);
		if (!realUrl) return url;
		if (realUrl.protocol != "http:" && realUrl.protocol != "https:") {
			// custom protocol
			return url;
		}
		if (!String_startsWith(realUrl.href, context.prefix.href)) {
			dbg.error("unrewriteurl: unexpected url", url);
			return url;
		}
		const decodedHash = context.interface.codecDecode(realUrl.hash.slice(1));
		const realHash = decodedHash
			? "#" + decodedHash
			: realUrl.href.endsWith("#")
				? "#"
				: "";
		realUrl.hash = "";
		realUrl.search = "";

		return (
			context.interface.codecDecode(
				realUrl.href.slice(context.prefix.href.length)
			) + realHash
		);
	} else if (url == "") {
		return url;
	} else {
		dbg.error("unrewriteurl: unexpected url", url);
		return url;
	}
}
