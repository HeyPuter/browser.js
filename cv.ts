import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
	definePackage,
	defineProject,
} from "./packages/scramjet/packages/cv/api.ts";

// dreamland is fetched at a pinned commit instead of being a git submodule, so a
// fresh clone only needs `./cv <anything>` to get a working tree
const DREAMLAND = {
	url: "https://github.com/MercuryWorkshop/dreamlandjs",
	rev: "9dfb8bc19b186d955d8fed4cee4aa4a19197d778",
	dir: join(import.meta.dirname, "external/dreamlandjs"),
};

const dreamland = definePackage(DREAMLAND.dir, {
	name: "dreamland",
	tasks: {
		clone: {
			desc: `fetch dreamland ${DREAMLAND.rev.slice(0, 7)} into external/dreamlandjs`,
			beforeInstall: true,
			outputs: ["package.json"],
			run: async (ctx) => {
				const git = ctx.output({ cwd: DREAMLAND.dir });
				const hasRepo = await fs
					.stat(join(DREAMLAND.dir, ".git"))
					.then(() => true)
					.catch(() => false);
				if (hasRepo) {
					const head = await git`git rev-parse HEAD`;
					if (head === DREAMLAND.rev) return;
					const dirty = await git`git status --porcelain`;
					if (dirty) {
						ctx.warn(
							`external/dreamlandjs is at ${head.slice(0, 7)} with local changes; leaving it alone (pinned: ${DREAMLAND.rev.slice(0, 7)})`
						);
						return;
					}
					ctx.log(
						`moving external/dreamlandjs from ${head.slice(0, 7)} to ${DREAMLAND.rev.slice(0, 7)}`
					);
					await git`git fetch --depth 1 origin ${DREAMLAND.rev}`;
					await git`git checkout --detach ${DREAMLAND.rev}`;
					return;
				}
				ctx.log(`cloning ${DREAMLAND.url} @ ${DREAMLAND.rev.slice(0, 7)}`);
				await fs.mkdir(DREAMLAND.dir, { recursive: true });
				await git`git init -q`;
				await git`git remote add origin ${DREAMLAND.url}`;
				await git`git fetch --depth 1 origin ${DREAMLAND.rev}`;
				await git`git checkout -q --detach FETCH_HEAD`;
			},
		},
		build: {
			desc: "build dreamland with rollup",
			deps: [":clone"],
			inputs: ["src/**", "package.json", "rollup.config.*", "tsconfig*.json"],
			outputs: ["dist/core.js", "dist/vite.js"],
			run: (ctx) => ctx.sh`pnpm run build`,
		},
	},
});

export default defineProject(import.meta.dirname, {
	name: "browser.js",
	include: ["packages/scramjet/cv.ts"],
	packages: ["packages/cdp", "packages/inject", "packages/chrome"],
	extra: [dreamland],
	targets: {
		chrome: ["chrome:build"],
	},
	commands: {
		chrome: {
			desc: "browser.js dev server (chrome + wisp + isolation + rspack watch)",
			deps: ["core:wasm", "dreamland:build", "cdp:build"],
			persistent: true,
			run: (ctx) => ctx.sh`node --no-warnings=ExperimentalWarning devserver.ts`,
		},
		format: {
			desc: "prettier --write across the whole repo",
			persistent: true,
			run: (ctx) => ctx.sh`pnpm exec prettier --write . ${ctx.args}`,
		},
		lint: {
			desc: "eslint across the whole repo",
			persistent: true,
			run: (ctx) =>
				ctx.sh`node scripts/eslint-cli.mjs ${ctx.args.length ? ctx.args : "."}`,
		},
	},
});
