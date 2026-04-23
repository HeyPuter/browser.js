import { StatefulClass } from "../util/StatefulClass";
import type { Tab } from "./Tab";
import { INTERNAL_URL_PROTOCOL } from "../consts";
import { profileService } from "..";

export type SerializedHistoryState = {
	state: any;
	url: string;
	title: string | null;
	favicon: string | null;
	timestamp: number;
};

// history api emulation
export class HistoryState extends StatefulClass {
	url: URL = null!;
	state: any;
	title: string | null = null;
	favicon: string | null = null;
	timestamp: number;

	virtual: boolean = false; // whether this state was created by pushState and can be navigated to without a full reload

	constructor(partial?: Partial<HistoryState>) {
		super();
		Object.assign(this, partial);
		this.timestamp = Date.now();
		this.autodirty();
	}

	serialize(): SerializedHistoryState {
		return {
			url: this.url.href,
			title: this.title,
			state: this.state,
			favicon: this.favicon,
			timestamp: this.timestamp,
		};
	}
	static deserialize(data: SerializedHistoryState): HistoryState {
		return new HistoryState({
			url: new URL(data.url),
			state: data.state,
			title: data.title,
			favicon: data.favicon,
			timestamp: data.timestamp,
		});
	}
}

export type SerializedHistory = {
	index: number;
	states: SerializedHistoryState[];
};

export class History extends StatefulClass {
	index: number = -1;
	states: HistoryState[] = [];
	justTriggeredNavigation: boolean = false;

	constructor(
		private tab: Tab,
		data?: SerializedHistory
	) {
		super();
		if (data) {
			this.index = data.index;
			this.states = data.states.map((state) => HistoryState.deserialize(state));
		}
	}
	serialize(): SerializedHistory {
		return {
			index: this.index,
			states: this.states.map((state) => state.serialize()),
		};
	}

	current(): HistoryState {
		if (this.index < 0 || this.index >= this.states.length) {
			throw new Error("No current history state");
		}

		return this.states[this.index];
	}

	push(
		url: URL,
		title: string | null = null,
		state: any = null,
		navigate: boolean = true,
		virtual: boolean = false
	): HistoryState {
		if (this.index + 1 < this.states.length) {
			// disown states we're removing
			this.states.slice(this.index + 1).forEach((state) => this.disown(state));

			// "fork" history tree, creating a new timeline
			this.states.splice(this.index, this.states.length - this.index);
		}
		const hstate = new HistoryState({ url, state, title });
		if (virtual) hstate.virtual = true;

		if (url.href != `${INTERNAL_URL_PROTOCOL}//newtab`)
			profileService.globalhistory = [...profileService.globalhistory, hstate];
		this.states.push(hstate);
		this.own(hstate);
		this.index++;

		if (navigate) {
			this.justTriggeredNavigation = true;
			this.tab._directnavigate(url);
		} else this.tab.url = url;

		this.tab.canGoBack = this.canGoBack();
		this.tab.canGoForward = this.canGoForward();

		this.markDirty();
		return this.states[this.index];
	}
	replace(
		url: URL,
		title: string | null,
		state: any,
		navigate: boolean = true
	): HistoryState {
		if (this.index < this.states.length) {
			this.current().url = url;
			this.current().state = state;
			this.current().title = title;
			this.current().favicon = null;
		} else {
			return this.push(url, state);
		}

		if (navigate) {
			this.justTriggeredNavigation = true;
			this.tab._directnavigate(url);
		}

		this.tab.canGoBack = this.canGoBack();
		this.tab.canGoForward = this.canGoForward();

		this.markDirty();
		return this.states[this.index];
	}
	go(delta: number, navigate: boolean = true): HistoryState {
		const current = this.current();
		this.index += delta;
		if (this.index < 0) {
			this.index = 0;
		} else if (this.index >= this.states.length) {
			this.index = this.states.length - 1;
		}

		let newstate = this.states[this.index];

		if (current.virtual) {
			// sendFrame(this.tab, "popstate", {
			// 	state: newstate.state,
			// 	url: newstate.url.href,
			// 	title: newstate.title || "",
			// });
		} else if (navigate) {
			this.justTriggeredNavigation = true;
			this.tab._directnavigate(newstate.url);
		}

		if (newstate.virtual || !navigate) {
			this.tab.url = newstate.url;
			this.tab.title = newstate.title;
			this.tab.icon = newstate.favicon;
		}

		this.tab.canGoBack = this.canGoBack();
		this.tab.canGoForward = this.canGoForward();

		this.markDirty();
		return newstate;
	}
	canGoBack(): boolean {
		return this.index > 0;
	}
	canGoForward(): boolean {
		return this.index < this.states.length - 1;
	}
}
