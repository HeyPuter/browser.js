import { defineConfig } from "@rspack/cli";
import { rspack, type Compiler } from "@rspack/core";
import { RsdoctorRspackPlugin } from "@rsdoctor/rspack-plugin";

import { readFile, copyFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "node:fs";
import { writeFileSync, chmodSync } from "node:fs";
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

// The shell and isolation server must serve the worker from this build, not a
// checked-in snapshot that silently diverges from the controller protocol.
class PublishControllerWorkerPlugin {
	apply(compiler: Compiler) {
		compiler.hooks.afterEmit.tapPromise(
			"PublishControllerWorkerPlugin",
			async () => {
				for (const directory of [
					"packages/chrome/public",
					"packages/sandbox",
				]) {
					for (const filename of ["controller.sw.js", "controller.sw.js.map"])
						await copyFile(
							join(compiler.options.output.path!, filename),
							join(__dirname, directory, filename)
						);
				}
			}
		);
	}
}

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
	...(process.env.SKIP_CORE
		? []
		: scramjetConfig.map((config) =>
				config.name === "scramjet-controller"
					? {
							...config,
							plugins: [
								...(config.plugins ?? []),
								new PublishControllerWorkerPlugin(),
							],
						}
					: config
			)),
	cdpConfig,
	injectConfig,
];
