import { createDelegate, createState } from "dreamland/core";
import { StatefulClass } from "../util/StatefulClass";
import { History, type SerializedHistory } from "./History";
import { INTERNAL_URL_PROTOCOL } from "../consts";
import { NewTabPage } from "../pages/NewTabPage";
import { PlaygroundPage } from "../pages/PlaygroundPage";
import { AboutPage } from "../pages/AboutPage";
import { HistoryPage } from "../pages/HistoryPage";
import { SettingsPage } from "../pages/SettingsPage";
import { DownloadsPage } from "../pages/DownloadsPage";
import { uuid } from "../util";
import { mountedPromise } from "../App";
import { tabsService } from "..";
import { CDPConnection } from "../CDP";
import { TabSession } from "./TabSession";
// const requestInspectElement = createDelegate<[HTMLElement, Tab]>();

export type SerializedTab = {
	title: string | null;
	url: string;
	id: string;
	icon: string | null;
	history: SerializedHistory;
};

export class Tab extends StatefulClass {
	title: string | null = null;
	session: TabSession;
	screenshot: string | null = null;

	url: URL;

	id: string;

	icon: string | null = null;
	justCreated: boolean = true;

	history: History;

	canGoForward: boolean = false;
	canGoBack: boolean = false;

	internalpage: HTMLElement | null = null;

	devtoolsOpen: boolean = true;
	devtoolsWidth = 200;

	loadProgress: number = 0;
	loadProgressTarget: number = 0;

	sendToChobitsu: ((message: string) => void) | null = null;
	onChobitsuMessage: ((message: string) => void) | null = null;
	waitForInit: Promise<void>;
	private initResolve!: () => void;

	constructor(init: Partial<Tab>, history?: SerializedHistory) {
		super();
		Object.assign(this, init);
		this.url ??= new URL(`${INTERNAL_URL_PROTOCOL}//newtab`);
		this.id ??= uuid("tab-");

		this.waitForInit = new Promise((resolve) => {
			this.initResolve = resolve;
		});
		this.session = new TabSession(this, this.id);
		this.history = new History(this, history);
		this.own(this.history);
		mountedPromise.then(() => {
			if (history) {
				// restore from serialized state

				if (
					this.url.protocol == INTERNAL_URL_PROTOCOL ||
					tabsService.activetab === this
				) {
					this._directnavigate(this.url);
				} else {
					// wait for this tab to become active
					let ptr = use(tabsService.activetab).constrain(this);
					let activated = false;
					ptr.listen((tab) => {
						if (tab === this && !activated) {
							this._directnavigate(this.url);
							ptr.unconstrain(this);
							activated = true;
						}
					});
				}
			} else {
				// was just created
				this.history.push(this.url, undefined);
			}
		});

		const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
		const finishLoad = () => {
			this.loadProgress = 1;
			setTimeout(() => {
				this.loadProgress = 0;
				this.loadProgressTarget = 0;
			}, 250);
		};
		setInterval(() => {
			if (this.loadProgress < this.loadProgressTarget) {
				this.loadProgress = lerp(
					this.loadProgress,
					this.loadProgressTarget,
					0.01
				);
				if (Math.abs(this.loadProgress - this.loadProgressTarget) < 0.01) {
					this.loadProgress = this.loadProgressTarget;
				}
			}
		}, 16);
	}

	serialize(): SerializedTab {
		return {
			title: this.title,
			url: this.url.href,
			id: this.id,
			icon: this.icon,
			history: this.history.serialize(),
		};
	}
	static deserialize(data: SerializedTab): Tab {
		return new Tab(
			{
				title: data.title,
				url: new URL(data.url),
				id: data.id,
				icon: data.icon,
			},
			data.history
		);
	}

	// only caller should be history.ts for this
	_directnavigate(url: URL) {
		this.url = url;
		this.icon = "/defaultfavicon.png";
		if (url.protocol == INTERNAL_URL_PROTOCOL) {
			this.icon = null;
			this.history.current().favicon = "/icon.png";
			const page = createInternalPage(url, this);
			if (page) {
				this.internalpage = page.page;
				this.history.current().title = this.title = page.title;
			} else {
				// TODO: make this better
				this.internalpage = (
					<div style={{ padding: "20px" }}>
						<h1>404 Not Found</h1>
						<p>No internal page found for {url.href}</p>
					</div>
				);
				this.history.current().title = this.title = "404 Not Found";
			}
		} else {
			// placeholder title until the page fills in
			this.history.current().title = this.title = url.href;

			console.warn("navigating to", url);
			this.session.go(url);
		}
	}

	initialLoad() {
		this.initResolve();
		this.internalpage = null;
	}

	pushNavigate(url: URL) {
		this.history.push(url, null, null, true, false);
	}
	replaceNavigate(url: URL) {
		this.history.replace(url, null, true);
	}

	back() {
		if (this.canGoBack) {
			this.history.go(-1);
		}
	}
	forward() {
		if (this.canGoForward) {
			this.history.go(1);
		}
	}
	reload() {
		if (this.internalpage) {
			this._directnavigate(this.url);
		} else {
			this.session.reload();
		}
	}
}

function createInternalPage(
	url: URL,
	tab: Tab
): { title: string; page: HTMLElement } | null {
	switch (url.host) {
		case "newtab":
			return {
				title: "New Tab",
				page: <NewTabPage tab={tab} />,
			};
		case "playground":
			return {
				title: "Scramjet Playground",
				page: <PlaygroundPage tab={tab} />,
			};
		case "history":
			return {
				title: "Browser History",
				page: <HistoryPage tab={tab} />,
			};
		case "version":
			return {
				title: "About Version",
				page: <AboutPage tab={tab} />,
			};
		case "settings":
			return {
				title: "Settings",
				page: (
					<SettingsPage
						tab={tab}
						selected={
							url.pathname.length > 1 ? url.pathname.slice(1) : "general"
						}
					></SettingsPage>
				),
			};
		case "downloads":
			return {
				title: "Downloads",
				page: <DownloadsPage tab={tab} />,
			};
		default:
			return null;
	}
}
