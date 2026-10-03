import { Object_entries, Object_keys, _URL, Error } from "@/shared/snapshot";
import { referrerFallback, unrewriteUrl, URLMeta } from "@rewriters/url";
import { REFERRER_FALLBACK_HEADER } from "@/shared/headers";
import {
	ScramjetFetchHandler,
	ScramjetFetchParsed,
	ScramjetFetchRequest,
} from ".";

export const QP = {
	referrerPolicy: "$rfp",
	referrerSource: "$rfs",
	referrerFallback: "$rff",
	isModule: "$module",
	topFrame: "$tf",
	parentFrame: "$pf",
	isIframe: "$iframe",
	mode: "$mode",
	credentials: "$cred",
	destination: "$dest",
	initiatorOrigin: "$io",
	fetchSite: "$fs",
	crossSiteRedirect: "$csr",
	fakeDataURL: "$fakedataurl",
} as const;

export type QueryParamKey = keyof typeof QP;

export type QueryParams = Partial<Record<QueryParamKey, string>>;

const QP_INVERSE: Record<string, QueryParamKey> = (() => {
	const inv: Record<string, QueryParamKey> = {};
	for (const key of Object_keys(QP) as QueryParamKey[]) {
		inv[QP[key]] = key;
	}
	return inv;
})();

export function parseQueryParams(searchParams: URLSearchParams): {
	params: QueryParams;
	extras: Record<string, string>;
} {
	const params: QueryParams = {};
	const extras: Record<string, string> = {};
	for (const [key, value] of [...searchParams.entries()]) {
		const logical = QP_INVERSE[key];
		if (logical) {
			params[logical] = value;
		} else {
			dbg.warn(
				`extraneous query parameter ${key}=${value}. Assuming <form> element`
			);
			extras[key] = value;
		}
	}
	return { params, extras };
}

/**
 * Whether a request with none of the proxy's parameters is a module script.
 *
 * Every URL scramjet rewrites carries its parameters - `$io` at the least,
 * since the page's origin is never the proxy's. One that arrives with none was
 * built by the browser: an import map's prefix mapping extends a prefix that
 * cannot carry a query (see `rewriters/importmap`), so the `$module` a
 * rewritten module URL would have is missing. Modules are fetched in `cors`
 * mode, and a classic script element only is when it asks to be.
 */
function isUnmarkedModule(
	request: ScramjetFetchRequest,
	params: QueryParams
): boolean {
	// a query the specifier carried past the prefix is the module's own, and
	// is passed through the way a form's is
	if (Object_keys(params).length !== 0) return false;

	return request.rawDestination === "script" && request.mode === "cors";
}

function parseReferrerFallback(
	href: string | null | undefined
): _URL | undefined {
	if (!href) return undefined;
	try {
		return new _URL(href);
	} catch {
		return undefined;
	}
}

/**
 * The referrer the page put in {@link REFERRER_FALLBACK_HEADER}, `null` for
 * none at all, or `undefined` for no header - or one that cannot be believed.
 *
 * The page's own `fetch()` writes it, for a referrer that is the page or one
 * of its choosing, and a page's referrer is always of its own origin. But any
 * page can write any header, so it is only taken when it is: the client is the
 * one thing about the request the page cannot write.
 */
function headerReferrerFallback(
	request: ScramjetFetchRequest,
	handler: ScramjetFetchHandler
): _URL | null | undefined {
	const header = request.initialHeaders.get(REFERRER_FALLBACK_HEADER);
	if (header === null) return undefined;
	// saying there is none can only ever take away
	if (header === "") return null;

	const fallback = parseReferrerFallback(header);
	if (!fallback || !request.rawClientUrl) return undefined;
	let client: _URL;
	try {
		client = new _URL(unrewriteUrl(request.rawClientUrl, handler.context));
	} catch {
		return undefined;
	}
	if (client.protocol !== "http:" && client.protocol !== "https:") {
		return undefined;
	}

	return fallback.origin === client.origin ? fallback : undefined;
}

export function parseRequest(
	request: ScramjetFetchRequest,
	handler: ScramjetFetchHandler
): ScramjetFetchParsed {
	const strippedUrl = new _URL(request.rawUrl.href);
	const { params, extras } = parseQueryParams(request.rawUrl.searchParams);
	strippedUrl.search = "";

	const hadExtraParams = Object_keys(extras).length > 0;

	if (!_URL.canParse(unrewriteUrl(strippedUrl, handler.context))) {
		throw new Error(`unable to parse rewritten url: ${strippedUrl.href}`);
	}
	const url = new _URL(unrewriteUrl(strippedUrl, handler.context));

	if (url.origin === new _URL(request.rawUrl).origin) {
		// uh oh!
		throw new Error(
			"attempted to fetch from same origin - this means the site has obtained a reference to the real origin, aborting"
		);
	}

	for (const [key, value] of Object_entries(extras)) {
		url.searchParams.set(key, value);
	}

	const referrerSourceUrl =
		params.referrerSource === undefined
			? undefined
			: params.referrerSource
				? new _URL(params.referrerSource)
				: null;

	const fetchSiteState =
		params.fetchSite === "same-origin" ||
		params.fetchSite === "same-site" ||
		params.fetchSite === "cross-site"
			? params.fetchSite
			: undefined;

	const fetchMode = ["cors", "no-cors", "same-origin", "navigate"].includes(
		params.mode
	)
		? (params.mode as RequestMode)
		: undefined;
	const destination =
		(params.destination as RequestDestination | undefined) ||
		request.rawDestination;

	const fromHeader = headerReferrerFallback(request, handler);

	const meta: URLMeta = {
		origin: url,
		base: url,
		// a document is loaded at the URL it was requested with, so that is
		// the real URL a link back into it has to match
		rawUrl:
			destination === "document" || destination === "iframe"
				? request.rawUrl.href
				: undefined,
		topFrameName: params.topFrame,
		parentFrameName: params.parentFrame,
		// what this response goes on to request has it as the referrer
		referrerFallback: referrerFallback(request.rawUrl.href, url),
	};

	const parsed: ScramjetFetchParsed = {
		meta,
		url,
		isModule: params.isModule === "module" || isUnmarkedModule(request, params),
		referrerSourceUrl,
		initialReferrerPolicy: params.referrerPolicy,
		hadExtraParams,
		crossSiteRedirect: params.crossSiteRedirect === "1",
		fetchSiteState,
		fetchInitiatorOrigin: params.initiatorOrigin || undefined,
		referrerFallback:
			fromHeader === undefined
				? parseReferrerFallback(params.referrerFallback)
				: (fromHeader ?? undefined),
		// TODO: should really just be a boolean
		fetchCredentialsInclude: params.credentials === "include",
		fetchMode,
		destination,
		isIframe: params.isIframe === "1",
		isFakeDataURL: params.fakeDataURL === "1",
	};

	if (request.rawClientUrl) {
		parsed.clientUrl = new _URL(
			unrewriteUrl(request.rawClientUrl, handler.context)
		);
	}

	return parsed;
}
