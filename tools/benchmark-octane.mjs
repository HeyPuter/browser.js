// Octane 2.0 in Chromium, directly and through scramjet in each rewriter mode.
//
// Octane is mostly pure JS - little DOM - so it measures what the rewrite does to ordinary code:
// the calls it wraps, the `this` it rebinds, the members it renames. The Speedometer tool is the
// one for DOM-heavy apps.
//
//   git clone https://github.com/chromium/octane /tmp/octane
//   OCTANE_ROOT=/tmp/octane node tools/benchmark-octane.mjs
//
// BENCH_MODES     modes to compare (default chromium,dpsc,ppsc,ppsc-hybrid; see benchmark-lib.mjs)
// BENCH_ROUNDS    passes over the modes (default 3); the table is the median of them
// BENCH_OUTPUT    JSON lines file each run is appended to (default /tmp/octane-results.jsonl)
// OCTANE_TIMEOUT_MS  per run (default 20 minutes)

import { appendFileSync } from "node:fs";
import {
	chromium,
	median,
	open,
	parseModes,
	schedule,
	serveStatic,
	table,
	waitFor,
	PAGE_PORT,
} from "./benchmark-lib.mjs";

const octaneRoot = process.env.OCTANE_ROOT ?? "/tmp/octane";
const modes = parseModes(
	process.env.BENCH_MODES,
	"chromium,dpsc,ppsc,ppsc-hybrid"
);
const rounds = Number(process.env.BENCH_ROUNDS ?? 3);
const output = process.env.BENCH_OUTPUT ?? "/tmp/octane-results.jsonl";
const timeoutMs = Number(process.env.OCTANE_TIMEOUT_MS ?? 1200000);

const stop = await serveStatic(octaneRoot);
const browser = await chromium.launch({ headless: true });
const records = [];

for (const { round, mode } of schedule(modes, rounds)) {
	const { context, page, frame } = await open(
		browser,
		mode,
		`http://localhost:${PAGE_PORT}/index.html?auto=1`
	);
	const errors = [];
	page.on(
		"pageerror",
		(e) => errors.length < 10 && errors.push(String(e.message).slice(0, 200))
	);
	const started = Date.now();
	const result = await waitFor(
		frame,
		() => {
			const banner = document.getElementById("main-banner");
			if (!banner || !/Score/.test(banner.textContent)) return null;
			const tests = {};
			for (const el of document.querySelectorAll("[id^=Result-]"))
				tests[el.id.slice("Result-".length)] =
					Number(el.textContent) || el.textContent;

			return { score: Number(banner.textContent.match(/[\d.]+/)?.[0]), tests };
		},
		{ timeoutMs, everyMs: 3000 }
	);
	const record = {
		mode: mode.label,
		flags: mode.flags,
		round,
		seconds: (Date.now() - started) / 1000,
		score: result?.score ?? null,
		tests: result?.tests ?? {},
		errors,
	};
	records.push(record);
	appendFileSync(output, JSON.stringify(record) + "\n");
	console.log(
		`round ${round} ${mode.label.padEnd(16)} ${result ? record.score : "TIMEOUT"} in ${record.seconds}s`,
		errors.length ? `(${errors.length} page errors: ${errors[0]})` : ""
	);
	await context.close();
}

// the median of each mode's rounds, per test and in total
const labels = modes.map((m) => m.label);
const tests = [...new Set(records.flatMap((r) => Object.keys(r.tests)))];
const med = (label, pick) =>
	median(records.filter((r) => r.mode === label).map(pick));
const rows = [
	...tests.map((t) => [
		t,
		...labels.map((l) => Math.round(med(l, (r) => r.tests[t]))),
	]),
	["Score", ...labels.map((l) => Math.round(med(l, (r) => r.score)))],
];
console.log(`\nOctane, median of ${rounds} rounds (higher is better)\n`);
console.log(table(["", ...labels], rows));
console.log(`\nruns appended to ${output}`);

await browser.close();
await stop();
process.exit(0);
