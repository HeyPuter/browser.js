import { defineConfig } from "@rspack/cli";
import { rspack } from "@rspack/core";
import { RsdoctorRspackPlugin } from "@rsdoctor/rspack-plugin";

import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import scramjetConfig, { tsloader } from "./packages/scramjet/rspack.config.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Project directories
const cdpdir = join(__dirname, "packages/cdp");
const injectdir = join(__dirname, "packages/inject");

// Configuration for CDP (Chobitsu)
// Define external dependencies from package.json
const cssloader = {
	test: /\.css$/,
	type: "asset/source",
};
export const cdpConfig = defineConfig({
	name: "cdp",
	entry: join(cdpdir, "src/index.ts"),
	devtool: "source-map",
	target: "web",
	output: {
		filename: "chobitsu.js",
		path: join(cdpdir, "dist"),
		library: {
			type: "module",
		},
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [tsloader, cssloader],
	},
	experiments: {
		outputModule: true,
	},
	externals: {
		axios: "axios",
		"core-js": "core-js",
		"devtools-protocol": "devtools-protocol",
		html2canvas: "html2canvas",
		licia: "licia",
	},
});

export const injectConfig = defineConfig({
	name: "inject",
	dependencies: process.env.SKIP_CORE
		? []
		: ["scramjet-iife", "scramjet-esmodule"],
	entry: join(injectdir, "src/index.ts"),
	devtool: "source-map",
	target: "web",
	mode: "development",
	output: {
		filename: "inject.js",
		path: join(injectdir, "dist"),
		iife: true,
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			tsloader,
			cssloader,
			{
				test: /\.html$/,
				type: "asset/source",
			},
		],
	},
	performance: {
		hints: false,
	},
});

// the full set is what the dev server watches; `cv` builds the pieces one by one
export default [
	...(process.env.SKIP_CORE ? [] : scramjetConfig),
	cdpConfig,
	injectConfig,
];
