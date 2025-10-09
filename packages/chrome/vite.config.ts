import { defineConfig } from "vite";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";

import { viteSingleFile } from "vite-plugin-singlefile";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
	plugins: [
		process.env.VITE_SINGLEFILE ? viteSingleFile() : null,
		viteStaticCopy({
			structured: false,
			targets: [
				{
					src: scramjetPath + "/*",
					dest: "scram/",
				},
				{
					src: "../inject/dist/inject.js",
					dest: ".",
				},
				// {
				// 	src: "../chii/public/*",
				// 	dest: "chii",
				// },
			],
		}),
	],
});
