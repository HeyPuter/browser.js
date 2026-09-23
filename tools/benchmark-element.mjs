import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const express = require(
	path.join(root, "packages/scramjet/packages/runway/node_modules/express")
);
const { chromium } = require(
	path.join(root, "packages/scramjet/packages/runway/node_modules/playwright")
);
const { startHarness } = await import(
	"../packages/scramjet/packages/runway/src/harness/scramjet/index.ts"
);
const baseline = process.env.PRE_IDL_ROOT ?? "/tmp/browserjs-preidl-bench";
const extraScript = readFileSync(
	path.join(root, "tools/benchmark-element-app.js"),
	"utf8"
);

const appScript = `
const root = document.getElementById("bench-root");
const url = "https://example.com/products/sku-";
function dashboard() {
  root.innerHTML = "";
  const rows = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 180; i++) {
    const row = document.createElement("div");
    row.className = "row";
    row.dataset.id = String(i);
    row.innerHTML = '<a class="title">Item</a><span class="state"></span><button>Open</button>';
    frag.append(row);
    rows.push(row);
  }
  root.append(frag);
  const start = performance.now();
  let digest = 0;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const link = row.querySelector("a.title");
      link.href = url + i + "?view=" + pass;
      link.textContent = "Product " + i;
      row.classList.toggle("selected", (i + pass) % 3 === 0);
      row.setAttribute("aria-label", "Product " + i);
      row.dataset.status = pass % 2 ? "ready" : "pending";
      row.querySelector(".state").textContent = row.dataset.status;
      digest += row.matches(".selected") ? 1 : 0;
      digest += link.getAttribute("href").length;
    }
  }
  return { ms: performance.now() - start, digest };
}
function feed() {
  root.innerHTML = "";
  let digest = 0;
  const start = performance.now();
  for (let page = 0; page < 24; page++) {
    let html = "";
    for (let i = 0; i < 24; i++) {
      const id = page * 24 + i;
      html += '<article class="card" data-id="' + id + '"><a href="' + url + id + '">Product ' + id + '</a><img src="https://example.com/images/' + id + '.png"><p>Details</p></article>';
    }
    root.insertAdjacentHTML("beforeend", html);
    const cards = root.querySelectorAll("article.card");
    for (let i = cards.length - 24; i < cards.length; i++) {
      const card = cards[i];
      digest += Number(card.dataset.id);
      digest += card.querySelector("a").getAttribute("href").length;
      digest += card.querySelector("img").getAttribute("src").length;
    }
  }
  return { ms: performance.now() - start, digest };
}
function form() {
  root.innerHTML = "";
  const inputs = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 120; i++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.name = "field-" + i;
    label.append("Field " + i, input);
    frag.append(label);
    inputs.push(input);
  }
  root.append(frag);
  const start = performance.now();
  let digest = 0;
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      input.value = "value-" + pass + "-" + i;
      input.setAttribute("data-dirty", pass % 2 ? "yes" : "no");
      input.toggleAttribute("required", i % 4 === 0);
      input.setAttribute("aria-invalid", i % 7 === 0 ? "true" : "false");
      digest += input.getAttribute("data-dirty").length;
      digest += input.hasAttribute("required") ? 1 : 0;
      digest += input.attributes.length;
    }
  }
  return { ms: performance.now() - start, digest };
}
window.runBench = { dashboard, feed, form };
`;

const target = express();
target.get("/", (_req, res) =>
	res
		.type("html")
		.send(
			'<!doctype html><html><body><div id="bench-root"></div><script src="/app.js"></script></body></html>'
		)
);
target.get("/app.js", (_req, res) =>
	res.type("js").send(appScript + "\n" + extraScript)
);
const targetServer = http.createServer(target);
await new Promise((resolve) => targetServer.listen(4600, resolve));

