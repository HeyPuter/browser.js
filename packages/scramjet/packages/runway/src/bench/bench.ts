// node src/bench/bench.ts [--sites a,b] [--n 5] [--modes bare,sj] [--cpu 1]
//   [--profile dir] [--settle 3000] [--json out.json] [--base root]
//   [--latency ms] [--kbps n]
//
// loads recorded sites (src/bench/record.ts) bare and through scramjet from the
// same local replay, and reports paint/load timings and main-thread cost.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page, type Frame } from "playwright";
import { Store, serveStore } from "./store.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i === -1 ? def : args[i + 1];
};
const DATA = path.resolve(import.meta.dirname, "../../bench-data");
const sites = opt("sites", fs.readdirSync(DATA).join(",")).split(",");
const N = Number(opt("n", "5"));
const modes = opt("modes", "bare,sj").split(",");
const CPU = Number(opt("cpu", "1"));
const SETTLE = Number(opt("settle", "3000"));
const profileDir = opt("profile", "");
const jsonOut = opt("json", "");
const REPLAY_PORT = 4590;

process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
// --base <root>: a second harness serving another scramjet checkout's build,
// as mode "base"
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

// runs before anything in every frame, bare or proxied
const INIT = () => {
	const w = window as any;
	if (w.__bench) return;
	const b = (w.__bench = { lcp: 0, longtasks: [] as number[][] });
	try {
		new PerformanceObserver((l) => {
			for (const e of l.getEntries()) b.lcp = e.startTime;
		}).observe({ type: "largest-contentful-paint", buffered: true });
	} catch {}
	try {
		new PerformanceObserver((l) => {
			for (const e of l.getEntries())
				b.longtasks.push([e.startTime + performance.timeOrigin, e.duration]);
		}).observe({ type: "longtask", buffered: true });
	} catch {}
};

type Sample = Record<string, number>;

async function collect(page: Page, frame: Frame, t0: number) {
	const inner = await frame.evaluate(() => {
		const nav = performance.getEntriesByType(
			"navigation"
		)[0] as PerformanceNavigationTiming;
		const paint = Object.fromEntries(
			performance.getEntriesByType("paint").map((p) => [p.name, p.startTime])
		);
		return {
			origin: performance.timeOrigin,
			ttfb: nav?.responseStart ?? NaN,
			dcl: nav?.domContentLoadedEventEnd ?? NaN,
			load: nav?.loadEventEnd ?? NaN,
			fcp: paint["first-contentful-paint"] ?? NaN,
			lcp: (window as any).__bench?.lcp || NaN,
			resources: performance.getEntriesByType("resource").length,
		};
	});
	// long tasks of the whole renderer show up in the top frame
	const tasks: number[][] = await page.evaluate(
		() => (window as any).__bench.longtasks
	);
	const start = Math.min(inner.origin, t0);
	const end = inner.origin + inner.load + SETTLE;
	let tbt = 0,
		lt = 0;
	for (const [s, d] of tasks) {
		if (s < start || s > end) continue;
		lt += d;
		tbt += Math.max(0, d - 50);
	}
	const { origin, ...rest } = inner;
	return { ...rest, tbt, longtask: lt };
}

async function metrics(page: Page, cdp: any) {
	const { metrics } = await cdp.send("Performance.getMetrics");
	const m = Object.fromEntries(metrics.map((x: any) => [x.name, x.value]));
	return {
		script: m.ScriptDuration * 1000,
		task: m.TaskDuration * 1000,
		layout: m.LayoutDuration * 1000,
		style: m.RecalcStyleDuration * 1000,
	};
}

