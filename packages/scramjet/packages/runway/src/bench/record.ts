// node src/bench/record.ts <name> <url> [settleMs]
// records every response a bare load of <url> gets into bench-data/<name>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { Store } from "./store.ts";

const [name, url, settle = "6000"] = process.argv.slice(2);
const dir = path.resolve(import.meta.dirname, "../../bench-data", name);
const store = new Store(dir);

const UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	userAgent: UA,
	viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const pending: Promise<void>[] = [];
page.on("response", (res) => {
	const req = res.request();
	if (!/^https?:/.test(req.url())) return;
	pending.push(
		(async () => {
			const headers = (await res.headersArray()).map(
				(h) => [h.name, h.value] as [string, string]
			);
			let body = Buffer.alloc(0);
			if (res.status() < 300 || res.status() >= 400) {
				try {
					body = await res.body();
				} catch {}
			}
			store.record(req.method(), req.url(), res.status(), headers, body);
		})()
	);
});
await page.goto(url, { waitUntil: "load", timeout: 60000 });
for (let i = 0; i < 5; i++) {
	await page.mouse.wheel(0, 800);
	await page.waitForTimeout(300);
}
await page.waitForTimeout(Number(settle));
await Promise.allSettled(pending);
store.save();
fs.writeFileSync(path.join(dir, "url.txt"), url);
console.log(
	`${name}: ${store.entries.length} responses, ${store.hosts().length} hosts`
);
await browser.close();
