// The cost of single operations - a document read, a native call, a call through an alias - in
// Chromium directly and through scramjet in each rewriter mode. The cases are
// tools/benchmark-ops.html; each is timed in the page itself, so the table is nanoseconds per
// operation with nothing of Playwright's in it.
//
//   node tools/benchmark-ops.mjs
//
// BENCH_MODES   modes to compare (default chromium,dpsc,ppsc,ppsc-hybrid; see benchmark-lib.mjs)
// BENCH_ROUNDS  passes over the modes (default 3); the table is the median of them
// BENCH_OUTPUT  JSON lines file each run is appended to (default /tmp/ops-results.jsonl)

import { appendFileSync, mkdtempSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	chromium,
	median,
	open,
	parseModes,
	root,
	schedule,
	serveStatic,
	table,
	waitFor,
	PAGE_PORT,
} from "./benchmark-lib.mjs";

const modes = parseModes(
	process.env.BENCH_MODES,
	"chromium,dpsc,ppsc,ppsc-hybrid"
);
const rounds = Number(process.env.BENCH_ROUNDS ?? 3);
const output = process.env.BENCH_OUTPUT ?? "/tmp/ops-results.jsonl";

// served from a directory of its own, so nothing else in tools/ is reachable from the page
const dir = mkdtempSync(path.join(os.tmpdir(), "ops-"));
copyFileSync(
	path.join(root, "tools/benchmark-ops.html"),
	path.join(dir, "index.html")
);
const stop = await serveStatic(dir);
const browser = await chromium.launch({ headless: true });
const records = [];

for (const { round, mode } of schedule(modes, rounds)) {
	const { context, page, frame } = await open(
		browser,
		mode,
		`http://localhost:${PAGE_PORT}/index.html`
	);
	const errors = [];
	page.on(
		"pageerror",
		(e) => errors.length < 10 && errors.push(String(e.message).slice(0, 200))
	);
	const results = await waitFor(frame, () => window.__OPS ?? null, {
		timeoutMs: 300000,
	});
	const record = {
		mode: mode.label,
		flags: mode.flags,
		round,
		results,
		errors,
	};
	records.push(record);
	appendFileSync(output, JSON.stringify(record) + "\n");
	console.log(
		`round ${round} ${mode.label.padEnd(16)} ${results ? results.length + " cases" : "TIMEOUT"}`,
		errors.length ? `(${errors.length} page errors: ${errors[0]})` : ""
	);
	await context.close();
}

const labels = modes.map((m) => m.label);
const cases = records.find((r) => r.results)?.results ?? [];
const fmt = (ns) =>
	isNaN(ns) ? "-" : ns < 10 ? ns.toFixed(1) : String(Math.round(ns));
const rows = cases.map((c) => [
	`${c.group}: ${c.name}`,
	...labels.map((l) =>
		fmt(
			median(
				records
					.filter((r) => r.mode === l && r.results)
					.map((r) => r.results.find((x) => x.name === c.name)?.ns)
			)
		)
	),
]);
console.log(
	`\nns per operation, median of ${rounds} rounds (lower is better)\n`
);
console.log(table(["", ...labels], rows));
console.log(`\nruns appended to ${output}`);

await browser.close();
await stop();
process.exit(0);
