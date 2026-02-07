import { browser } from "../../Browser";
import { bare } from "../../proxy/wisp";
import { INTERNAL_URL_PROTOCOL } from "../../consts";

import * as tldts from "tldts";

export type OmniboxResult = {
	kind:
		| "search"
		| "history"
		| "bookmark"
		| "direct"
		| "trending"
		| "directsearch";
	title: string | null;
	url: URL;
	favicon: string | null;
	relevanceScore?: number;
	directUrlType?: "domain" | "ip" | "puter" | "about" | "protocol";
};

export interface SearchEngine {
	name: string;
	suggestUrlBuilder: (query: string) => string;
	searchUrlBuilder: (query: string) => string;
	suggestionParser: (data: any) => string[];
}

/** Available search engines */
export const AVAILABLE_SEARCH_ENGINES = {
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

function calculateRelevanceScore(result: OmniboxResult, query: string): number {
	if (!query) return 0;

	const lowerQuery = query.toLowerCase();
	const urlString = result.url.href.toLowerCase();
	const title = result.title?.toLowerCase() || "";

	let score = 0;

	// if (urlString === lowerQuery || title === lowerQuery) {
	// 	return 100;
	// }

	if (result.kind === "direct") {
		return 95;
	}

	if (result.kind === "directsearch") {
		return 90;
	}

	if (result.kind === "bookmark") {
		score += 20;
	}

	if (result.kind === "history") {
		score += 10;
	}

	if (result.url.hostname.includes(lowerQuery)) {
		score += 40;
	}

	if (title.startsWith(lowerQuery)) {
		score += 30;
	}

	if (result.url.pathname.toLowerCase().startsWith(lowerQuery)) {
		score += 25;
	}

	if (title.includes(lowerQuery)) {
		score += 15;
	}

	if (urlString.includes(lowerQuery)) {
		score += 10;
	}

	return score;
}

function rankResults(
	results: OmniboxResult[],
	query: string,
	suggestionDenied: boolean
): OmniboxResult[] {
	return results
		.map((result) => ({
			...result,
			relevanceScore: calculateRelevanceScore(result, query),
		}))
		.sort((a, b) => {
			if (
				suggestionDenied &&
				(b.kind === "direct" || b.kind === "directsearch")
			) {
				// don't allow something other than What Was Typed to be higher if the user just backspaced
				return 1;
			} else {
				return (b.relevanceScore || 0) - (a.relevanceScore || 0);
			}
		});
}
let cachedGoogleResults: OmniboxResult[] = [];

const fetchHistoryResults = (query: string): OmniboxResult[] => {
	if (!query) return [];

	const results: OmniboxResult[] = [];
	const lowerQuery = query.toLowerCase();

	for (const entry of browser.globalhistory) {
		const urlMatch = entry.url.href.toLowerCase().includes(lowerQuery);
		const titleMatch = entry.title?.toLowerCase()?.includes(lowerQuery);

		if (!urlMatch && !titleMatch) continue;
		if (results.some((i) => i.url.href === entry.url.href)) continue;

		results.push({
			kind: "history",
			title: entry.title,
			url: entry.url,
			favicon: entry.favicon,
		});
	}

	return results.slice(0, 5);
};

function omniboxParseUrl(raw: string):
	| {
			url: URL;
			type: OmniboxResult["directUrlType"];
	  }
	| undefined {
	// parsable urls, examples: https://example.com, http://127.0.0.1:8080, mailto:user@example.com, about:blank, ...
	if (URL.canParse(raw)) {
		let url = new URL(raw);
		if (url.protocol === INTERNAL_URL_PROTOCOL && url.hostname !== "") {
			// user entered puter://something
			return {
				url: url,
				type: "puter",
			};
		}

		if (url.hostname === "") {
			// direct schema url
			// mailto:user@example.com, about:blank

			// because of the way browsers parse urls, localhost:8080, puter:settings, etc are parsed as direct schema urls
			// where the user is expecting them to be parsed like http://localhost:8080, puter://settings, etc
			// so we need to normalize it here

			if (url.protocol === INTERNAL_URL_PROTOCOL) {
				return {
					url: new URL(`${INTERNAL_URL_PROTOCOL}//${url.pathname}`),
					type: "puter",
				};
			}

			// it feels a little odd to hardcode localhost here but it's not like we're worrying about mdns hosts or anything?
			if (url.protocol === "localhost:") {
				console.log(url.pathname, url);
				// TODO: this parses `localhost:` as `localhost` when it really should resolve to a protocol url
				return {
					url: new URL(`http://${url.protocol}${url.pathname}`),
					type: "ip",
				};
			}

			// about: actually IS a protocol url, it's just a special one
			if (url.protocol === "about:") {
				return {
					url: url,
					type: "about",
				};
			}

			// if we get here, it should be interpreted as a protocol url like mailto:
			// TODO: maybe something weird like `asd:x` should have the google search result first, then the direct schema result?
			return {
				url: url,
				type: "protocol",
			};
		}

		// it's a normal url. still run tldts to see if it's an ip or domain
		let parsed = tldts.parse(url.hostname);
		return {
			url: url,
			type: parsed.isIp ? "ip" : "domain",
		};
	} else {
		// it's not a valid url, but it might be a domain or ip
		// examples: `domain.com`, `domain.com/path`, `127.0.0.1:8080`, `asdf`

		// this needs to be handled specially
		if (raw === "localhost") {
			return {
				url: new URL("http://localhost"),
				type: "ip",
			};
		}

		let parsed = tldts.parse(raw);
		if ((parsed.domain && parsed.isIcann) || parsed.isIp) {
			// TODO: this probably isn't right for all cases
			// i think typing in `://a.com` would break it because it's an invalid url but passes tldts
			// but tldts doesn't parse path/port/schema so we can't use its parser
			return {
				url: new URL("https://" + raw),
				type: parsed.isIp ? "ip" : "domain",
			};
		}

		// it's nothing!
		return undefined;
	}
}

const addDirectResult = (query: string, results: OmniboxResult[]) => {
	let parsed = omniboxParseUrl(query);
	if (parsed) {
		results.unshift({
			kind: "direct",
			url: parsed.url,
			directUrlType: parsed.type,
			title: null,
			favicon: null,
		});
	}

	results.unshift({
		kind: "directsearch",
		url: new URL(
			AVAILABLE_SEARCH_ENGINES[
				browser.settings.defaultSearchEngine
			].searchUrlBuilder(query)
		),
		title: query,
		favicon: null,
	});
};

const fetchGoogleSuggestions = async (
	query: string
): Promise<OmniboxResult[]> => {
	if (!query) return [];
	if (!bare) return [];

	try {
		const resp = await bare.fetch(
			AVAILABLE_SEARCH_ENGINES[
				browser.settings.defaultSearchEngine
			].suggestUrlBuilder(query)
		);

		const json = await resp.json();
		let rawSuggestions =
			AVAILABLE_SEARCH_ENGINES[
				browser.settings.defaultSearchEngine
			].suggestionParser(json);
		rawSuggestions = rawSuggestions.slice(0, 5);
		const suggestions: OmniboxResult[] = [];

		for (const item of rawSuggestions) {
			// it's gonna be stuff like "http //fortnite.com/2fa ps5"
			// generally not useful
			if (item.startsWith("http")) continue;

			suggestions.push({
				kind: "search",
				title: item,
				url: new URL(
					AVAILABLE_SEARCH_ENGINES[
						browser.settings.defaultSearchEngine
					].searchUrlBuilder(query)
				),
				favicon: null,
			});
		}

		return suggestions;
	} catch (error) {
		console.error("Error fetching Google suggestions:", error);

		return [];
	}
};

let timeout: number | null = null;
let lastStartedTimestamp: number | null = null;
let currentQuery: string;

let historyResults: OmniboxResult[];
export async function fetchSuggestions(
	query: string,
	suggestionDenied: boolean,
	setResults: (results: OmniboxResult[]) => void
) {
	if (!query) {
		setResults([]);

		return;
	}
	currentQuery = query;

	historyResults = fetchHistoryResults(query);

	let combinedResults: OmniboxResult[] = [
		...historyResults,
		...cachedGoogleResults,
	];

	addDirectResult(query, combinedResults);

	// first update, so the user sees something quickly
	setResults(rankResults(combinedResults, query, suggestionDenied));

	// these are expensive, so debounce 100ms
	let started = Date.now();
	if (timeout) clearTimeout(timeout);
	timeout = setTimeout(async () => {
		const googleResults = await fetchGoogleSuggestions(query);
		// sometimes, an old request will respond after a fresher request gets a response
		// if that happens, instantly discard the data
		if (lastStartedTimestamp && lastStartedTimestamp > started) {
			return;
		}
		lastStartedTimestamp = started;

		// note thast historyResults may have changed in between
		combinedResults = [...historyResults, ...googleResults];
		// query might have also changed, so use the global one
		addDirectResult(currentQuery, combinedResults);

		// update with the new google results
		setResults(rankResults(combinedResults, currentQuery, suggestionDenied));
		cachedGoogleResults = googleResults;

		timeout = null;
	}, 100);
}

export type TrendingQuery = {
	title: string;
	traffic?: string;
	url?: string;
};

export let trendingCached: TrendingQuery[] | null = null;
export async function fetchGoogleTrending(geo = "US"): Promise<void> {
	if (!bare) return;
	// TODO: make this search engine agnostic
	try {
		if (trendingCached) return;

		const res = await bare.fetch(
			"https://trends.google.com/_/TrendsUi/data/batchexecute",
			{
				method: "POST",
				body: `f.req=[[["i0OFE","[null, null, \\"${geo}\\", 0, null, 48]"]]]`,
				headers: [
					["Content-Type", "application/x-www-form-urlencoded;charset=UTF-8"],
					["Referer", "https://trends.google.com/trends/explore"],
				],
			}
		);
		if (!res.ok) return;

		const text = await res.text();
		const json = JSON.parse(text.slice(5));
		const data = JSON.parse(json[0][2]);
		const results: TrendingQuery[] = [];
		for (const item of data[1]) {
			results.push({
				title: item[0],
				traffic: item[1],
				url: item[2]
					? `https://www.google.com/search?q=${encodeURIComponent(item[0])}`
					: undefined,
			});
		}

		trendingCached = results;
	} catch (err) {
		console.error("fetchGoogleTrending failed", err);
	}
}
