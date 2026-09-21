import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";

// Reuse the workspace's existing browser-test dependency.
const require = createRequire(
	new URL("../../scramjet/packages/runway/package.json", import.meta.url)
);
const { chromium } = require("playwright");
let browser;
let server;
let fixtureURL;

before(async () => {
	server = createServer((request, response) => {
		if (request.url === "/data.json") {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify({ message: "Local fetch succeeded" }));
			return;
		}
		response.setHeader("Content-Type", "text/html");
		response.end(`<!doctype html><title>Browser fixture</title>
<h1>Local browser fixture</h1><button id="fetch">Fetch data</button><output id="result"></output>
<script>
document.getElementById("fetch").addEventListener("click", async () => {
 const response = await fetch("/data.json");
 document.getElementById("result").textContent = (await response.json()).message;
});
</script>`);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	fixtureURL = `http://127.0.0.1:${server.address().port}/`;
	browser = await chromium.launch({
		headless: true,
		...(process.env.CHROME_EXECUTABLE_PATH
			? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
			: { channel: "chrome" }),
	});
});

after(async () => {
	await browser?.close();
	server?.closeAllConnections();
	server?.close();
});

async function openShell(t) {
	const page = await browser.newPage();
	page.setDefaultTimeout(15_000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	t.after(async () => {
		await page.close();
		assert.deepEqual(errors, []);
	});
	await page.goto(process.env.BROWSER_URL || "http://localhost:6767/");
	await page.locator("[data-tab]").waitFor();
	await page.evaluate(async () => {
		// Import the URL Vite loaded, including its HMR timestamp, so bootstrap
		// does not run a second time.
		const resource = performance
			.getEntriesByType("resource")
			.find((entry) => new URL(entry.name).pathname === "/src/index.ts");
		globalThis.testShell = await import(resource.name);
		testShell.settingsService.settings.searchSuggestionsEnabled = false;
	});
	return page;
}

test("shell opens internal pages and loads a proxied localhost document", async (t) => {
	const page = await openShell(t);
	await page.evaluate(() =>
		testShell.tabsService.activetab.pushNavigate(new URL("puter://settings"))
	);
	await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
	await page.evaluate(
		(url) => testShell.tabsService.activetab.pushNavigate(new URL(url)),
		fixtureURL
	);
	const frame = page.frameLocator(".container.active iframe");
	await frame.getByRole("heading", { name: "Local browser fixture" }).waitFor();
	await frame.getByRole("button", { name: "Fetch data" }).click();
	await frame
		.locator("#result")
		.filter({ hasText: "Local fetch succeeded" })
		.waitFor();
	assert.equal(
		await page.evaluate(() => testShell.tabsService.activetab.url.href),
		fixtureURL
	);
});