await startHarness();
const baseApp = express();
baseApp.use(
	"/scramjet",
	express.static(path.join(baseline, "packages/scramjet/packages/core/dist"))
);
baseApp.use(
	"/controller",
	express.static(
		path.join(baseline, "packages/scramjet/packages/controller/dist")
	)
);
baseApp.use(
	"/libcurl",
	express.static(
		path.join(
			root,
			"packages/scramjet/packages/runway/node_modules/@mercuryworkshop/libcurl-transport/dist"
		)
	)
);
baseApp.use(
	express.static(
		path.join(
			root,
			"packages/scramjet/packages/runway/src/harness/scramjet/public"
		)
	)
);
const baseServer = http.createServer(baseApp);
await new Promise((resolve) => baseServer.listen(4510, resolve));

const browser = await chromium.launch({ headless: true });
const results = {};
let scenarios;
const variants = [
	["pre-idl", "http://localhost:4510/"],
	["rewrite", "http://localhost:4500/"],
	["chromium", "http://localhost:4600/"],
];
if (process.env.BENCH_REVERSE === "1") variants.reverse();
let runError;
try {
	for (const [name, url] of variants) {
		const context = await browser.newContext();
		const page = await context.newPage();
		page.on("pageerror", (error) =>
			console.error(name, "page error:", error.message)
		);
		await page.goto(url);
		let frame = page.mainFrame();
		if (name !== "chromium") {
			await page.waitForFunction(
				() => typeof window.__runwayNavigate === "function",
				{ timeout: 30000 }
			);
			await page.evaluate(() =>
				window.__runwayNavigate("http://localhost:4600/")
			);
			await page
				.frameLocator("#testframe")
				.locator("#bench-root")
				.waitFor({ state: "attached", timeout: 30000 });
			frame = page
				.frames()
				.find((f) => f !== page.mainFrame() && f.url().includes("4600"));
			if (!frame)
				throw new Error(
					"Target frame missing: " +
						page
							.frames()
							.map((f) => f.url())
							.join(", ")
				);
		}
		await frame.waitForFunction(() => window.runBench);
		const names = (
			await frame.evaluate(() => Object.keys(window.runBench))
		).filter(
			(name) =>
				!process.env.BENCH_FILTER || name.includes(process.env.BENCH_FILTER)
		);
		if (scenarios && names.join() !== scenarios.join())
			throw new Error("Scenario lists differ");
		scenarios = names;
		results[name] = {};
		for (const scenario of scenarios) {
			try {
				for (let i = 0; i < 2; i++)
					await frame.evaluate((key) => window.runBench[key](), scenario);
				const samples = [];
				let digest;
				for (let i = 0; i < 8; i++) {
					const result = await frame.evaluate(
						(key) => window.runBench[key](),
						scenario
					);
					samples.push(result.ms);
					digest = result.digest;
				}
				samples.sort((a, b) => a - b);
				results[name][scenario] = {
					medianMs: (samples[3] + samples[4]) / 2,
					minMs: samples[0],
					maxMs: samples.at(-1),
					digest,
					samples,
				};
			} catch (error) {
				results[name][scenario] = { error: String(error).split("\n")[0] };
			}
			console.log(name, scenario, JSON.stringify(results[name][scenario]));
		}
		await context.close();
	}
	const mismatches = [];
	for (const scenario of scenarios) {
		if (variants.some(([name]) => results[name][scenario].error)) {
			mismatches.push({
				scenario,
				errors: Object.fromEntries(
					variants.map(([name]) => [
						name,
						results[name][scenario].error ?? null,
					])
				),
			});
			continue;
		}
		const digests = variants.map(([name]) => results[name][scenario].digest);
		if (!digests.every((value) => value === digests[0])) {
			mismatches.push({
				scenario,
				digests: Object.fromEntries(
					variants.map(([name], index) => [name, digests[index]])
				),
			});
		}
	}
	console.log("MISMATCHES", JSON.stringify(mismatches));
	console.log("RESULT_JSON", JSON.stringify(results));
} catch (error) {
	runError = error;
	console.error(error);
} finally {
	await browser.close();
	await new Promise((resolve) => baseServer.close(resolve));
	await new Promise((resolve) => targetServer.close(resolve));
	process.exit(runError ? 1 : 0);
}
