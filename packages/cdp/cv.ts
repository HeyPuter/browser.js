import { join } from "node:path";
import { definePackage } from "../scramjet/packages/cv/api.ts";
import { runRspack } from "../scramjet/packages/cv/rspack.ts";

export default definePackage(import.meta.dirname, {
	name: "cdp",
	tasks: {
		build: {
			desc: "bundle chobitsu (the in-page devtools protocol backend)",
			inputs: ["src/**", "package.json", "../../rspack.config.ts"],
			outputs: ["dist/chobitsu.js"],
			run: (ctx) => runRspack(join(ctx.root, "rspack.config.ts"), ["cdp"], { log: ctx.log }),
		},
	},
});
