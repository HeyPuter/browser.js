import { createState } from "dreamland/core";
import { StatefulClass } from "../../src/util/StatefulClass.ts";

export const profileService = Object.assign(new StatefulClass(), {
	globalhistory: [],
	bookmarks: [],
});
export const settingsService = {
	settings: createState({
		defaultSearchEngine: "google",
		searchSuggestionsEnabled: true,
	}),
};
export const isPuter = false;
export const puterBranding = false;
export const openUrl = "";
