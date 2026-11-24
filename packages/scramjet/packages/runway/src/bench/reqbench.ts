// node src/bench/reqbench.ts [--n 5] — what a request costs through the proxy:
// ms per request in a dependent chain, and for 100 issued at once
import path from "node:path";
import { chromium, type Frame } from "playwright";
import { Store, serveStore } from "./store.ts";
const args = process.argv.slice(2);
const N = Number(args[args.indexOf("--n") + 1] || 5);
process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
await startHarness();
const store = new Store(
	path.resolve(import.meta.dirname, "../../bench-data/synth-requests")
);
await serveStore(store, 4590);
const browser = await chromium.launch({ headless: true });
async function once(mode: string) {
	const context = await browser.newContext();
	const page = await context.newPage();
	let frame: Frame;
	if (mode === "bare") {
		await context.route("**/*", (r) => {
			const hit = store.lookup(r.request().method(), r.request().url());
			return hit
				? r.fulfill({
						status: 200,
						headers: Object.fromEntries(hit.headers),
						body: hit.body,
					})
				: r.fulfill({ status: 404 });
		});
		await page.goto("https://bench.test/");
		frame = page.mainFrame();
	} else {
		await page.goto(
			`http://localhost:${PORT}/${mode === "fetch" ? "?fetch" : ""}`
		);
		await page.waitForFunction(() => (window as any).__runwayNavigate);
		await page.evaluate((s) => ((window as any).__runwayCleartextSite = s), {
			roots: ["bench.test"],
			httpPort: 4590,
		});
		frame = (await (await page.$("#testframe"))!.contentFrame())!;
		if (process.env.PROF) {
			const cdp = await context.newCDPSession(page);
			await cdp.send("Profiler.enable");
			await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
			await cdp.send("Profiler.start");
			(globalThis as any).__cdp = cdp;
		}
		await page.evaluate(() =>
			(window as any).__runwayNavigate("https://bench.test/")
		);
	}
	await frame.waitForFunction(() => (window as any).__reqs, null, {
		timeout: 60000,
	});
	const r = await frame.evaluate(() => (window as any).__reqs);
	const cdp = (globalThis as any).__cdp;
	if (cdp) {
		const { profile } = await cdp.send("Profiler.stop");
		(await import("node:fs")).writeFileSync(
			process.env.PROF!,
			JSON.stringify(profile)
		);
		(globalThis as any).__cdp = null;
	}
	await context.close();
	return r;
}
for (const mode of ["bare", "sj", "fetch"]) {
	const rs = [];
	for (let i = 0; i < N; i++) rs.push(await once(mode));
	const med = (k: string) =>
		rs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(N / 2)];
	console.log(
		mode.padEnd(5),
		"chain ms/request",
		med("chainPerRequest").toFixed(2),
		" 100 parallel ms",
		med("parallel100").toFixed(1)
	);
}
await browser.close();
process.exit(0);
