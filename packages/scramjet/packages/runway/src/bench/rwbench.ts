// node src/bench/rwbench.ts [--sites cnn,youtube,github] [--n 5] [--root dir]
// time the controller's JS rewrite of every script a recorded site loads:
// the rewriter's throughput, as the site's own code exercises it
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { Store } from "./store.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i === -1 ? def : args[i + 1];
};
const sites = opt("sites", "cnn,youtube,github,discord").split(",");
const N = Number(opt("n", "5"));
const root = opt("root", "");
if (root) process.env.RUNWAY_SCRAMJET_ROOT = root;
process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
await startHarness();

const browser = await chromium.launch({
	headless: true,
	args: opt("jsflags", "") ? [`--js-flags=${opt("jsflags", "")}`] : [],
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => (window as any).__runwayNavigate);

// --profile file: a cpu profile of the whole run
const profile = opt("profile", "");
const cdp = profile ? await page.context().newCDPSession(page) : null;
if (cdp) {
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
	await cdp.send("Profiler.start");
}
for (const site of sites) {
	const store = new Store(
		path.resolve(import.meta.dirname, "../../bench-data", site)
	);
	const bodies = store.entries
		.filter((e) =>
			e.headers.some(
				([k, v]) => k.toLowerCase() === "content-type" && /javascript/.test(v)
			)
		)
		.map((e) => ({
			url: e.url,
			text: fs.readFileSync(path.join(store.dir, "bodies", e.file), "utf8"),
		}));
	const res = await page.evaluate(
		({ bodies, N }) => {
			const sj = (window as any).$scramjet;
			const ctx = (window as any).__runwayScramjetFrame.context;
			const enc = new TextEncoder();
			const bytes = bodies.map((b) => ({ url: b.url, u8: enc.encode(b.text) }));
			const run = () => {
				const t = performance.now();
				for (const b of bytes) {
					const meta = { origin: new URL(b.url), base: new URL(b.url) };
					sj.rewriteJs(b.u8, b.url, ctx, meta);
				}
				return performance.now() - t;
			};
			const cold = run(); // the first: compile, tier up
			const times = [];
			for (let i = 0; i < N; i++) times.push(run());
			times.sort((a, b) => a - b);
			const mb = bytes.reduce((a, b) => a + b.u8.length, 0) / 1048576;
			return { mb, median: times[Math.floor(N / 2)], min: times[0], cold };
		},
		{ bodies, N }
	);
	console.log(
		`${site.padEnd(10)} ${res.mb.toFixed(1).padStart(5)} MB  median ${res.median.toFixed(0).padStart(5)} ms  min ${res.min.toFixed(0).padStart(5)} ms  cold ${res.cold.toFixed(0).padStart(5)} ms  ${(res.mb / (res.median / 1000)).toFixed(1)} MB/s`
	);
}
if (cdp) {
	const { profile: p } = await cdp.send("Profiler.stop");
	fs.writeFileSync(profile, JSON.stringify(p));
}
await browser.close();
process.exit(0);
