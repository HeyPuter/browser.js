import { createState, stateListen } from "dreamland/core";
import type { Stateful } from "dreamland/core";
import {
	type AppearancePreference,
	type ThemeId,
	DEFAULT_THEME_ID,
} from "../themes";
import type { AVAILABLE_SEARCH_ENGINES } from "@components/Omnibar/suggestions";
import type { AnimationStyle, IconSet, Roundness, TabStyle } from "../tweaks";
import { Service } from "./Service";

export type Settings = {
	appearance: AppearancePreference;
	tabLayout: "horizontal" | "bottom" | "hybrid" | "vertical" | "compact";
	verticalTabJustify: "left" | "right";
	sidebarWidth: number | null;
	uiProfile: "default" | "compact" | "touch";
	// Style tweaks. Independent axes, each with a build-time configurable
	// default; see ../tweaks.ts.
	roundness: Roundness;
	tabStyle: TabStyle;
	iconSet: IconSet;
	animations: AnimationStyle;
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

export type TabLayoutMode = Settings["tabLayout"];

const DEFAULT_SETTINGS: Settings = {
	appearance: "system",
	tabLayout: "horizontal",
	verticalTabJustify: "left",
	sidebarWidth: null,
	uiProfile: "default",
	// Baked in at build time from the VITE_TWEAK_* environment variables.
	...__DEFAULT_TWEAKS__,
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
		tabLayout: "horizontal" | "bottom" | "hybrid" | "vertical" | "compact";
		verticalTabJustify: "left" | "right";
		sidebarWidth: number | null;
		themeId: ThemeId;
		uiProfile: "default" | "compact" | "touch";
		roundness: Roundness;
		tabStyle: TabStyle;
		iconSet: IconSet;
		animations: AnimationStyle;
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
			// Spread over the defaults so settings added after a profile was last
			// written come up with their default value instead of `undefined`.
			this.settings = createState({ ...DEFAULT_SETTINGS, ...data.settings });
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
				tabLayout: this.settings.tabLayout,
				verticalTabJustify: this.settings.verticalTabJustify,
				sidebarWidth: this.settings.sidebarWidth,
				themeId: this.settings.themeId,
				uiProfile: this.settings.uiProfile,
				roundness: this.settings.roundness,
				tabStyle: this.settings.tabStyle,
				iconSet: this.settings.iconSet,
				animations: this.settings.animations,
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
