import { bare } from "../../proxy/wisp";

import {
	AVAILABLE_SEARCH_ENGINES,
	omniboxParseUrl,
	searchUrl,
} from "./navigation";
export { AVAILABLE_SEARCH_ENGINES } from "./navigation";
import { profileService, settingsService } from "../..";

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
			if (suggestionDenied) {
				const direct = (r: OmniboxResult) =>
					r.kind === "direct" || r.kind === "directsearch";
				if (direct(a) !== direct(b)) return direct(a) ? -1 : 1;
			}
			return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
		});
}

const fetchHistoryResults = (query: string): OmniboxResult[] => {
	if (!query) return [];

	const results: OmniboxResult[] = [];
	const lowerQuery = query.toLowerCase();

	for (const entry of [
		...profileService.bookmarks,
		...profileService.globalhistory.slice().reverse(),
	]) {
		const urlMatch = entry.url.href.toLowerCase().includes(lowerQuery);
		const titleMatch = entry.title?.toLowerCase()?.includes(lowerQuery);

		if (!urlMatch && !titleMatch) continue;
		if (results.some((i) => i.url.href === entry.url.href)) continue;

		results.push({
			kind: profileService.bookmarks.includes(entry as any)
				? "bookmark"
				: "history",
			title: entry.title,
			url: entry.url,
			favicon: "favicon" in entry ? entry.favicon : null,
		});
	}

	return results.slice(0, 5);
};

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
			// TODO: this is duplicated in a lot of places..
			AVAILABLE_SEARCH_ENGINES[
				settingsService.settings.defaultSearchEngine
			].searchUrlBuilder(query)
		),
		title: query,
		favicon: null,
	});
};

async function fetchRemoteSuggestions(
	query: string,
	engine: keyof typeof AVAILABLE_SEARCH_ENGINES
): Promise<OmniboxResult[]> {
	if (!bare) return [];
	try {
		const provider = AVAILABLE_SEARCH_ENGINES[engine];
		const response = await bare.fetch(provider.suggestUrlBuilder(query));
		if (!response.ok) return [];
		return provider
			.suggestionParser(await response.json())
			.slice(0, 5)
			.map((item) => ({
				kind: "search",
				title: item,
				url: searchUrl(item, engine),
				favicon: null,
			}));
	} catch {
		return [];
	}
}

// Each omnibox owns its request. Cancelling invalidates in-flight responses as
// well as the debounce timer, including when the input is cleared or dismissed.
export function fetchSuggestions(
	query: string,
	suggestionDenied: boolean,
	setResults: (results: OmniboxResult[]) => void
): () => void {
	query = query.trim();
	if (!query) {
		setResults([]);
		return () => {};
	}
	const local = fetchHistoryResults(query);
	addDirectResult(query, local);
	setResults(rankResults(local, query, suggestionDenied));
	if (!settingsService.settings.searchSuggestionsEnabled) return () => {};
	const engine = settingsService.settings.defaultSearchEngine;
	let cancelled = false;
	const timeout = setTimeout(async () => {
		if (
			!settingsService.settings.searchSuggestionsEnabled ||
			settingsService.settings.defaultSearchEngine !== engine
		)
			return;
		const remote = await fetchRemoteSuggestions(query, engine);
		if (
			cancelled ||
			!settingsService.settings.searchSuggestionsEnabled ||
			settingsService.settings.defaultSearchEngine !== engine
		)
			return;
		const seen = new Set<string>();
		const results = [...local, ...remote].filter((result) => {
			if (seen.has(result.url.href)) return false;
			seen.add(result.url.href);
			return true;
		});
		setResults(rankResults(results, query, suggestionDenied));
	}, 100);
	return () => {
		cancelled = true;
		clearTimeout(timeout);
	};
}

export type TrendingQuery = {
	title: string;
	traffic?: string;
	url?: string;
};

export let trendingCached: TrendingQuery[] | null = null;
export async function fetchGoogleTrending(geo = "US"): Promise<void> {
	if (
		!bare ||
		!settingsService.settings.searchSuggestionsEnabled ||
		settingsService.settings.defaultSearchEngine !== "google"
	)
		return;
	// Trending is only available for Google.
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
