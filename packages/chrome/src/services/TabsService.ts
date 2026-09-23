import { createDelegate } from "dreamland/core";
import { Tab, type SerializedTab } from "../Tab/Tab.tsx";
import { Service } from "./Service.ts";
import { resolveNavigation } from "../components/Omnibar/navigation";
import { puterBranding, isPuter, openUrl, settingsService } from "../index.ts";
import { focusOmnibox } from "@components/Omnibar/Omnibox.tsx";
import { uuid } from "../util";
import { mountedPromise } from "../App.tsx";

export const pushTab = createDelegate<Tab>();
export const popTab = createDelegate<Tab>();

type ClosedTab = { tab: SerializedTab; index: number };
const MAX_CLOSED_TABS = 25;

export type TabServiceState = {
	tabs: SerializedTab[];
	activetab: string;
	closedTabs?: ClosedTab[];
};

export class TabsService extends Service {
	tabs: Tab[] = [];
	activetab: Tab;
	closedTabs: ClosedTab[] = [];

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
		this.closedTabs = data?.closedTabs?.slice(-MAX_CLOSED_TABS) ?? [];
		for (const tab of this.tabs) {
			mountedPromise.then(() => {
				if (this.tabs.includes(tab)) pushTab(tab);
			});
		}

		use(this.activetab)
			.constrain(this)
			.listen(() => this.markDirty());

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
			closedTabs: this.closedTabs,
		};
	}
	static deserialize(data: TabServiceState): TabsService {
		return new TabsService(data);
	}

	private insertTab(tab: Tab, index: number, active = true) {
		this.own(tab);
		const pinnedCount = this.tabs.filter((t) => t.pinned).length;
		index = tab.pinned
			? Math.max(0, Math.min(index, pinnedCount))
			: Math.max(pinnedCount, Math.min(index, this.tabs.length));
		this.tabs = [...this.tabs.slice(0, index), tab, ...this.tabs.slice(index)];
		pushTab(tab);
		if (active) this.activetab = tab;
		this.markDirty();
		return tab;
	}

	newTab(url?: URL, focusomnibox = false, active = true) {
		const tab = this.insertTab(new Tab({ url }), this.tabs.length, active);
		if (active && focusomnibox) focusOmnibox();
		return tab;
	}

	newTabRight(ref: Tab, url?: URL, active = true) {
		const index = this.tabs.indexOf(ref);
		return this.insertTab(
			new Tab({ url }),
			index < 0 ? this.tabs.length : index + 1,
			active
		);
	}

	duplicateTab(ref: Tab) {
		if (!this.tabs.includes(ref)) return;
		const saved = structuredClone(ref.serialize());
		saved.id = uuid("tab-");
		return this.insertTab(Tab.deserialize(saved), this.tabs.indexOf(ref) + 1);
	}

	reopenClosedTab() {
		const closed = this.closedTabs.at(-1);
		if (!closed) return;
		const saved = structuredClone(closed.tab);
		saved.id = uuid("tab-");
		const tab = Tab.deserialize(saved);
		this.closedTabs = this.closedTabs.slice(0, -1);
		return this.insertTab(tab, closed.index);
	}

	closeTabsToRight(ref: Tab) {
		const index = this.tabs.indexOf(ref);
		if (index < 0) return;
		this.tabs
			.slice(index + 1)
			.filter((tab) => !tab.pinned)
			.reverse()
			.forEach((tab) => this.destroyTab(tab));
	}

	closeOtherTabs(ref: Tab) {
		if (!this.tabs.includes(ref)) return;
		this.tabs
			.filter((tab) => tab !== ref && !tab.pinned)
			.reverse()
			.forEach((tab) => this.destroyTab(tab));
	}

	destroyTab(tab: Tab) {
		const index = this.tabs.indexOf(tab);
		if (index < 0) return;
		this.closedTabs = [
			...this.closedTabs,
			{ tab: structuredClone(tab.serialize()), index },
		].slice(-MAX_CLOSED_TABS);
		this.disown(tab);
		const wasLastTab = this.tabs.length === 1;
		this.tabs = this.tabs.filter((t) => t !== tab);
		if (this.activetab === tab) {
			// Chromium prefers the tab to the right, then the tab to the left,
			// when there is no opener relationship to restore.
			this.activetab =
				this.tabs[index] ??
				this.tabs[index - 1] ??
				this.newTab(undefined, true);
		}
		tab.dispose();
		popTab(tab);
		this.markDirty();
		if (wasLastTab && isPuter) puter.exit();
	}

	moveTab(tab: Tab, index: number) {
		const from = this.tabs.indexOf(tab);
		if (from < 0 || !Number.isInteger(index)) return;
		const tabs = this.tabs.filter((t) => t !== tab);
		const pinnedCount = tabs.filter((t) => t.pinned).length;
		index = tab.pinned
			? Math.max(0, Math.min(index, pinnedCount))
			: Math.max(pinnedCount, Math.min(index, tabs.length));
		tabs.splice(index, 0, tab);
		this.tabs = tabs;
		this.markDirty();
	}

	pinTab(tab: Tab) {
		if (!this.tabs.includes(tab) || tab.pinned) return;
		tab.pinned = true;
		this.moveTab(tab, this.tabs.filter((t) => t.pinned).length - 1);
	}

	unpinTab(tab: Tab) {
		if (!this.tabs.includes(tab) || !tab.pinned) return;
		tab.pinned = false;
		this.moveTab(tab, this.tabs.filter((t) => t.pinned).length);
	}

	searchNavigate(input: string) {
		const url = resolveNavigation(
			input,
			settingsService.settings.defaultSearchEngine
		);
		if (url) this.activetab.pushNavigate(url);
	}
}
