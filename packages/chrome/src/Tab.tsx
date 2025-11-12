import { createDelegate, createState } from "dreamland/core";
import { StatefulClass } from "./StatefulClass";
import { browser } from "./Browser";
import { History, type SerializedHistory } from "./History";
import { NewTabPage } from "./pages/NewTabPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { AboutPage } from "./pages/AboutPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { ProxyFrame } from "./proxy/ProxyFrame";
import { defaultFaviconUrl } from "./assets/favicon";

const requestInspectElement = createDelegate<[HTMLElement, Tab]>();

export type SerializedTab = {
	id: number;
	title: string | null;
	history: SerializedHistory;
};

let idcnt = 100;
export class Tab extends StatefulClass {
	title: string | null;
	frame: ProxyFrame;
	devtoolsFrame: any;
	screenshot: string | null = null;

	icon: string | null;
	justCreated: boolean = true;

	history: History;

	canGoForward: boolean = false;
	canGoBack: boolean = false;

	internalpage: HTMLElement | null;

	devtoolsOpen: boolean = false;
	devtoolsWidth = 200;

	loadProgress: number = 0;
	loadProgressTarget: number = 0;

	sendToChobitsu: ((message: string) => void) | null = null;
	onChobitsuMessage: ((message: string) => void) | null = null;
	waitForChobitsuInit: Promise<void>;

	constructor(
		public url: URL = new URL("puter://newtab"),
		public id = idcnt++
	) {
		super(createState(Object.create(Tab.prototype)));
		if (id >= idcnt) idcnt = id + 1;

		this.title = null;
		this.internalpage = null;

		this.frame = new ProxyFrame();

		this.history = new History(this);
		this.history.push(this.url, undefined);

		this.icon = null;

		let resolver: () => void;
		this.waitForChobitsuInit = new Promise((resolve) => {
			resolver = resolve;
		});

		// addHistoryListeners(frame, this);
		let injected = false;

		this.loadProgress = 0;
		this.loadProgressTarget = 0;
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

		// frame.addEventListener("contextInit", (ctx) => {
		// 	injectContextMenu(ctx.client, this);
		// 	injectWindowFill(ctx.client, this);
		// 	injectAnchorHandler(ctx.client, this);

		// 	// make sure it's top level, ctxInit calls for all frames too
		// 	if (ctx.window == frame.frame.contentWindow) {
		// 		if (this.history.justTriggeredNavigation) {
		// 			// url bar was typed in, we triggered this navigation, don't push a new state since we already did
		// 			this.history.justTriggeredNavigation = false;
		// 		} else {
		// 			// the page just loaded on its own (a link was clicked, window.location was set)
		// 			this.history.push(ctx.client.url, undefined, false);
		// 		}

		// 		this.loadProgressTarget = 0.2;
		// 		ctx.client.global.addEventListener("load", (e) => {
		// 			if (!e.isTrusted) return;
		// 			finishLoad();
		// 		});
		// 		ctx.client.global.addEventListener("DOMContentLoaded", (e) => {
		// 			if (!e.isTrusted) return;
		// 			this.loadProgressTarget = 0.8;
		// 		});
		// 		setTimeout(() => {
		// 			finishLoad();
		// 		}, 5000); // failsafe 5 seconds in case the page just never fires load for some reason

		// 		injectChobitsu(ctx.client, this, resolver);
		// 		injectTitleWatcher(ctx.client, this);
		// 		injectHistoryEmulation(ctx.client, this);

		// 		use(this.devtoolsOpen).listen((open) => {
		// 			if (!open || injected) return;
		// 			injected = true;
		// 			injectDevtools(ctx.client, this);
		// 		});
		// 	}
		// });

		// this.devtoolsFrame = scramjet.createFrame();
	}

	serialize(): SerializedTab {
		return {
			id: this.id,
			title: this.title,
			history: this.history.serialize(),
		};
	}
	deserialize(de: SerializedTab) {
		// if (de.id >= id) id = de.id + 1;
		// this.id = de.id;
		this.title = de.title;
		this.history.deserialize(de.history);
		this._directnavigate(this.history.states[this.history.index].url);
	}

	// only caller should be history.ts for this
	_directnavigate(url: URL) {
		this.url = url;
		if (url.protocol == "puter:") {
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
					this.internalpage = <SettingsPage tab={this} />;
					break;
				case "downloads":
					this.history.current().title = this.title = "Downloads";
					this.internalpage = <DownloadsPage tab={this} />;
			}
		} else {
			// placeholder title until the page fills in
			this.title = url.href;

			// if (!navigator.serviceWorker.controller) {
			// 	serviceWorkerReady.then(() => {
			this.frame.go(url);
			// 	});
			// } else {
			// this.frame.go(url);
			// }
		}
	}

	initialLoad() {
		this.internalpage = null;
	}

	pushNavigate(url: URL) {
		console.log("pushing");
		this.history.push(url, undefined, true);
	}
	replaceNavigate(url: URL) {
		this.history.replace(url, undefined, true);
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
