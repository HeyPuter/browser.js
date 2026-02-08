import { createState, type Delegate, type Stateful } from "dreamland/core";
import { StatefulClass } from "./StatefulClass";
import { Tab, type SerializedTab } from "./Tab";
import { createDelegate } from "dreamland/core";
import type { SerializedHistoryState } from "./History";
import { HistoryState } from "./History";
import { focusOmnibox } from "@components/Omnibar/Omnibox";
import { type AVAILABLE_SEARCH_ENGINES } from "@components/Omnibar/suggestions";
import { FAVICON_CACHE_TTL, INTERNAL_URL_PROTOCOL } from "./consts";

import * as tldts from "tldts";
import { isPuter } from "./main";
import {
	animateDownloadFly,
	showDownloadsPopup,
} from "@components/Omnibar/Omnibar";
import type { RawDownload } from "./proxy/scramjet";
import { CookieJar } from "@mercuryworkshop/scramjet/bundled";
import { getSerializedBrowserState, markDirty } from "./storage";
import {
	type AppearancePreference,
	type ThemeId,
	DEFAULT_THEME_ID,
} from "./themes";
import { bare } from "./proxy/wisp";
export const pushTab = createDelegate<Tab>();
export const popTab = createDelegate<Tab>();
export const forceScreenshot = createDelegate<Tab>();
// import { deserializeAll, serializeAll } from "./serialize";

export let browser: Browser;

export type FaviconCacheEntry = {
	domain: string;
	iconUrl: string;
	iconData: string;
	timestamp: number;
};

export type SerializedBrowser = {
	tabs: SerializedTab[];
	globalhistory: SerializedHistoryState[];
	globalDownloadHistory: DownloadEntry[];
	faviconCache: FaviconCacheEntry[];
	activetab: number;
	bookmarks: BookmarkEntry[];
	settings: Settings;
	cookiedump: string;
};

export type GlobalHistoryEntry = {
	timestamp: number;
	url: string;
	title: string;
	favicon?: string;
};

export type BookmarkEntry = {
	url: string;
	title: string;
	favicon: string | null;
};

export type DownloadEntry = {
	url: string;
	filename: string;
	timestamp: number;
	size: number;
	id: string;
	cancelled: boolean;

	progress?: number;
	progressbytes?: number;
	paused?: boolean;
	cancel?: Delegate<void>;
	pause?: Delegate<void>;
};

export type Settings = {
	appearance: AppearancePreference;
	themeId: ThemeId;
	startupPage: "new-tab" | "continue";
	defaultZoom: number;
	showBookmarksBar: boolean;
	defaultSearchEngine: keyof typeof AVAILABLE_SEARCH_ENGINES;
	searchSuggestionsEnabled: boolean;
	blockTrackers: boolean;
	clearHistoryOnExit: boolean;
	doNotTrack: boolean;
	extensionsDevMode: boolean;
};

export class Browser extends StatefulClass {
	built: boolean = false;

	tabs: Tab[] = [];
	activetab: Tab = null!;

	globalhistory: HistoryState[] = [];
	bookmarks: Stateful<BookmarkEntry>[] = [];

	sessionDownloadHistory: Stateful<DownloadEntry>[] = [];
	globalDownloadHistory: Stateful<DownloadEntry>[] = [];

	faviconCache: FaviconCacheEntry[] = [];
	pendingFaviconRequests: Record<
		string,
		Promise<FaviconCacheEntry | null> | null
	> = {};

	cookieJar: CookieJar = new CookieJar();

	downloadProgress = 0;

	settings: Stateful<Settings> = createState({
		appearance: "system",
		themeId: DEFAULT_THEME_ID,
		startupPage: "continue",
		defaultZoom: 100,
		showBookmarksBar: true,
		defaultSearchEngine: "google",
		searchSuggestionsEnabled: true,
		blockTrackers: true,
		clearHistoryOnExit: false,
		doNotTrack: true,
		extensionsDevMode: false,
	});

	constructor() {
		super(createState(Object.create(Browser.prototype)));

		// scramjet.addEventListener("download", (e) => {
		// 	this.startDownload(e.download);
		// });
	}

