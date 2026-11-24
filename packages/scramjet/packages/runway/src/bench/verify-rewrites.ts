// node src/bench/verify-rewrites.ts — script rewrites kept in Cache Storage
// work in a later session: a static import (whose rewritten URL carries the
// frame's prefix) resolves, a function stringifies to its own source (the
// sourcemap's offsets), and the second session really reused the rewrite
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

process.env.RUNWAY_PORT_BASE ??= "4580";
const { startHarness, PORT } = await import("../harness/scramjet/index.ts");
await startHarness();

const FN = `function answer(a, b) { return location.host + ":" + (a + b); }`;
const server = http.createServer((req, res) => {
	const p = (req.url ?? "/").split("?")[0];
	if (p === "/dep.js") {
		res.writeHead(200, { "content-type": "text/javascript" });
		return res.end(`export const dep = "dep ok";`);
	}
	if (p === "/main.js") {
		res.writeHead(200, { "content-type": "text/javascript" });
		return res.end(
			`import { dep } from "./dep.js";\n${FN}\nwindow.__result = { dep, call: answer(1, 2), src: answer.toString() };`
		);
	}
	res.writeHead(200, { "content-type": "text/html" });
	res.end(`<!doctype html><script type="module" src="/main.js"></script>`);
});
await new Promise<void>((r) => server.listen(4597, "127.0.0.1", () => r()));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sj-verify-"));
async function session(mark: boolean) {
	const context = await chromium.launchPersistentContext(dir, {
		headless: true,
	});
	try {
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(`http://localhost:${PORT}/`);
		await page.waitForFunction(() => (window as any).__runwayNavigate);
		await page.evaluate(() => {
			(window as any).__runwayCleartextSite = {
				roots: ["verify.test"],
				httpPort: 4597,
			};
		});
		if (mark) {
			// tag what is stored, to see it come back out
			await page.evaluate(async () => {
				for (const name of await caches.keys()) {
					if (!name.startsWith("$scramjet$rewrites:")) continue;
					const cache = await caches.open(name);
					for (const req of await cache.keys()) {
						const res = (await cache.match(req))!;
						const body =
							(await res.text()) +
							"\nwindow.__fromCache = (window.__fromCache || 0) + 1;";
						await cache.put(req, new Response(body, { headers: res.headers }));
					}
				}
			});
		}
		const frame = (await (await page.$("#testframe"))!.contentFrame())!;
		await page.evaluate(() =>
			(window as any).__runwayNavigate("https://verify.test/")
		);
		await frame.waitForFunction(() => (window as any).__result, null, {
			timeout: 30000,
		});
		const result = await frame.evaluate(() => ({
			...(window as any).__result,
			fromCache: (window as any).__fromCache ?? 0,
		}));
		const stored = await page.evaluate(async () => {
			let n = 0;
			for (const name of await caches.keys())
				if (name.startsWith("$scramjet$rewrites:"))
					n += (await (await caches.open(name)).keys()).length;
			return n;
		});
		const prefix = await page.evaluate(
			() => (window as any).__runwayScramjetFrame.prefix
		);
		return { ...result, stored, prefix };
	} finally {
		await context.close();
	}
}

const first = await session(false);
const second = await session(true);
fs.rmSync(dir, { recursive: true, force: true });
const ok = (r: any) =>
	r.dep === "dep ok" && r.call === "verify.test:3" && r.src === FN;
console.log(
	"first session  ",
	ok(first) ? "ok" : "WRONG",
	JSON.stringify(first)
);
console.log(
	"second session ",
	ok(second) ? "ok" : "WRONG",
	JSON.stringify(second)
);
console.log(
	"different prefixes:",
	first.prefix !== second.prefix,
	" entries stored:",
	second.stored,
	" scripts served from the stored rewrites:",
	second.fromCache
);
server.close();
process.exit(0);
