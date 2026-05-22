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
import { ProxyFrame } from "../proxy/ProxyFrame";
import { uuid } from "../util";
import { mountedPromise } from "../App";
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
	frame: ProxyFrame;
	devtoolsFrame: any;
	screenshot: string | null = null;

	url: URL;

	id: string;

	icon: string | null = null;
	justCreated: boolean = true;

	history: History;

	canGoForward: boolean = false;
	canGoBack: boolean = false;

	internalpage: HTMLElement | null = null;

	devtoolsOpen: boolean = false;
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

		this.frame = new ProxyFrame();
		this.history = new History(this, history);
		this.own(this.history);
		this.waitForInit = new Promise((resolve) => {
			this.initResolve = resolve;
		});
		mountedPromise.then(() => {
			if (history) {
				// restore from serialized state
				this._directnavigate(this.url);
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
			switch (url.host) {
				case "newtab":
					this.history.current().title = this.title = "New Tab";
					this.internalpage = <NewTabPage tab={this} />;
					break;
				case "playground":
					this.history.current().title = this.title = "Scramjet Playground";
					this.internalpage = <PlaygroundPage tab={this} />;
					break;
				case "history":
					this.history.current().title = this.title = "Browser History";
					this.internalpage = <HistoryPage tab={this}></HistoryPage>;
					break;
				case "version":
					this.history.current().title = this.title = "About Version";
					this.internalpage = <AboutPage tab={this} />;
					break;
				case "settings":
					this.history.current().title = this.title = "Settings";
					this.internalpage = (
						<SettingsPage
							tab={this}
							selected={
								url.pathname.length > 1 ? url.pathname.slice(1) : "general"
							}
						/>
					);
					break;
				case "downloads":
					this.history.current().title = this.title = "Downloads";
					this.internalpage = <DownloadsPage tab={this} />;
			}
		} else {
			// placeholder title until the page fills in
			this.history.current().title = this.title = url.href;

			// if (!navigator.serviceWorker.controller) {
			// 	serviceWorkerReady.then(() => {
			console.warn("navigating to", url);
			this.frame.go(url);
			// 	});
			// } else {
			// this.frame.go(url);
			// }
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
			this.frame.reload();
		}
	}
}