	private async __fetchFavicon(
		hostname: string
	): Promise<FaviconCacheEntry | null> {
		const toDataUrl = async (res: Response) => {
			const blob = await res.blob();
			const iconData = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
			return iconData;
		};

		try {
			// first do google favicon search
			const url = `https://www.google.com/s2/favicons?domain=${hostname}`;
			let res = await bare.fetch(url);
			if (!res.ok) {
				console.error(
					"failed to fetch favicon from google",
					url,
					res.statusText
				);
				throw new Error(
					`failed to fetch favicon from google: ${res.statusText}`
				);
			}
			const iconData = await toDataUrl(res);
			return {
				domain: hostname,
				iconUrl: url,
				iconData,
				timestamp: Date.now(),
			};
		} catch (e) {
			console.error(e);
		}

		try {
			// fall back to direct fetch
			const url = `https://${hostname}/favicon.ico`;
			let res = await bare.fetch(url);
			if (!res.ok) {
				console.error("failed to fetch favicon from", url, res.statusText);
				throw new Error(`failed to fetch favicon from: ${res.statusText}`);
			}
			const iconData = await toDataUrl(res);
			return {
				domain: hostname,
				iconUrl: url,
				iconData,
				timestamp: Date.now(),
			};
		} catch (e) {
			console.error(e);
		}

		return null;
	}

	async _fetchFavicon(hostname: string): Promise<FaviconCacheEntry | null> {
		let entry = this.faviconCache.find((e) => e.domain === hostname);
		if (entry) {
			if (entry.timestamp > Date.now() - FAVICON_CACHE_TTL) {
				return entry;
			}
			console.log("favicon cache hit for", hostname, "but expired");
			this.faviconCache = this.faviconCache.filter(
				(e) => e.domain !== entry!.domain
			);
		}

		const parsed = tldts.parse(hostname);
		if (parsed.isIp || !parsed.isIcann || hostname === "localhost") {
			// probably not a real domain, so don't try to fetch a favicon
			return null;
		}

		return this.__fetchFavicon(hostname);
	}

	async fetchFavicon(hostname: string): Promise<FaviconCacheEntry | null> {
		if (this.pendingFaviconRequests[hostname]) {
			return this.pendingFaviconRequests[hostname]!;
		}
		let p = this._fetchFavicon(hostname);
		this.pendingFaviconRequests[hostname] = p;
		let result = await p;
		this.pendingFaviconRequests[hostname] = null;
		return result;
	}

	async startDownload(download: RawDownload) {
		this.downloadProgress = 0.1;
		let downloaded = 0;
		animateDownloadFly();

		let filename = download.filename;
		if (!filename) {
			let url = new URL(download.url);
			filename =
				decodeURIComponent(url.pathname.split("/").at(-1) || "") ||
				url.hostname.replaceAll(".", "-");
		}

		let cancel = createDelegate<void>();
		let pause = createDelegate<void>();

		let entry: Stateful<DownloadEntry> = createState({
			filename,
			url: download.url,
			size: download.length,
			timestamp: Date.now(),
			id: crypto.randomUUID(),
			cancelled: false,

			progress: 0,
			progressbytes: 0,
			paused: false,
			cancel,
			pause,
		});
		this.globalDownloadHistory = [entry, ...this.globalDownloadHistory];
		this.sessionDownloadHistory = [entry, ...this.sessionDownloadHistory];

		let resumeResolver: (() => void) | null = null;
		const ac = new AbortController();

		pause.listen(() => {
			entry.paused = !entry.paused;
			if (!entry.paused) {
				resumeResolver?.();
				resumeResolver = null;
			}
		});

		cancel.listen(() => {
			entry.cancelled = true;
			ac.abort();
		});

		const pausableProgress = new TransformStream<Uint8Array, Uint8Array>({
			async transform(chunk, controller) {
				if (entry.paused)
					await new Promise<void>((res) => (resumeResolver = res));
				downloaded += chunk.byteLength;
				entry.progressbytes = downloaded;
				browser.downloadProgress = entry.progress = Math.min(
					(download.length ? downloaded / download.length : 0) + 0.1,
					1
				);
				controller.enqueue(chunk);
			},
		});

		const streamnull = new WritableStream<Uint8Array>({
			write() {},
		});

		try {
			await download.body
				.pipeThrough(pausableProgress)
				.pipeTo(streamnull, { signal: ac.signal });
		} catch (err) {
			if ((err as any)?.name !== "AbortError") throw err;
		}
		entry.cancel = undefined;
		entry.pause = undefined;
		entry.progress = undefined;
		entry.progressbytes = undefined;
		entry.paused = false;
		showDownloadsPopup();
		setTimeout(() => {
			this.downloadProgress = 0;
		}, 1000);
	}

