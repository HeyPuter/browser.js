import { browser } from "../../Browser";
import { bare } from "../../IsolatedFrame";

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
};

export interface SearchEngine {
	name: string;
	suggestUrlBuilder: (query: string) => string;
	searchUrlBuilder: (query: string) => string;
	suggestionParser: (data: any) => string[];
}

/** Available search engines */
export const AVAILABLE_SEARCH_ENGINES: Record<string, SearchEngine> = {
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
};

function calculateRelevanceScore(result: OmniboxResult, query: string): number {
	if (!query) return 0;

	const lowerQuery = query.toLowerCase();
	const urlString = result.url.href.toLowerCase();
	const title = result.title?.toLowerCase() || "";

	let score = 0;

	if (urlString === lowerQuery || title === lowerQuery) {
		return 100;
	}

	if (result.kind === "direct" || result.kind === "directsearch") {
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
				// force direct results to the top
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

const addDirectResult = (
	query: string,
	results: OmniboxResult[]
): OmniboxResult[] => {
	if (URL.canParse(query)) {
		return [
			{
				kind: "direct",
				url: new URL(query),
				title: null,
				favicon: null,
			},
			...results,
		];
	} else {
		return [
			{
				kind: "directsearch",
				url: new URL(
					AVAILABLE_SEARCH_ENGINES[
						browser.settings.defaultSearchEngine
					].searchUrlBuilder(query)
				),
				title: query,
				favicon: null,
			},
			...results,
		];
	}
};

const fetchGoogleSuggestions = async (
	query: string
): Promise<OmniboxResult[]> => {
	if (!query) return [];

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

export async function fetchSuggestions(
	query: string,
	suggestionDenied: boolean,
	setResults: (results: OmniboxResult[]) => void
) {
	if (!query) {
		setResults([]);

		return;
	}

	const historyResults = fetchHistoryResults(query);

	let combinedResults: OmniboxResult[] = [
		...historyResults,
		...cachedGoogleResults,
	];

	combinedResults = addDirectResult(query, combinedResults);

	// first update, so the user sees something quickly
	setResults(rankResults(combinedResults, query, suggestionDenied));

	const googleResults = await fetchGoogleSuggestions(query);

	combinedResults = [...historyResults, ...googleResults];
	combinedResults = addDirectResult(query, combinedResults);

	// update with the new google results
	setResults(rankResults(combinedResults, query, suggestionDenied));
	cachedGoogleResults = googleResults;
}

export type TrendingQuery = {
	title: string;
	traffic?: string;
	url?: string;
};

export let trendingCached: TrendingQuery[] | null = null;
export async function fetchGoogleTrending(geo = "US"): Promise<void> {
	// TODO: make this search engine agnostic
	try {
		if (trendingCached) return;

		const res = await bare.fetch(
			"https://trends.google.com/_/TrendsUi/data/batchexecute",
			{
				method: "POST",
				body: `f.req=[[["i0OFE","[null, null, \\"${geo}\\", 0, null, 48]"]]]`,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
					Referer: "https://trends.google.com/trends/explore",
				},
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
