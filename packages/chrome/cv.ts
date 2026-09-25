import { definePackage } from "../scramjet/packages/cv/api.ts";

export default definePackage(import.meta.dirname, {
	name: "chrome",
	tasks: {
		build: {
			desc: "build the browser.js frontend with vite",
			deps: ["core:wasm", "core:build", "inject:build", "dreamland:build"],
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
