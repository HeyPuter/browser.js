import { createState, stateListen } from "dreamland/core";
import type { Stateful } from "dreamland/core";
import type { AppearancePreference, ThemeId } from "../themes";
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
		this.settings = createState(data ? data.settings : __DEFAULT_SETTINGS__);
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