	serialize(): SerializedBrowser {
		return {
			tabs: this.tabs.map((t) => t.serialize()),
			activetab: this.activetab.id,
			globalhistory: this.globalhistory.map((s) => s.serialize()),
			bookmarks: this.bookmarks,
			settings: { ...this.settings },
			globalDownloadHistory: this.globalDownloadHistory,
			cookiedump: this.cookieJar.dump(),
			faviconCache: this.faviconCache,
		};
	}
	deserialize(de: SerializedBrowser) {
		this.tabs = [];
		this.globalhistory = de.globalhistory.map((s) => {
			const state = new HistoryState();
			state.deserialize(s);
			return state;
		});

		if (de.settings.startupPage === "continue") {
			for (let detab of de.tabs) {
				let tab = this.newTab(undefined, false, detab.id);
				tab.deserialize(detab);
				tab.history.justTriggeredNavigation = true;
				tab.history.go(0, false);
			}
			this.activetab = this.tabs.find((t) => t.id == de.activetab)!;
		} else {
			this.tabs[0] = this.newTab();
			this.activetab = this.tabs[0];
		}
		this.bookmarks = de.bookmarks.map(createState);
		this.globalDownloadHistory = de.globalDownloadHistory.map(createState);

		const settings = { ...de.settings };

		this.settings = createState(settings);
		this.cookieJar.load(de.cookiedump);
		this.faviconCache = de.faviconCache;
	}

	newTab(url?: URL, focusomnibox: boolean = false, id?: number) {
		let tab = new Tab(url, id);
		pushTab(tab);
		this.tabs = [...this.tabs, tab];
		this.activetab = tab;
		if (focusomnibox) focusOmnibox();
		return tab;
	}

	newTabRight(ref: Tab, url?: URL) {
		let tab = new Tab(url);
		pushTab(tab);
		let index = this.tabs.indexOf(ref);
		this.tabs.splice(index + 1, 0, tab);
		this.tabs = this.tabs;
		this.activetab = tab;
		return tab;
	}

	destroyTab(tab: Tab) {
		this.tabs = this.tabs.filter((t) => t !== tab);
		if (this.tabs.length === 0 && isPuter) {
			puter.exit();
		}

		if (this.activetab === tab) {
			this.activetab =
				this.tabs[0] ||
				browser.newTab(new URL(`${INTERNAL_URL_PROTOCOL}//newtab`), true);
		}
		popTab(tab);
	}

	searchNavigate(url: string) {
		function validTld(hostname: string) {
			const res = tldts.parse(url);
			if (!res.domain) return false;
			if (res.isIp || res.isIcann) return true;
			return false;
		}

		// TODO: dejank
		if (URL.canParse(url)) {
			this.activetab.pushNavigate(new URL(url));
		} else if (
			URL.canParse("https://" + url) &&
			validTld(new URL("https://" + url).hostname)
		) {
			let fullurl = new URL("https://" + url);
			this.activetab.pushNavigate(fullurl);
		} else {
			const search = `https://google.com/search?q=${encodeURIComponent(url)}`;
			this.activetab.pushNavigate(new URL(search));
		}
	}
}

export let browserLoaded = false;

export async function initBrowser() {
	browser = new Browser();

	let de = await getSerializedBrowserState();
	if (de) {
		try {
			browser.deserialize(JSON.parse(de));
		} catch (e) {
			console.error(e);
			console.error("Error while loading browser state. Resetting...");

			browser = new Browser();
			let tab = browser.newTab();
			browser.activetab = tab;
			markDirty();
		}
	} else {
		let tab = browser.newTab();
		browser.activetab = tab;
	}

	(self as any).browser = browser;
	browserLoaded = true;
}
