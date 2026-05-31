import { defineConfig } from "@rspack/cli";

import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import scramjetConfig, { tsloader } from "./packages/scramjet/rspack.config.ts";

if (!process.env.CI) {
	try {
		writeFileSync(
			".git/hooks/pre-commit",
			"pnpm format\ngit update-index --again"
		);
		chmodSync(".git/hooks/pre-commit", 0o755);
	} catch {}
}

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
const cdpConfig = defineConfig({
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
		module: true,
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [tsloader, cssloader],
	},
	externals: {
		axios: "axios",
		"core-js": "core-js",
		"devtools-protocol": "devtools-protocol",
		html2canvas: "html2canvas",
		licia: "licia",
	},
});

const injectConfig = defineConfig({
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

export default [
	...(process.env.SKIP_CORE ? [] : scramjetConfig),
	cdpConfig,
	injectConfig,
];
