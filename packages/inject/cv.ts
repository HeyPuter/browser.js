import { join } from "node:path";
import { definePackage } from "../scramjet/packages/cv/api.ts";
import { runRspack } from "../scramjet/packages/cv/rspack.ts";

export default definePackage(import.meta.dirname, {
	name: "inject",
	tasks: {
		build: {
			desc: "bundle the script injected into proxied pages",
			deps: ["core:build", "cdp:build"],
			inputs: ["src/**", "package.json", "../../rspack.config.ts"],
			outputs: ["dist/inject.js"],
			run: (ctx) =>
				runRspack(join(ctx.root, "rspack.config.ts"), ["inject"], {
					log: ctx.log,
				}),
		},
	},
});
