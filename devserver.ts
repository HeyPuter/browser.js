import { createServer } from "vite";
import fs from "node:fs/promises";
import { stdout } from "node:process";
import chalk from "chalk";
import { execSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import rspackConfig from "./rspack.config.ts";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import {
	black,
	logSuccess,
	printBanner,
	resetSuccessLog,
	runRspack,
} from "./packages/scramjet/devlib.ts";

const image = await fs.readFile("./assets/icon.png");

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

const puterBranding = Boolean(process.env.VITE_PUTER_BRANDING);

if (puterBranding) {
	process.env.VITE_ISOLATION_ORIGIN ||= `https://puter.zone`;
} else {
	process.env.VITE_WISP_URL ||= `ws://localhost:${WISP_PORT}/`;
	process.env.VITE_ISOLATION_ORIGIN ||= `http://localhost:${ISOLATION_PORT}`;
}

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

const accent = (text: string) => chalk.hex("#4799f1").bold(text);
const highlight = (text: string) => chalk.hex("#ffffff").bold(text);
const urlColor = (text: string) => chalk.hex("#64DFDF").underline(text);
const note = (text: string) => chalk.hex("#CDB4DB")(text);
const connector = chalk.hex("#8D99AE").dim("@");

const lines = [
	black()(`${highlight("BROWSER.JS DEV SERVER")}`),
	black()(
		`${accent("chrome")} ${connector} ${urlColor(
			`http://localhost:${CHROME_PORT}/`
		)}`
	),
	black()(
		`${accent("wisp")} ${connector} ${urlColor(
			process.env.VITE_WISP_URL ?? "(puter)"
		)}`
	),
	black()(
		`${accent("isolation zone")} ${connector} ${urlColor(
			process.env.VITE_ISOLATION_ORIGIN ?? ""
		)}`
	),
	black()(chalk.dim(`[${branch}] ${commit} browserjs/${version}`)),
];

printBanner(image, lines);

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

runRspack(rspackConfig);
