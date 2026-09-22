import { settingsService } from "..";
import { Service } from "./Service";
import { HistoryState } from "../Tab/History";
import { CookieJar } from "@mercuryworkshop/scramjet/bundled";
import { StatefulClass } from "../util/StatefulClass";
import type { SerializedHistoryState } from "../Tab/History";

export type ProfileServiceState = {
	globalhistory: SerializedHistoryState[];
	bookmarks: SerializedBookmarkEntry[];
	cookies: string;
};

export type SerializedBookmarkEntry = {
	url: string;
	title: string;
};

export class BookmarkEntry extends StatefulClass {
	url!: URL;
	title!: string;

	constructor(partial?: Partial<BookmarkEntry>) {
		super();
		Object.assign(this, partial);
		this.url = new URL(this.url);
		this.autodirty();
	}

	serialize(): SerializedBookmarkEntry {
		return {
			url: this.url.href,
			title: this.title,
		};
	}
	static deserialize(data: SerializedBookmarkEntry): BookmarkEntry {
		return new BookmarkEntry({
			url: new URL(data.url),
			title: data.title,
		});
	}
}

export class ProfileService extends Service {
	globalhistory: HistoryState[];
	bookmarks: BookmarkEntry[];
	cookieJar: CookieJar;

	constructor(data: ProfileServiceState | null) {
		super();
		this.cookieJar = new CookieJar();
		if (data) {
			this.cookieJar.load(data.cookies);
			this.globalhistory = (
				settingsService.settings.clearHistoryOnExit ? [] : data.globalhistory
			).map((state) => HistoryState.deserialize(state));
			this.bookmarks = data.bookmarks.map((bookmark) =>
				BookmarkEntry.deserialize(bookmark)
			);
		} else {
			this.globalhistory = [];
			this.bookmarks = [
				new BookmarkEntry({
					title: "Google",
					url: new URL("https://www.google.com"),
				}),
				new BookmarkEntry({
					title: "YouTube",
					url: new URL("https://www.youtube.com"),
				}),
				new BookmarkEntry({
					title: "Puter Developers",
					url: new URL("https://developer.puter.com"),
				}),
			];
		}
		for (const entry of [...this.globalhistory, ...this.bookmarks])
			this.own(entry);
		// Service listeners need an owner to survive garbage collection.
		use(this.globalhistory)
			.constrain(this)
			.listen(() => this.markDirty());
		use(this.bookmarks)
			.constrain(this)
			.listen(() => this.markDirty());
		use(settingsService.settings.clearHistoryOnExit)
			.constrain(this)
			.listen(() => this.markDirty());
	}

	saveBookmark(bookmark: BookmarkEntry, title: string, url: URL) {
		bookmark.title = title.trim() || url.href;
		bookmark.url = new URL(url);
		this.own(bookmark);
		this.bookmarks = this.bookmarks.includes(bookmark)
			? [...this.bookmarks]
			: [bookmark, ...this.bookmarks];
	}

	removeBookmark(bookmark: BookmarkEntry) {
		this.disown(bookmark);
		this.bookmarks = this.bookmarks.filter((entry) => entry !== bookmark);
	}

	removeHistoryEntry(entry: HistoryState) {
		this.disown(entry);
		this.globalhistory = this.globalhistory.filter((item) => item !== entry);
	}

	clearHistory() {
		for (const entry of this.globalhistory) this.disown(entry);
		this.globalhistory = [];
	}

	serialize(): ProfileServiceState {
		return {
			globalhistory: this.globalhistory.map((state) => state.serialize()),
			bookmarks: this.bookmarks.map((bookmark) => bookmark.serialize()),
			cookies: this.cookieJar.dump(),
		};
	}

	save(): ProfileServiceState {
		const data = this.serialize();
		if (settingsService.settings.clearHistoryOnExit) data.globalhistory = [];
		return data;
	}
}
