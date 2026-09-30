// Saves every script real sites load - external and inline - as a corpus for the rewriter.
//
//   node tools/capture-script-corpus.mjs <out dir> [urls...]     # default: tools/benchmark-sites.txt
//   cd packages/scramjet/packages/core/rewriter
//   cargo run --release -p native -- verify <out dir>
//
// `native verify` rewrites every file with each rewriter, checks the output still parses, and
// reports ms/MB for each - which is the rewrite's cost on code as it is actually shipped, rather
// than on a handful of libraries. Scripts are named by content hash, so recapturing into the same
// directory only adds what changed. Expect a few hundred MB for the default list.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { chromium, root } from "./benchmark-lib.mjs";

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir) {
	console.error("usage: capture-script-corpus.mjs <out dir> [urls...]");
	process.exit(2);
}
const sites = urls.length
	? urls
	: readFileSync(path.join(root, "tools/benchmark-sites.txt"), "utf8")
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));

const browser = await chromium.launch({ headless: true });
for (const url of sites) {
	const u = new URL(url);
	const name =
		u.hostname.replace(/^www\./, "") +
		(u.pathname.length > 1 ? u.pathname.replace(/\W+/g, "_") : "");
	const dir = path.join(outDir, name);
	mkdirSync(dir, { recursive: true });
	const context = await browser.newContext({
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		viewport: { width: 1366, height: 900 },
		locale: "en-US",
	});
	const page = await context.newPage();
	let files = 0,
		bytes = 0,
		note = "";
	const save = (body) => {
		if (!body || body.length < 50) return;
		const file = path.join(
			dir,
			crypto.createHash("sha1").update(body).digest("hex").slice(0, 16) + ".js"
		);
		if (existsSync(file)) return;
		writeFileSync(file, body);
		files++;
		bytes += body.length;
	};
	page.on("response", async (r) => {
		if (r.request().resourceType() !== "script") return;
		try {
			save(await r.text());
		} catch {
			// a redirect, or a response the page was closed before
		}
	});
	try {
		await page.goto(url, { waitUntil: "load", timeout: 45000 });
		await page.waitForTimeout(4000);
		await page.mouse.wheel(0, 3000);
		await page.waitForTimeout(2500);
		await page.mouse.wheel(0, 6000);
		await page.waitForTimeout(2500);
		// inline classic and module scripts; data blocks (JSON, templates) are not JS
		const inline = await page.evaluate(() =>
			[...document.querySelectorAll("script:not([src])")]
				.filter(
					(s) =>
						!s.type ||
						/^(module|(text|application)\/(java|ecma)script)$/i.test(s.type)
				)
				.map((s) => s.textContent)
		);
		for (const body of inline) save(body);
	} catch (e) {
		note = String(e.message).split("\n")[0].slice(0, 120);
	}
	console.log(
		`${name.padEnd(36)} ${String(files).padStart(4)} new scripts  ${(bytes / 1e6).toFixed(2)} MB  ${note}`
	);
	await context.close();
}
await browser.close();
