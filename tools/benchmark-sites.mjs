// Real sites, loaded directly and through scramjet in each rewriter mode: how much main thread
// time their scripts took, and what broke.
//
//   node tools/benchmark-sites.mjs                     # every site in tools/benchmark-sites.txt
//   node tools/benchmark-sites.mjs https://discord.com/ https://www.twitch.tv/
//
// Each load waits for the page to settle, scrolls it and moves the mouse over it, then reads
// Chromium's own ScriptDuration and TaskDuration for the tab. Sites change from one day to the
// next, so the numbers only mean something against other modes of the same run - which is what
// round-robin scheduling is for - never against a run from another day.
//
// A page error seen through scramjet that chromium did not also throw is the other half of the
// output: a mode that breaks a site is worse than one that is slow on it.
//
// BENCH_MODES    modes to compare (default chromium,dpsc,ppsc-hybrid; see benchmark-lib.mjs)
// BENCH_ROUNDS   passes over the modes (default 1)
// BENCH_OUTPUT   JSON lines file each load is appended to (default /tmp/sites-results.jsonl)
// SITES_SETTLE_MS  how long a page is left to load before it is scrolled (default 12000)

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	chromium,
	median,
	open,
	parseModes,
	root,
	schedule,
	table,
} from "./benchmark-lib.mjs";

const modes = parseModes(process.env.BENCH_MODES, "chromium,dpsc,ppsc-hybrid");
const rounds = Number(process.env.BENCH_ROUNDS ?? 1);
const output = process.env.BENCH_OUTPUT ?? "/tmp/sites-results.jsonl";
const settleMs = Number(process.env.SITES_SETTLE_MS ?? 12000);
const sites = process.argv.slice(2).length
	? process.argv.slice(2)
	: readFileSync(path.join(root, "tools/benchmark-sites.txt"), "utf8")
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));

// a desktop Chrome, since some sites hand a headless user agent something else entirely
const contextOptions = {
	userAgent:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
	viewport: { width: 1366, height: 900 },
	locale: "en-US",
};

const browser = await chromium.launch({ headless: true });
const records = [];

for (const url of sites) {
	for (const { round, mode } of schedule(modes, rounds)) {
		let context,
			page,
			scriptMs,
			taskMs,
			note = "";
		const errors = [];
		const started = Date.now();
		try {
			({ context, page } = await open(browser, mode, url, { contextOptions }));
			page.on("pageerror", (e) =>
				errors.push(String(e.message).split("\n")[0].slice(0, 200))
			);
			const cdp = await context.newCDPSession(page);
			await cdp.send("Performance.enable");
			await page.waitForTimeout(settleMs);
			for (let i = 0; i < 4; i++) {
				await page.mouse.move(400 + i * 100, 300 + i * 50);
				await page.mouse.wheel(0, 2500);
				await page.waitForTimeout(1500);
			}
			await page.waitForTimeout(2000);
			const metrics = Object.fromEntries(
				(await cdp.send("Performance.getMetrics")).metrics.map((m) => [
					m.name,
					m.value,
				])
			);
			scriptMs = Math.round(metrics.ScriptDuration * 1000);
			taskMs = Math.round(metrics.TaskDuration * 1000);
		} catch (e) {
			note = String(e.message).split("\n")[0].slice(0, 120);
		}
		const record = {
			url,
			mode: mode.label,
			flags: mode.flags,
			round,
			scriptMs: scriptMs ?? null,
			taskMs: taskMs ?? null,
			errors: [...new Set(errors)].slice(0, 20),
			note,
			seconds: (Date.now() - started) / 1000,
		};
		records.push(record);
		appendFileSync(output, JSON.stringify(record) + "\n");
		console.log(
			`${mode.label.padEnd(16)} ${url
				.replace(/^https?:\/\/(www\.)?/, "")
				.slice(0, 40)
				.padEnd(40)}`,
			`script ${String(record.scriptMs ?? "-").padStart(6)}ms  task ${String(record.taskMs ?? "-").padStart(6)}ms`,
			`errors ${record.errors.length}`,
			note
		);
		await context?.close().catch(() => {});
	}
}

const labels = modes.map((m) => m.label);
const of = (url, label) =>
	records.filter((r) => r.url === url && r.mode === label);
const direct = (url) => new Set(of(url, "chromium").flatMap((r) => r.errors));
// an error only counts against a mode when loading the site directly did not throw it too
const newErrors = (url, label) =>
	[...new Set(of(url, label).flatMap((r) => r.errors))].filter(
		(e) => !direct(url).has(e)
	);
const rows = sites.map((url) => [
	url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 36),
	...labels.map((l) => {
		const ms = median(of(url, l).map((r) => r.scriptMs));
		const errs = l === "chromium" ? 0 : newErrors(url, l).length;
		return (isNaN(ms) ? "-" : String(ms)) + (errs ? ` !${errs}` : "");
	}),
]);
const sum = (l) =>
	sites.reduce(
		(a, url) => a + (median(of(url, l).map((r) => r.scriptMs)) || 0),
		0
	);
rows.push(["total", ...labels.map((l) => String(Math.round(sum(l))))]);
console.log(
	`\nScript time per site, ms (lower is better; !n = page errors chromium did not throw)\n`
);
console.log(table(["", ...labels], rows));
for (const url of sites)
	for (const l of labels.filter((l) => l !== "chromium"))
		for (const e of newErrors(url, l).slice(0, 3))
			console.log(`  ${l} ${url}: ${e}`);
console.log(`\nloads appended to ${output}`);

await browser.close();
process.exit(0);
