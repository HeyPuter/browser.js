import { createDelegate } from "dreamland/core";
import { Tab, type SerializedTab } from "../Tab/Tab.tsx";
import { Service } from "./Service.ts";
import { INTERNAL_URL_PROTOCOL } from "../consts.ts";
// TODO: centralize this to one place somehow
import * as tldts from "tldts";
import { isPuter } from "../index.ts";
import { focusOmnibox } from "@components/Omnibar/Omnibox.tsx";
import { mountedPromise } from "../App.tsx";

export const pushTab = createDelegate<Tab>();
export const popTab = createDelegate<Tab>();

export type TabServiceState = {
	tabs: SerializedTab[];
	activetab: string;
};

export class TabsService extends Service {
	tabs: Tab[] = [];
	activetab: Tab;

	private partitionPinnedTabs<T extends { pinned: boolean }>(tabs: T[]) {
		const pinned: T[] = [];
		const regular: T[] = [];

		for (const tab of tabs) {
			(tab.pinned ? pinned : regular).push(tab);
		}

		return [...pinned, ...regular];
	}

	private normalizeTabOrder() {
		const nextTabs = this.partitionPinnedTabs(this.tabs);
		const changed = nextTabs.some((tab, index) => this.tabs[index] !== tab);

		if (changed) {
			this.tabs = nextTabs;
		}

		return changed;
	}

	private watchTab(tab: Tab) {
		use(tab.pinned)
			.constrain(this)
			.listen(() => {
				this.normalizeTabOrder();
				this.markDirty();
			});
	}

	constructor(data: TabServiceState | null) {
		super();
		if (data) {
			for (const dt of this.partitionPinnedTabs(data.tabs)) {
				const tab = Tab.deserialize(dt);
				this.watchTab(tab);
				this.own(tab);
				this.tabs.push(tab);
				mountedPromise.then(() => {
					pushTab(tab);
				});
			}
			this.activetab =
				this.tabs.find((tab) => tab.id === data.activetab) || this.tabs[0];
			if (this.normalizeTabOrder()) {
				this.markDirty();
			}
		} else {
			const tab = new Tab({});
			this.watchTab(tab);
			this.own(tab);
			this.tabs.push(tab);
			this.activetab = tab;
			mountedPromise.then(() => {
				pushTab(tab);
			});
		}
	}

	save(): TabServiceState {
		return {
			tabs: this.tabs.map((tab) => tab.serialize()),
			activetab: this.activetab.id,
		};
	}
	static deserialize(data: TabServiceState): TabsService {
		return new TabsService(data);
	}

	setTabPinned(tab: Tab, pinned: boolean) {
		if (tab.pinned === pinned) return;
		tab.pinned = pinned;
	}

	newTab(url?: URL, focusomnibox: boolean = false) {
		const tab = new Tab({ url });
		this.watchTab(tab);
		this.own(tab);
		pushTab(tab);
		this.tabs = [...this.tabs, tab];
		this.activetab = tab;
		if (focusomnibox) focusOmnibox();
		this.markDirty();
		return tab;
	}

	newTabRight(ref: Tab, url?: URL) {
		const tab = new Tab({ url });
		this.watchTab(tab);
		this.own(tab);
		pushTab(tab);
		let index = ref.pinned
			? this.tabs.findIndex((tab) => !tab.pinned)
			: this.tabs.indexOf(ref) + 1;
		if (index === -1) {
			index = this.tabs.length;
		}
		this.tabs.splice(index, 0, tab);
		this.tabs = [...this.tabs];
		this.activetab = tab;
		this.markDirty();
		return tab;
	}

	reorderTabs(nextTabs: Tab[]) {
		if (nextTabs.length !== this.tabs.length) return;

		const currentIds = new Set(this.tabs.map((tab) => tab.id));
		if (nextTabs.some((tab) => !currentIds.has(tab.id))) return;

		const orderedTabs = this.partitionPinnedTabs(nextTabs);
		const changed = orderedTabs.some((tab, index) => this.tabs[index] !== tab);
		if (!changed) return;

		this.tabs = [...orderedTabs];
		this.markDirty();
	}

	closeTabsToRight(ref: Tab) {
		const index = this.tabs.indexOf(ref);
		const toClose = this.tabs.slice(index + 1);
		toClose.forEach((tab) => {
			this.destroyTab(tab);
		});
	}

	closeOtherTabs(ref: Tab) {
		const toClose = this.tabs.filter((tab) => tab !== ref);
		toClose.forEach((tab) => {
			this.destroyTab(tab);
		});
	}

	destroyTab(tab: Tab) {
		this.disown(tab);
		this.tabs = this.tabs.filter((t) => t !== tab);
		if (this.tabs.length === 0 && isPuter) {
			puter.exit();
		}

		if (this.activetab === tab) {
			this.activetab =
				this.tabs[0] ||
				this.newTab(new URL(`${INTERNAL_URL_PROTOCOL}//newtab`), true);
		}
		popTab(tab);
		this.markDirty();
	}

	searchNavigate(url: string) {
		function validTld(_hostname: string) {
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
			const fullurl = new URL("https://" + url);
			this.activetab.pushNavigate(fullurl);
		} else {
			const search = `https://google.com/search?q=${encodeURIComponent(url)}`;
			this.activetab.pushNavigate(new URL(search));
		}
	}
}
