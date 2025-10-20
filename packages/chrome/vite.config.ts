import { defineConfig } from "vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";

import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { cssHmrPlugin, devSsr, jsxPlugin } from "dreamland/vite";

export default defineConfig({
	plugins: [
		process.env.VITE_SINGLEFILE ? viteSingleFile() : null,
		cssHmrPlugin(),
		devSsr({ entry: "/src/main-server.ts" }),
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
});
