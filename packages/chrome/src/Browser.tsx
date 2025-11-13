import { createState, type Delegate, type Stateful } from "dreamland/core";
import { StatefulClass } from "./StatefulClass";
import { Tab, type SerializedTab } from "./Tab";
import { createDelegate } from "dreamland/core";
import type { SerializedHistoryState } from "./History";
import { HistoryState } from "./History";
import { focusOmnibox } from "./components/Omnibar/Omnibox";
import { type AVAILABLE_SEARCH_ENGINES } from "./components/Omnibar/suggestions";

import * as tldts from "tldts";
import { isPuter } from "./main";
import {
	animateDownloadFly,
	showDownloadsPopup,
} from "./components/Omnibar/Omnibar";
import type { RawDownload } from "./proxy/fetch";
import { CookieJar } from "@mercuryworkshop/scramjet/bundled";
import { getSerializedBrowserState, markDirty } from "./storage";
import {
	type AppearancePreference,
	type ThemeId,
	DEFAULT_THEME_ID,
} from "./themes";
export const pushTab = createDelegate<Tab>();
export const popTab = createDelegate<Tab>();
export const forceScreenshot = createDelegate<Tab>();
// import { deserializeAll, serializeAll } from "./serialize";

export let browser: Browser;

export type SerializedBrowser = {
	tabs: SerializedTab[];
	globalhistory: SerializedHistoryState[];
	globalDownloadHistory: DownloadEntry[];
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
				this.tabs[0] || browser.newTab(new URL("puter://newtab"), true);
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
