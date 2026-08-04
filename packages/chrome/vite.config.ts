import { defineConfig } from "vite";
import path from "path";

import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { jsxPlugin } from "dreamland/vite";

export default defineConfig({
	plugins: [
		process.env.VITE_SINGLEFILE ? viteSingleFile() : null,
		// cssHmrPlugin(),
		jsxPlugin(),
		// ssr({ entry: "/src/main-server.ts" }),
		// viteStaticCopy({
		// 	structured: false,
		// 	targets: [
		// 		{
		// 			src: scramjetPath + "/*",
		// 			dest: "scram/",
		// 		},
		// 		{
		// 			src: "../inject/dist/inject.js",
		// 			dest: ".",
		// 		},
		// 		// {
		// 		// 	src: "../chii/public/*",
		// 		// 	dest: "chii",
		// 		// },
		// 	],
		// }),
	],
	define: {
		__COPYRIGHT_YEAR__: JSON.stringify(new Date().getFullYear()),
		__DEFAULT_SETTINGS__: {
			appearance: "system",
			tabLayout: "horizontal",
			verticalTabJustify: "left",
			sidebarWidth: null,
			uiProfile: "default",
			themeId: "dark",
			roundness: "balanced",
			tabStyle: "floating",
			iconSet: "ionicons",
			animations: "bouncy",
			startupPage: "continue",
			defaultZoom: 100,
			showBookmarksBar: false,
			defaultSearchEngine: "google",
			searchSuggestionsEnabled: true,
			blockTrackers: true,
			clearHistoryOnExit: false,
			doNotTrack: true,
			extensionsDevMode: false,
		},
	},
	resolve: {
		alias: {
			"@components": path.resolve(__dirname, "./src/components"),
		},
	},
	esbuild: {
		keepNames: true,
	},
	build: {
		sourcemap: true,
	},
});
