import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { definePackage } from "../scramjet/packages/cv/api.ts";

const ROOT = join(import.meta.dirname, "../..");
const BUILT_SW = join(
	ROOT,
	"packages/scramjet/packages/controller/dist/controller.sw.js"
);
// committed, because the isolation origin serves the sandbox as it is in git
const SW_COPIES = [
	join(import.meta.dirname, "public/controller.sw.js"),
	join(ROOT, "packages/sandbox/controller.sw.js"),
];

export default definePackage(import.meta.dirname, {
	name: "chrome",
	tasks: {
		"controller-sw": {
			desc: "copy the built controller service worker into chrome/public and sandbox",
			deps: ["controller:build"],
			run: async (ctx) => {
				const built = await fs.readFile(BUILT_SW, "utf8");
				// formatted the way the pre-commit hook would, so an unchanged
				// build leaves the committed copies as they are
				const formatted = spawnSync(
					"pnpm",
					["exec", "oxfmt", "--stdin-filepath=controller.sw.js"],
					{ cwd: ROOT, input: built, encoding: "utf8" }
				);
				if (formatted.status !== 0) {
					throw new Error(`oxfmt failed: ${formatted.stderr}`);
				}
				for (const copy of SW_COPIES) {
					const current = await fs.readFile(copy, "utf8").catch(() => null);
					if (current === formatted.stdout) continue;
					await fs.writeFile(copy, formatted.stdout);
					ctx.log(`updated ${copy.slice(ROOT.length + 1)}`);
				}
			},
		},
		build: {
			desc: "build the browser.js frontend with vite",
			deps: [
				"core:wasm",
				"core:build",
				"inject:build",
				"dreamland:build",
				":controller-sw",
			],
			inputs: [
				"src/**",
				"public/**",
				"index.html",
				"vite.config.ts",
				"package.json",
				"tsconfig*.json",
			],
			outputs: ["dist/index.html"],
			env: [
				"VITE_SINGLEFILE",
				"VITE_PUTER_BRANDING",
				"VITE_PUTER_WISP_PROMOTION",
				"VITE_WISP_URL",
				"VITE_ISOLATION_ORIGIN",
				"VITE_SENTRY_URL",
				"VITE_PLAUSIBLE_URL",
			],
			run: (ctx) => ctx.sh`pnpm exec vite build`,
		},
	},
});
