import { createDelegate } from "dreamland/core";
import { Tab, type SerializedTab } from "../Tab/Tab.tsx";
import { Service } from "./Service.ts";
import { INTERNAL_URL_PROTOCOL } from "../consts.ts";
import { resolveNavigation } from "../components/Omnibar/navigation";
import { puterBranding, isPuter, openUrl, settingsService } from "../index.ts";
import { focusOmnibox } from "@components/Omnibar/Omnibox.tsx";
import { uuid } from "../util";
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

	constructor(data: TabServiceState | null) {
		super();
		const restoreSession = settingsService.settings.startupPage !== "new-tab";
		for (const saved of data?.tabs ?? []) {
			if (!restoreSession && !saved.pinned) continue;
			try {
				const tab = Tab.deserialize(saved);
				this.own(tab);
				this.tabs.push(tab);
			} catch (error) {
				console.warn("Could not restore tab", error);
			}
		}
		if (this.tabs.length === 0 || !restoreSession) {
			const tab = new Tab({});
			this.own(tab);
			this.tabs.push(tab);
		}
		this.tabs = [
			...this.tabs.filter((tab) => tab.pinned),
			...this.tabs.filter((tab) => !tab.pinned),
		];
		this.activetab = restoreSession
			? (this.tabs.find((tab) => tab.id === data?.activetab) ?? this.tabs[0])
			: this.tabs[this.tabs.length - 1];
		for (const tab of this.tabs) {
			mountedPromise.then(() => {
				pushTab(tab);
			});
		}

		if (puterBranding) {
			if (
				openUrl &&
				URL.canParse(openUrl) &&
				document.referrer === "https://developer.puter.com/"
			) {
				const url = new URL(openUrl);
				const foundTab = this.tabs.find((tab) => tab.url.href === url.href);
				if (foundTab) {
					this.activetab = foundTab;
				} else {
					mountedPromise.then(() => {
						this.newTab(url);
					});
				}
			}
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

	newTab(url?: URL, focusomnibox: boolean = false) {
		let tab = new Tab({ url });
		this.own(tab);
		pushTab(tab);
		this.tabs = [...this.tabs, tab];
		this.activetab = tab;
		if (focusomnibox) focusOmnibox();
		this.markDirty();
		return tab;
	}

	newTabRight(ref: Tab, url?: URL) {
		let tab = new Tab({ url });
		this.own(tab);
		pushTab(tab);
		let index = this.tabs.indexOf(ref);
		this.tabs.splice(index + 1, 0, tab);
		this.tabs = this.tabs;
		this.activetab = tab;
		this.markDirty();
		return tab;
	}

	closeTabsToRight(ref: Tab) {
		let index = this.tabs.indexOf(ref);
		let toClose = this.tabs.slice(index + 1);
		toClose.forEach((tab) => {
			this.destroyTab(tab);
		});
	}

	closeOtherTabs(ref: Tab) {
		let toClose = this.tabs.filter((tab) => tab !== ref);
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

	pinTab(tab: Tab) {
		let index = this.tabs.indexOf(tab);
		tab.pinned = true;
		this.tabs.splice(index, 1);
		// @ts-ignore
		const lastPinnedIdx = this.tabs.findLastIndex((t: Tab) => t.pinned);
		const newidx = lastPinnedIdx === -1 ? 0 : lastPinnedIdx + 1;
		this.tabs.splice(newidx, 0, tab);
		this.tabs = this.tabs;
		this.markDirty();
	}

	unpinTab(tab: Tab) {
		let index = this.tabs.indexOf(tab);
		tab.pinned = false;
		this.tabs.splice(index, 1);
		// @ts-ignore
		const lastPinnedIdx = this.tabs.findLastIndex((t: Tab) => t.pinned);
		const newidx = lastPinnedIdx === -1 ? 0 : lastPinnedIdx + 1;
		this.tabs.splice(newidx, 0, tab);
		this.tabs = this.tabs;
		this.markDirty();
	}

	searchNavigate(input: string) {
		const url = resolveNavigation(
			input,
			settingsService.settings.defaultSearchEngine
		);
		if (url) this.activetab.pushNavigate(url);
	}
}
