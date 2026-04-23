import { createDelegate } from "dreamland/core";
import { Tab, type SerializedTab } from "../Tab/Tab.tsx";
import { Service } from "./Service.ts";
import { INTERNAL_URL_PROTOCOL } from "../consts.ts";
// TODO: centralize this to one place somehow
import * as tldts from "tldts";
import { isPuter } from "../index.ts";
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
		if (data) {
			for (const dt of data.tabs) {
				let tab = Tab.deserialize(dt);
				this.own(tab);
				this.tabs.push(tab);
				mountedPromise.then(() => {
					pushTab(tab);
				});
			}
			this.activetab =
				this.tabs.find((tab) => tab.id === data.activetab) || this.tabs[0];
		} else {
			let tab = new Tab({});
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
