import { defineConfig } from "vite";

import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { cssHmrPlugin, ssr, jsxPlugin } from "dreamland/vite";

export default defineConfig({
	plugins: [
		process.env.VITE_SINGLEFILE ? viteSingleFile() : null,
		cssHmrPlugin(),
		jsxPlugin(),
		ssr({ entry: "/src/main-server.ts" }),
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
