import { createServer } from "vite";
import Chafa from "chafa-wasm";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { stdout } from "node:process";
import chalk from "chalk";
import { execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import rspack from "@rspack/core";
import rspackConfig from "./rspack.config.ts";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const chafa = await Chafa();
const imageToAnsi = promisify(chafa.imageToAnsi);

const image = await fs.readFile(
	"./packages/scramjet/assets/scramjet-mini-noalpha.png"
);

const commit = execSync("git rev-parse --short HEAD", {
	encoding: "utf-8",
}).replace(/\r?\n|\r/g, "");
const branch = execSync("git rev-parse --abbrev-ref HEAD", {
	encoding: "utf-8",
}).replace(/\r?\n|\r/g, "");
const packagejson = JSON.parse(
	await fs.readFile("./packages/scramjet/package.json", "utf-8")
);
const version = packagejson.version;

const CHROME_PORT = process.env.CHROME_PORT || 6767;
const WISP_PORT = process.env.WISP_PORT || 6768;
const ISOLATION_PORT = process.env.ISOLATION_PORT || 5233;

process.env.VITE_WISP_URL =
	process.env.VITE_WISP_URL || `ws://localhost:${WISP_PORT}/`;
process.env.VITE_ISOLATION_ORIGIN =
	process.env.VITE_ISOLATION_ORIGIN || `http://localhost:${ISOLATION_PORT}`;

const sandboxRoot = path.resolve("./packages/sandbox");

const wispserver = http.createServer((req, res) => {
	res.writeHead(200, { "Content-Type": "text/plain" });
	res.end("wisp server js rewrite");
});

wispserver.on("upgrade", (req, socket, head) => {
	wisp.routeRequest(req, socket, head);
});

wispserver.listen(Number(WISP_PORT));

const server = await createServer({
	configFile: "./packages/chrome/vite.config.ts",
	root: "./packages/chrome",
	server: {
		port: Number(CHROME_PORT),
		strictPort: true,
	},
});

await server.listen();

const imageWidth = 10;
const totalWidth = 60;
const { ansi: rawAnsi } = await imageToAnsi(image.buffer, {
	format: chafa.ChafaPixelMode.CHAFA_PIXEL_MODE_SYMBOLS.value,
	width: imageWidth,
	fontRatio: 0.5,
	colors: chafa.ChafaCanvasMode.CHAFA_CANVAS_MODE_TRUECOLOR.value,
	colorExtractor: chafa.ChafaColorExtractor.CHAFA_COLOR_EXTRACTOR_AVERAGE.value,
	colorSpace: chafa.ChafaColorSpace.CHAFA_COLOR_SPACE_RGB.value,
	symbols: "block+border+space-wide-inverted",
	fill: "full",
	fg: 0xffffff,
	bg: 0x000001,
	fgOnly: false,
	dither: chafa.ChafaDitherMode.CHAFA_DITHER_MODE_NONE.value,
	ditherGrainWidth: 4,
	ditherGrainHeight: 4,
	ditherIntensity: 1.0,
	preprocess: true,
	threshold: 0.5,
	optimize: 5,
	work: 5,
});

function stripAnsi(s: string) {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const ansiLines = rawAnsi.split(/\r?\n/).filter((l) => l.length > 0);
const contentWidth = ansiLines.reduce((max, line) => {
	const w = stripAnsi(line).length;
	return w > max ? w : max;
}, 0);

function black() {
	return chalk.bgHex("000001");
}

const accent = (text: string) => chalk.hex("#f1855bff").bold(text);
const highlight = (text: string) => chalk.hex("#fdd76cff").bold(text);
const urlColor = (text: string) => chalk.hex("#64DFDF").underline(text);
const note = (text: string) => chalk.hex("#CDB4DB")(text);
const connector = chalk.hex("#8D99AE").dim("@");

const lines = [
	black()(`${highlight("SCRAMJET DEV SERVER")}`),
	black()(
		`${accent("chrome")} ${connector} ${urlColor(
			`http://localhost:${CHROME_PORT}/`
		)}`
	),
	black()(
		`${accent("wisp")} ${connector} ${urlColor(
			process.env.VITE_WISP_URL ?? ""
		)}`
	),
	black()(
		`${accent("isolation zone")} ${connector} ${urlColor(
			process.env.VITE_ISOLATION_ORIGIN ?? ""
		)}`
	),
	black()(chalk.dim(`[${branch}] ${commit} scramjet/${version}`)),
];

const PAD_LEFT = 2;
const PAD_TOP = 1;
const PAD_BOTTOM = 1;

function blackSpaces(count: number) {
	count = Math.abs(count);
	return black()(" ".repeat(count));
}

let out = "";
out += (blackSpaces(totalWidth) + "\n").repeat(PAD_TOP);

for (let i = 0; i < ansiLines.length; i++) {
	out += blackSpaces(PAD_LEFT);

	const line = ansiLines[i];
	const text = lines[i];
	const strippedLen = stripAnsi(line).length;
	const extraSpaces = contentWidth - strippedLen;

	if (text) {
		const textpad = 2;
		out +=
			line +
			blackSpaces(textpad) +
			text +
			blackSpaces(
				extraSpaces +
					totalWidth -
					contentWidth -
					PAD_LEFT -
					textpad -
					stripAnsi(text).length
			);
	} else {
		out +=
			line + blackSpaces(extraSpaces + totalWidth - contentWidth - PAD_LEFT);
	}
	out += "\n";
}
out += (blackSpaces(totalWidth) + "\n").repeat(PAD_BOTTOM);

stdout.write("\x1b[2J\x1b[H");
stdout.write(out);

let successCount = 0;
let lastSuccessCollapsed = false;

function resetSuccessLog() {
	successCount = 0;
	lastSuccessCollapsed = false;
}

function logSuccess() {
	successCount += 1;
	const suffix = successCount > 1 ? chalk.dim(` (x${successCount})`) : "";
	if (lastSuccessCollapsed && stdout.isTTY) {
		stdout.moveCursor(0, -1);
		stdout.clearLine(0);
		stdout.cursorTo(0);
	}
	stdout.write(`${chalk.green("Compiled successfully.")}${suffix}\n`);
	lastSuccessCollapsed = true;
}

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

function getMimeType(filePath: string) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_TYPES[ext] || "application/octet-stream";
}

async function resolveSandboxPath(pathname: string) {
	let normalizedPath = decodeURIComponent(pathname);
	if (normalizedPath.endsWith("/")) {
		normalizedPath += "index.html";
	}
	if (normalizedPath === "/") {
		normalizedPath = "/index.html";
	}
	const resolvedPath = path.resolve(sandboxRoot, `.${normalizedPath}`);
	if (!resolvedPath.startsWith(sandboxRoot)) {
		return null;
	}

	try {
		const stat = await fs.stat(resolvedPath);
		if (stat.isDirectory()) {
			const indexPath = path.join(resolvedPath, "index.html");
			try {
				await fs.access(indexPath);
				return indexPath;
			} catch {
				return null;
			}
		}
		return resolvedPath;
	} catch {
		return null;
	}
}

const staticServer = http.createServer((req, res) => {
	void (async () => {
		const method = req.method ?? "GET";
		if (method !== "GET" && method !== "HEAD") {
			res.statusCode = 405;
			res.setHeader("Allow", "GET, HEAD");
			res.end("Method Not Allowed");
			return;
		}

		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const filePath = await resolveSandboxPath(requestUrl.pathname);
		if (!filePath) {
			res.statusCode = 404;
			res.end("Not Found");
			return;
		}

		try {
			const mimeType = getMimeType(filePath);
			res.statusCode = 200;
			res.setHeader("Content-Type", mimeType);
			if (method === "HEAD") {
				res.end();
				return;
			}

			const stream = createReadStream(filePath);
			stream.on("error", () => {
				if (!res.headersSent) {
					res.statusCode = 500;
				}
				res.end("Internal Server Error");
			});
			stream.pipe(res);
		} catch (error) {
			console.error("Failed to serve sandbox asset", error);
			if (!res.headersSent) {
				res.statusCode = 500;
			}
			res.end("Internal Server Error");
		}
	})().catch((error) => {
		console.error("Unhandled sandbox request error", error);
		if (!res.headersSent) {
			res.statusCode = 500;
		}
		res.end("Internal Server Error");
	});
});

staticServer.on("clientError", (_err, socket) => {
	socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

staticServer.listen(Number(ISOLATION_PORT), () => {
	resetSuccessLog();
});

const compiler = rspack(rspackConfig);
compiler.watch({}, (err, stats) => {
	if (err) {
		resetSuccessLog();
		stdout.write(chalk.red("Build failed:\n"));
		stdout.write(err.message + "\n");
		return;
	}
	if (!stats) return;

	const statList = Array.isArray((stats as any).stats)
		? (stats as any).stats
		: [stats];

	for (const stat of statList) {
		const text = stat.toString({ colors: false, modules: false });
		if (text.includes("compiled successfully")) {
			logSuccess();
		} else {
			resetSuccessLog();
			console.log(text);
		}
	}
});
