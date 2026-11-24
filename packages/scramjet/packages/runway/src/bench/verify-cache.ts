// node src/bench/verify-cache.ts — HttpCachePlugin, through the `/?cache`
// harness: documents still stream, cacheable responses come from the cache
import http from "node:http";
import { chromium } from "playwright";
process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
await startHarness();
const hits: Record<string, number> = {};
let earlyAt = 0,
	endAt = 0;
const server = http.createServer(async (req, res) => {
	const p = (req.url ?? "/").split("?")[0];
	hits[p] = (hits[p] ?? 0) + 1;
	if (p === "/doc") {
		res.writeHead(200, {
			"content-type": "text/html",
			"cache-control": "max-age=3600",
		});
		res.write(
			`<!doctype html><script>fetch("/early")</script>${" ".repeat(4096)}`
		);
		await new Promise((r) => setTimeout(r, 1500));
		endAt = Date.now();
		res.end(`<p>done</p><script src="/asset.js"></script>`);
		return;
	}
	if (p === "/early") earlyAt = Date.now();
	if (p === "/asset.js") {
		res.writeHead(200, {
			"content-type": "text/javascript",
			"cache-control": "max-age=3600",
		});
		return res.end(
			`window.__asset = (window.__asset || 0) + 1; document.title = "asset ran";`
		);
	}
	res.writeHead(200, { "content-type": "text/plain" });
	res.end("ok");
});
await new Promise<void>((r) => server.listen(4595, "127.0.0.1", () => r()));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/?cache`);
await page.waitForFunction(() => (window as any).__runwayNavigate);
await page.evaluate(
	() =>
		((window as any).__runwayCleartextSite = {
			roots: ["cache.test"],
			httpPort: 4595,
		})
);
const frame = (await (await page.$("#testframe"))!.contentFrame())!;
async function visit(u: string) {
	const nav = page.waitForEvent("framenavigated", {
		predicate: (f) => f === frame && f.url().includes("/~/sj/"),
	});
	await page.evaluate((u) => (window as any).__runwayNavigate(u), u);
	await nav;
	await frame.waitForLoadState("load");
	await frame.waitForFunction(() => document.title === "asset ran");
}
await visit("https://cache.test/doc");
const streamed = earlyAt > 0 && earlyAt < endAt;
await visit("https://cache.test/doc?again");
await page.waitForTimeout(500);
console.log(
	"document streamed through the plugin:",
	streamed,
	`(early request ${endAt - earlyAt}ms before the body ended)`
);
console.log(
	"asset.js requests over two visits:",
	hits["/asset.js"],
	"(1 = second came from the cache)"
);
await browser.close();
server.close();
process.exit(0);
