// What the benchmarks share: Chromium, the runway harness, and the modes a run compares.
//
// A mode is `chromium` (the page loaded directly, no proxy) or a `jsRewriter` - `dpsc`, `ppsc`,
// `ppsc-hybrid` - optionally with `+this` for `ppscWrapThis`. Every scramjet mode runs on the one
// build in packages/scramjet/packages/core/dist: the flags are handed to the harness, which gives
// them to the frame it loads the page in. `BENCH_FLAGS` (JSON) adds flags to every scramjet mode.
//
// Modes are run round-robin, the order rotated each round, so that drift over a long run - thermal,
// another process - lands on every mode alike rather than on whichever ran last.

import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".."
);
const require = createRequire(import.meta.url);
const runway = path.join(root, "packages/scramjet/packages/runway");
export const express = require(path.join(runway, "node_modules/express"));
export const { chromium } = require(
	path.join(runway, "node_modules/playwright")
);

/** Where a page under test is served; the harness is on 4500 and its wisp server on 4501. */
export const PAGE_PORT = 4600;

export function parseModes(spec, fallback) {
	const extra = process.env.BENCH_FLAGS
		? JSON.parse(process.env.BENCH_FLAGS)
		: {};
	return (spec || fallback)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((label) => {
			if (label === "chromium") return { label, flags: null };
			const [jsRewriter, ...opts] = label.split("+");
			if (!["dpsc", "ppsc", "ppsc-hybrid"].includes(jsRewriter))
				throw new Error(`unknown mode ${label}`);
			return {
				label,
				flags: { ...extra, jsRewriter, ppscWrapThis: opts.includes("this") },
			};
		});
}

/** `rounds` passes over `modes`, each starting one further along. */
export function schedule(modes, rounds) {
	const runs = [];
	for (let r = 0; r < rounds; r++)
		for (let i = 0; i < modes.length; i++)
			runs.push({ round: r + 1, mode: modes[(i + r) % modes.length] });
	return runs;
}

/** Serves `dir` on {@link PAGE_PORT}; resolves to a function that stops it. */
export async function serveStatic(dir) {
	const app = express();
	app.use(express.static(dir));
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(PAGE_PORT, resolve));
	return () => new Promise((resolve) => server.close(resolve));
}

let harness = null;
function startHarness() {
	harness ??= import(path.join(runway, "src/harness/scramjet/index.ts")).then(
		(m) => m.startHarness()
	);
	return harness;
}

/**
 * Opens `url` in a fresh context, through scramjet with `mode.flags` unless the mode is
 * `chromium`. Resolves to the context, its page, and a function that finds the frame the page
 * under test ended up in, which through scramjet is the harness's iframe.
 */
export async function open(browser, mode, url, { contextOptions = {} } = {}) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		...contextOptions,
	});
	const page = await context.newPage();
	if (!mode.flags) {
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
	} else {
		await startHarness();
		const flags = encodeURIComponent(JSON.stringify(mode.flags));
		await page.goto(`http://localhost:4500/?flags=${flags}`);
		await page.waitForFunction(
			() => typeof window.__runwayNavigate === "function",
			null,
			{ timeout: 30000 }
		);
		await page.evaluate((u) => window.__runwayNavigate(u), url);
	}
	// through scramjet the page is the harness's #testframe, whatever it has navigated to since
	const testframe = mode.flags ? await page.$("#testframe") : null;
	const frame = () => (testframe ? testframe.contentFrame() : page.mainFrame());

	return { context, page, frame };
}

/** Polls `read` in the page under test until it returns something other than null. */
export async function waitFor(
	frame,
	read,
	{ timeoutMs, everyMs = 1000, arg } = {}
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const f = await frame();
		if (f) {
			try {
				const v = await f.evaluate(read, arg);
				if (v != null) return v;
			} catch {
				// the frame navigated between finding and asking it
			}
		}
		await new Promise((r) => setTimeout(r, everyMs));
	}

	return null;
}

export function median(xs) {
	const s = xs
		.filter((x) => typeof x === "number" && !isNaN(x))
		.sort((a, b) => a - b);
	if (!s.length) return NaN;
	const m = s.length >> 1;

	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A plain text table, first column left aligned and the rest right aligned. */
export function table(header, rows) {
	const cells = [header, ...rows].map((r) => r.map(String));
	const width = header.map((_, i) =>
		Math.max(...cells.map((r) => r[i].length))
	);
	return cells
		.map((r, j) =>
			[
				r
					.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i])))
					.join("  "),
				j === 0 ? "\n" + width.map((w) => "-".repeat(w)).join("  ") : "",
			].join("")
		)
		.join("\n");
}
