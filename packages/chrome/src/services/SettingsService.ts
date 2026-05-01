import { createState, stateListen } from "dreamland/core";
import type { Stateful } from "dreamland/core";
import {
	type AppearancePreference,
	type ThemeId,
	DEFAULT_THEME_ID,
} from "../themes";
import type { AVAILABLE_SEARCH_ENGINES } from "@components/Omnibar/suggestions";
import { Service } from "./Service";

export type Settings = {
	appearance: AppearancePreference;
	uiProfile: "default" | "compact" | "touch";
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

const DEFAULT_SETTINGS: Settings = {
	appearance: "system",
	uiProfile: "default",
	themeId: DEFAULT_THEME_ID,
	startupPage: "continue",
	defaultZoom: 100,
	showBookmarksBar: false,
	defaultSearchEngine: "google",
	searchSuggestionsEnabled: true,
	blockTrackers: true,
	clearHistoryOnExit: false,
	doNotTrack: true,
	extensionsDevMode: false,
};

export type SettingsServiceState = {
	settings: {
		appearance: AppearancePreference;
		themeId: ThemeId;
		uiProfile: "default" | "compact" | "touch";
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
};

export class SettingsService extends Service {
	public settings: Stateful<Settings>;

	constructor(data: SettingsServiceState | null) {
		super();
		if (data) {
			this.settings = createState(data.settings);
		} else {
			this.settings = createState(DEFAULT_SETTINGS);
		}
		let oldvalues: Map<any, any> = new Map();
		stateListen(this.settings, (newvalue, prop) => {
			if (oldvalues.get(prop) === newvalue) return;
			this.markDirty();
			oldvalues.set(prop, newvalue);
		});
	}

	save(): SettingsServiceState {
		return {
			settings: {
				appearance: this.settings.appearance,
				themeId: this.settings.themeId,
				uiProfile: this.settings.uiProfile,
				startupPage: this.settings.startupPage,
				defaultZoom: this.settings.defaultZoom,
				showBookmarksBar: this.settings.showBookmarksBar,
				defaultSearchEngine: this.settings.defaultSearchEngine,
				searchSuggestionsEnabled: this.settings.searchSuggestionsEnabled,
				blockTrackers: this.settings.blockTrackers,
				clearHistoryOnExit: this.settings.clearHistoryOnExit,
				doNotTrack: this.settings.doNotTrack,
				extensionsDevMode: this.settings.extensionsDevMode,
			},
		};
	}
}