async function runOnce(
	browser: Browser,
	mode: string,
	site: string,
	store: Store,
	url: string,
	profile: string | null
): Promise<Sample> {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	await context.addInitScript(INIT);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Performance.enable");
	if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
	try {
		let frame: Frame;
		let before = { script: 0, task: 0, layout: 0, style: 0 };
		const t0 = Date.now();
		if (mode === "bare") {
			await context.route("**/*", (route) => {
				const req = route.request();
				const hit = store.lookup(req.method(), req.url());
				if (!hit) return route.fulfill({ status: 404, body: "" });
				return route.fulfill({
					status: hit.status,
					headers: Object.fromEntries(
						hit.headers.map(([k, v]) => [k.toLowerCase(), v])
					),
					body: hit.body,
				});
			});
			if (profile) await startProfile(cdp);
			await page.goto(url, { waitUntil: "load", timeout: 60000 });
			frame = page.mainFrame();
		} else {
			await page.goto(
				`http://localhost:${mode === "base" ? BASE_PORT : PORT}/`
			);
			await page.waitForFunction(
				() => typeof (window as any).__runwayNavigate === "function",
				null,
				{ timeout: 30000 }
			);
			await page.evaluate(
				(site) => ((window as any).__runwayCleartextSite = site),
				{ roots: store.hosts(), httpPort: REPLAY_PORT }
			);
			before = await metrics(page, cdp);
			if (profile) await startProfile(cdp);
			const iframe = await page.$("#testframe");
			frame = (await iframe!.contentFrame())!;
			const loaded = page.waitForEvent("framenavigated", {
				predicate: (f) => f === frame && f.url().includes("/~/sj/"),
				timeout: 60000,
			});
			await page.evaluate((u) => (window as any).__runwayNavigate(u), url);
			await loaded;
			await frame.waitForLoadState("load", { timeout: 60000 });
		}
		await page.waitForTimeout(SETTLE);
		if (profile) await stopProfile(cdp, profile);
		const after = await metrics(page, cdp);
		const timings = await collect(page, frame, t0);
		return {
			...timings,
			script: after.script - before.script,
			task: after.task - before.task,
			layout: after.layout - before.layout,
			style: after.style - before.style,
		};
	} finally {
		await context.close();
	}
}

async function startProfile(cdp: any) {
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
	await cdp.send("Profiler.start");
}
async function stopProfile(cdp: any, file: string) {
	const { profile } = await cdp.send("Profiler.stop");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(profile));
}

function median(xs: number[]) {
	const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
	if (!s.length) return NaN;
	return s[Math.floor(s.length / 2)];
}

const KEYS = [
	"ttfb",
	"fcp",
	"lcp",
	"dcl",
	"load",
	"tbt",
	"longtask",
	"script",
	"task",
	"layout",
	"style",
	"resources",
];

const replays = new Map<string, Store>();
await startHarness();
const browser = await chromium.launch({ headless: true });
const results: Record<string, Record<string, Sample[]>> = {};

for (const site of sites) {
	const store = new Store(path.join(DATA, site));
	const url = fs.readFileSync(path.join(DATA, site, "url.txt"), "utf8");
	// --latency ms before each response's first byte, --kbps to pace its body
	const latency = Number(opt("latency", "0"));
	const kbps = Number(opt("kbps", "0"));
	const server = await serveStore(
		store,
		REPLAY_PORT,
		latency || kbps ? { latency, kbps } : null
	);
	replays.set(site, store);
	results[site] = {};
	for (let i = 0; i < N; i++) {
		for (const mode of modes) {
			const prof =
				profileDir && i === N - 1
					? path.join(profileDir, `${site}-${mode}.cpuprofile`)
					: null;
			try {
				const s = await runOnce(browser, mode, site, store, url, prof);
				(results[site][mode] ??= []).push(s);
			} catch (e) {
				console.error(`${site} ${mode} #${i}: ${(e as Error).message}`);
			}
		}
	}
	server.close();
	const fmt = (v: number) =>
		Number.isNaN(v) ? "    -" : Math.round(v).toString().padStart(6);
	console.log(`\n${site}  (${url})`);
	console.log("      " + KEYS.map((k) => k.padStart(6).slice(0, 6)).join(""));
	for (const mode of modes) {
		const ss = results[site][mode] ?? [];
		console.log(
			mode.padEnd(6) +
				KEYS.map((k) => fmt(median(ss.map((s) => s[k])))).join("")
		);
	}
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
await browser.close();
process.exit(0);
