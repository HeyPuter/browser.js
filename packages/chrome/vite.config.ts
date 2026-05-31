import path from "node:path";
import { defineConfig } from "vite";
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
		// 	targets: [
		// 		{
		// 			src: scramjetPath + "/*",
		// 			dest: "scram/",
		// 			rename: {stripBase: true},
		// 		},
		// 		{
		// 			src: "../inject/dist/inject.js",
		// 			dest: ".",
		// 			rename: {stripBase: true},
		// 		},
		// 		// {
		// 		// 	src: "../chii/public/*",
		// 		// 	dest: "chii",
		//			rename: {stripBase: true},
		// 		// },
		// 	],
		// }),
	],
	define: {
		__COPYRIGHT_YEAR__: JSON.stringify(new Date().getFullYear()),
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
