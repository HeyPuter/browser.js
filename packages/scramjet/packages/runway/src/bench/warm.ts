// node src/bench/warm.ts [--sites a,b] [--n 5] [--modes bare,sj,sjc]
// a repeat view: a site loaded, then loaded again in the same browser session,
// and the second load measured. "bare" is served over TLS under the site's own
// names, so the browser's HTTP and code caches work as they do for a user;
// "sj" is scramjet as the harness runs it; "sjc" adds the demo's
// HttpCachePlugin.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Frame } from "playwright";
import { Store, serveStore, serveStoreHttps } from "./store.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
	const i = args.indexOf("--" + name);
	return i === -1 ? def : args[i + 1];
};
const sites = opt("sites", "cnn,youtube,github,wikipedia").split(",");
const N = Number(opt("n", "5"));
const modes = opt("modes", "bare,sj,sjc").split(",");
const DATA = path.resolve(import.meta.dirname, "../../bench-data");
const TLS = opt("tls", path.join(os.tmpdir()));
const tls = {
	key: fs.readFileSync(path.join(TLS, "key.pem")),
	cert: fs.readFileSync(path.join(TLS, "cert.pem")),
};
const HTTPS_PORT = 4593;

process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
await startHarness();

type Sample = Record<string, number>;

async function timings(frame: Frame) {
	return frame.evaluate(() => {
		const nav = performance.getEntriesByType("navigation")[0] as any;
		const fcp = performance.getEntriesByName("first-contentful-paint")[0];
		return {
			ttfb: nav?.responseStart ?? NaN,
			fcp: fcp?.startTime ?? NaN,
			dcl: nav?.domContentLoadedEventEnd ?? NaN,
			load: nav?.loadEventEnd ?? NaN,
		};
	});
}

async function scriptMs(context: BrowserContext, page: any) {
	const cdp = await context.newCDPSession(page);
	await cdp.send("Performance.enable");
	return async () => {
		const { metrics } = await cdp.send("Performance.getMetrics");
		return metrics.find((m: any) => m.name === "ScriptDuration").value * 1000;
	};
}

async function run(mode: string, store: Store, url: string): Promise<Sample> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sj-warm-"));
	const context = await chromium.launchPersistentContext(dir, {
		headless: true,
		ignoreHTTPSErrors: true,
		args:
			mode === "bare"
				? [
						`--host-resolver-rules=MAP * 127.0.0.1:${HTTPS_PORT}, EXCLUDE localhost`,
						"--ignore-certificate-errors",
					]
				: [],
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		const script = await scriptMs(context, page);
		if (mode === "bare") {
			await page.goto(url, { waitUntil: "load", timeout: 60000 });
			await page.waitForTimeout(3000);
			await page.goto("about:blank");
			const s0 = await script();
			await page.goto(url, { waitUntil: "load", timeout: 60000 });
			await page.waitForTimeout(3000);
			return {
				...(await timings(page.mainFrame())),
				script: (await script()) - s0,
			};
		}
		await page.goto(
			`http://localhost:${PORT}/${mode === "sjc" ? "?cache" : ""}`
		);
		await page.waitForFunction(() => (window as any).__runwayNavigate, null, {
			timeout: 30000,
		});
		await page.evaluate((s) => ((window as any).__runwayCleartextSite = s), {
			roots: store.hosts(),
			httpPort: 4590,
		});
		const frame = (await (await page.$("#testframe"))!.contentFrame())!;
		const visit = async () => {
			const navigated = page.waitForEvent("framenavigated", {
				predicate: (f) => f === frame && f.url().includes("/~/sj/"),
				timeout: 60000,
			});
			await page.evaluate((u) => (window as any).__runwayNavigate(u), url);
			await navigated;
			await frame.waitForLoadState("load", { timeout: 60000 });
			await page.waitForTimeout(3000);
		};
		await visit();
		await page.evaluate(() => {
			(document.getElementById("testframe") as HTMLIFrameElement).src =
				"about:blank";
		});
		await page.waitForTimeout(500);
		const s0 = await script();
		await visit();
		return { ...(await timings(frame)), script: (await script()) - s0 };
	} finally {
		await context.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const median = (xs: number[]) => {
	const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const KEYS = ["ttfb", "fcp", "dcl", "load", "script"];
for (const site of sites) {
	const store = new Store(path.join(DATA, site));
	const url = fs.readFileSync(path.join(DATA, site, "url.txt"), "utf8");
	const plain = await serveStore(store, 4590);
	const secure = await serveStoreHttps(store, HTTPS_PORT, tls);
	const out: Record<string, Sample[]> = {};
	for (let i = 0; i < N; i++)
		for (const mode of modes) {
			try {
				(out[mode] ??= []).push(await run(mode, store, url));
			} catch (e) {
				console.error(site, mode, (e as Error).message.split("\n")[0]);
			}
		}
	plain.close();
	secure.close();
	console.log(`\n${site} (repeat view)`);
	console.log("      " + KEYS.map((k) => k.padStart(7)).join(""));
	for (const mode of modes)
		console.log(
			mode.padEnd(6) +
				KEYS.map((k) =>
					Math.round(median((out[mode] ?? []).map((r) => r[k])))
						.toString()
						.padStart(7)
				).join("")
		);
}
process.exit(0);
