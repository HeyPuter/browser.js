import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";

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
const speedometerRoot = process.env.SPEEDOMETER_ROOT ?? "/tmp/speedometer-3.1";
const baselineRoot = process.env.PRE_IDL_ROOT ?? "/tmp/browserjs-preidl-bench";
const iterations = Number(process.env.SPEEDOMETER_ITERATIONS ?? 10);
const variant = process.env.SPEEDOMETER_VARIANT ?? "chromium";
const outputDir =
	process.env.SPEEDOMETER_OUTPUT_DIR ?? "/tmp/speedometer-results";
const timeoutMs = Number(process.env.SPEEDOMETER_TIMEOUT_MS ?? 900000);
const suites = process.env.SPEEDOMETER_SUITES;

const benchmark = express();
benchmark.use(express.static(speedometerRoot));
const benchmarkServer = http.createServer(benchmark);
await new Promise((resolve) => benchmarkServer.listen(4600, resolve));

let baselineServer;
if (variant !== "chromium") {
	await startHarness();
	if (variant === "pre-idl") {
		const app = express();
		app.use(
			"/scramjet",
			express.static(
				path.join(baselineRoot, "packages/scramjet/packages/core/dist")
			)
		);
		app.use(
			"/controller",
			express.static(
				path.join(baselineRoot, "packages/scramjet/packages/controller/dist")
			)
		);
		app.use(
			"/libcurl",
			express.static(
				path.join(
					root,
					"packages/scramjet/packages/runway/node_modules/@mercuryworkshop/libcurl-transport/dist"
				)
			)
		);
		app.use(
			express.static(
				path.join(
					root,
					"packages/scramjet/packages/runway/src/harness/scramjet/public"
				)
			)
		);
		baselineServer = http.createServer(app);
		await new Promise((resolve) => baselineServer.listen(4510, resolve));
	}
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => {
	if (errors.length < 100) errors.push(error.stack ?? error.message);
});
page.on("console", (message) => {
	if (message.type() !== "error") return;
	if (message.text().includes("Wake Lock permission request denied")) return;
	if (message.text().includes("attribute") && message.text().includes("NaN"))
		return;
	if (errors.length < 100)
		errors.push(
			`${message.text()} @ ${message.location().url}:${message.location().lineNumber}`
		);
});
let failed = false;
const target = `http://localhost:4600/?iterationCount=${iterations}&startAutomatically${suites ? `&suites=${encodeURIComponent(suites)}` : ""}`;
try {
	let frame;
	if (variant === "chromium") {
		await page.goto(target, { waitUntil: "domcontentloaded" });
		frame = page.mainFrame();
	} else {
		const harness =
			variant === "pre-idl"
				? "http://localhost:4510/"
				: "http://localhost:4500/";
		await page.goto(harness);
		await page.waitForFunction(
			() => typeof window.__runwayNavigate === "function",
			{ timeout: 30000 }
		);
		await page.evaluate((url) => window.__runwayNavigate(url), target);
		await page
			.frameLocator("#testframe")
			.locator("main")
			.waitFor({ state: "attached", timeout: 120000 });
		frame = page
			.frames()
			.find((f) => f !== page.mainFrame() && f.url().includes("4600"));
		if (!frame)
			throw new Error(
				"Speedometer frame missing: " +
					page
						.frames()
						.map((f) => f.url())
						.join(", ")
			);
	}

	const started = Date.now();
	const interval = setInterval(async () => {
		try {
			const progress = await frame.evaluate(() => ({
				done: document.getElementById("info-progress")?.textContent,
				suite: document.getElementById("info-label")?.textContent,
				result: document.getElementById("result-number")?.textContent,
			}));
			console.log(
				"PROGRESS",
				variant,
				Math.round((Date.now() - started) / 1000),
				JSON.stringify(progress)
			);
		} catch (error) {
			console.log("PROGRESS_ERROR", String(error).split("\n")[0]);
		}
	}, 30000);
	try {
		await frame.waitForFunction(
			() => window.benchmarkClient?._hasResults === true,
			undefined,
			{ timeout: timeoutMs }
		);
	} finally {
		clearInterval(interval);
	}
	const result = await frame.evaluate(() => ({
		score: document.getElementById("result-number")?.textContent,
		confidence: document.getElementById("confidence-number")?.textContent,
		progress: document.getElementById("info-progress")?.textContent,
		metrics: window.benchmarkClient.metrics,
		measurements: window.benchmarkClient._measuredValuesList,
	}));
	const record = {
		variant,
		iterations,
		suites: suites ?? "all",
		seconds: (Date.now() - started) / 1000,
		result,
		errors,
	};
	mkdirSync(outputDir, { recursive: true });
	const output = path.join(
		outputDir,
		`${variant}-${iterations}${suites ? "-filtered" : ""}.json`
	);
	writeFileSync(output, JSON.stringify(record, null, 2));
	console.log(
		"RESULT",
		variant,
		JSON.stringify({
			score: result.score,
			confidence: result.confidence,
			progress: result.progress,
			seconds: record.seconds,
			errors: errors.slice(0, 8),
			output,
		})
	);
	if (!result.score || result.score === "Error") failed = true;
} catch (error) {
	failed = true;
	console.error("RUN_ERROR", variant, error);
	console.error("PAGE_ERRORS", errors);
} finally {
	await context.close();
	await browser.close();
	if (baselineServer)
		await new Promise((resolve) => baselineServer.close(resolve));
	await new Promise((resolve) => benchmarkServer.close(resolve));
	process.exit(failed ? 1 : 0);
}
