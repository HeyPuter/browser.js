// node src/bench/speedo.ts [--modes bare,sj] [--base root] [--n 1] [--suites a,b]
// runs Speedometer 3 (bench-data/speedometer, see static.json) bare and
// proxied, and prints the score and each suite's mean time
import fs from "node:fs";
import path from "node:path";
import { chromium, type Frame } from "playwright";
import { Store, serveStore } from "./store.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i === -1 ? def : args[i + 1];
};
const modes = opt("modes", "bare,sj").split(",");
const N = Number(opt("n", "1"));
const suites = opt("suites", "");
const REPLAY_PORT = 4590;
process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
const baseRoot = opt("base", "");
let BASE_PORT = 0;
if (baseRoot) {
	const saved = { ...process.env };
	process.env.RUNWAY_PORT_BASE = String(PORT + 4);
	process.env.RUNWAY_SCRAMJET_ROOT = baseRoot;
	const base = await import("../harness/scramjet/index.ts?base");
	BASE_PORT = base.PORT;
	await base.startHarness();
	process.env = saved;
}
await startHarness();

const store = new Store(
	path.resolve(import.meta.dirname, "../../bench-data/speedometer")
);
await serveStore(store, REPLAY_PORT);
let url =
	"https://speedometer.test/?startAutomatically=true&iterationCount=" +
	opt("iter", "3");
if (suites) url += "&suites=" + suites;

const browser = await chromium.launch({ headless: true });
const results: Record<string, Record<string, number>[]> = {};

async function run(mode: string) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
	});
	const page = await context.newPage();
	const prof = opt("profile", "");
	const cdp = prof ? await context.newCDPSession(page) : null;
	if (cdp) {
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
		await cdp.send("Profiler.start");
	}
	try {
		let frame: Frame;
		if (mode === "bare") {
			await context.route("**/*", (route) => {
				const hit = store.lookup(
					route.request().method(),
					route.request().url()
				);
				if (!hit) return route.fulfill({ status: 404, body: "" });
				return route.fulfill({
					status: hit.status,
					headers: Object.fromEntries(hit.headers),
					body: hit.body,
				});
			});
			await page.goto(url);
			frame = page.mainFrame();
		} else {
			await page.goto(
				`http://localhost:${mode === "base" ? BASE_PORT : PORT}/`
			);
			await page.waitForFunction(() => (window as any).__runwayNavigate);
			await page.evaluate((s) => ((window as any).__runwayCleartextSite = s), {
				roots: store.hosts(),
				httpPort: REPLAY_PORT,
			});
			// the harness iframe is short; give the suites room to lay out
			await page.evaluate(() => {
				const f = document.getElementById("testframe")!;
				f.style.height = "900px";
			});
			frame = (await (await page.$("#testframe"))!.contentFrame())!;
			await page.evaluate((u) => (window as any).__runwayNavigate(u), url);
			await page.waitForTimeout(2000);
		}
		await frame.waitForFunction(
			() => {
				const c = (globalThis as any).benchmarkClient;
				return c && Object.keys(c._metrics ?? {}).length > 0;
			},
			null,
			{ timeout: 30 * 60 * 1000, polling: 1000 }
		);
		const metrics = await frame.evaluate(() => {
			const m = (globalThis as any).benchmarkClient._metrics;
			const out: Record<string, number> = {};
			for (const [k, v] of Object.entries<any>(m)) {
				if (k.includes("/") || k.startsWith("Iteration")) continue;
				out[k] = v.mean;
			}
			return out;
		});
		(results[mode] ??= []).push(metrics);
		if (cdp) {
			const { profile } = await cdp.send("Profiler.stop");
			fs.writeFileSync(`${prof}-${mode}.cpuprofile`, JSON.stringify(profile));
		}
	} finally {
		await context.close();
	}
}

for (let i = 0; i < N; i++) for (const m of modes) await run(m);

const keys = Object.keys(results[modes[0]]?.[0] ?? {});
console.log("metric".padEnd(34) + modes.map((m) => m.padStart(10)).join(""));
for (const k of keys) {
	const mean = (m: string) => {
		const xs = (results[m] ?? []).map((r) => r[k]).filter((x) => x != null);
		return xs.reduce((a, b) => a + b, 0) / xs.length;
	};
	console.log(
		k.slice(0, 33).padEnd(34) +
			modes.map((m) => mean(m).toFixed(1).padStart(10)).join("")
	);
}
if (opt("json", "")) fs.writeFileSync(opt("json", ""), JSON.stringify(results));
await browser.close();
process.exit(0);
