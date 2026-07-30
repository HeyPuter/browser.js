import { defineConfig } from "vite";
import path from "path";

import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { jsxPlugin } from "dreamland/vite";
import { resolveDefaultTweaks } from "./src/tweaks";

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
		// Build-time defaults for the UI style tweaks, from the VITE_TWEAK_*
		// environment variables. Validated here so a bad value fails the build;
		// read `__DEFAULT_TWEAKS__` rather than `import.meta.env` so consumers
		// can't skip that validation. See src/tweaks.ts.
		__DEFAULT_TWEAKS__: JSON.stringify(resolveDefaultTweaks(process.env)),
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
