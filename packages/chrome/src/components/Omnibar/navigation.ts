import * as tldts from "tldts";
import { INTERNAL_URL_PROTOCOL } from "../../consts";

export interface SearchEngine {
	name: string;
	suggestUrlBuilder: (query: string) => string;
	searchUrlBuilder: (query: string) => string;
	suggestionParser: (data: any) => string[];
}

/** Available search engines */
export const AVAILABLE_SEARCH_ENGINES = {
	duckduckgo: {
		name: "DuckDuckGo",
		searchUrlBuilder: (query) =>
			`https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
		suggestUrlBuilder: (query) =>
			`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`,
		suggestionParser: (data) => {
			if (Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
				return data[1].map((item: any) => String(item)).filter(Boolean);
			}
			return [];
		},
	},
	google: {
		name: "Google",
		searchUrlBuilder: (query) =>
			`https://www.google.com/search?q=${encodeURIComponent(query)}`,
		suggestUrlBuilder: (query) =>
			`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`,
		suggestionParser: (data) => {
			if (Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
				return data[1].map((item: any) => String(item)).filter(Boolean);
			}
			return [];
		},
	},
	bing: {
		name: "Microsoft Bing",
		searchUrlBuilder: (query) =>
			`https://www.bing.com/search?q=${encodeURIComponent(query)}`,
		suggestUrlBuilder: (query) =>
			`https://www.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
		suggestionParser: (data) => {
			if (Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
				return data[1].map((item: any) => String(item)).filter(Boolean);
			}
			return [];
		},
	},
	yahoo: {
		name: "Yahoo!",
		searchUrlBuilder: (query) =>
			`https://search.yahoo.com/search?q=${encodeURIComponent(query)}`,
		suggestUrlBuilder: (query) =>
			`https://search.yahoo.com/sugg/chrome?output=fxjson&appid=crmas_sfp&command=${encodeURIComponent(query)}`,
		suggestionParser: (data) => {
			if (Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
				return data[1].map((item: any) => String(item)).filter(Boolean);
			}
			return [];
		},
	},
	brave: {
		name: "Brave",
		searchUrlBuilder: (query) =>
			`https://search.brave.com/search?q=${encodeURIComponent(query)}`,
		suggestUrlBuilder: (query) =>
			`https://search.brave.com/api/suggest?q=${encodeURIComponent(query)}&source=web`,
		suggestionParser: (data) => {
			// Google format
			if (Array.isArray(data) && data.length > 1 && Array.isArray(data[1])) {
				return data[1].map((item: any) => String(item)).filter(Boolean);
			}
			// Brave Format
			if (
				Array.isArray(data) &&
				data.length > 0 &&
				typeof data[0] === "string"
			) {
				return data.map((item: string) => String(item)).filter(Boolean);
			}
			return [];
		},
	},
} as const satisfies Record<string, SearchEngine>;

export type DirectUrlType = "domain" | "ip" | "puter" | "about" | "protocol";

export function omniboxParseUrl(
	input: string
): { url: URL; type: DirectUrlType } | undefined {
	const raw = input.trim();
	if (!raw) return;
	try {
		if (raw.toLowerCase().startsWith(INTERNAL_URL_PROTOCOL)) {
			const address = raw
				.slice(INTERNAL_URL_PROTOCOL.length)
				.replace(/^\/\//, "");
			const url = new URL(`${INTERNAL_URL_PROTOCOL}//${address}`);
			return url.hostname ? { url, type: "puter" } : undefined;
		}

		// A host and numeric port must be classified before the URL parser
		// interprets the hostname as a scheme (e.g. example.com:8080).
		const hostPort = /^(?:[^/:?#\s]+|\[[^\]]+\]):\d+(?:[/?#]|$)/.test(raw);
		const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
		if (!hasScheme || hostPort) {
			const url = new URL(`http://${raw}`);
			if (url.username || url.password) return;
			const parsed = tldts.parse(url.hostname);
			const local =
				url.hostname === "localhost" || url.hostname.endsWith(".localhost");
			if (
				!local &&
				!parsed.isIp &&
				!(parsed.domain && parsed.isIcann) &&
				!hostPort
			)
				return;
			if (!local && !parsed.isIp && !hostPort) url.protocol = "https:";
			return { url, type: local || parsed.isIp ? "ip" : "domain" };
		}

		// Search operators such as site:example.com are queries. Schemes with
		// an authority and common non-hierarchical browser URLs remain URLs.
		if (
			!/^[a-z][a-z\d+.-]*:\/\//i.test(raw) &&
			!/^(?:https?|file|about|data|blob|mailto|tel|javascript):/i.test(raw)
		)
			return;
		// Delegate parsing and failure handling to WHATWG URL's constructor:
		// https://url.spec.whatwg.org/#dom-url-url
		const url = new URL(raw);
		return {
			url,
			type:
				url.protocol === "about:"
					? "about"
					: url.hostname
						? tldts.parse(url.hostname).isIp
							? "ip"
							: "domain"
						: "protocol",
		};
	} catch {
		return undefined;
	}
}

export function searchUrl(
	query: string,
	engine: keyof typeof AVAILABLE_SEARCH_ENGINES
): URL {
	return new URL(AVAILABLE_SEARCH_ENGINES[engine].searchUrlBuilder(query));
}

export function resolveNavigation(
	input: string,
	engine: keyof typeof AVAILABLE_SEARCH_ENGINES
): URL | undefined {
	const query = input.trim();
	if (!query) return;
	return omniboxParseUrl(query)?.url ?? searchUrl(query, engine);
}
