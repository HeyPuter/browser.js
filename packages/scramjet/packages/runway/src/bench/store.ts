// A recorded copy of a site's responses, so a page can be loaded the same way
// many times, bare and proxied, without the network in the measurement.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

export type Entry = {
	method: string;
	url: string;
	status: number;
	headers: [string, string][];
	file: string;
};

// headers that describe the recorded transfer, not the response
const DROP = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
	"alt-svc",
	"strict-transport-security",
	"report-to",
	"nel",
]);

export class Store {
	entries: Entry[] = [];
	byKey = new Map<string, Entry>();
	byPath = new Map<string, Entry>();
	dir: string;
	constructor(dir: string) {
		this.dir = dir;
		// a directory with static.json ({host, root}) is served from disk
		const st = path.join(dir, "static.json");
		if (fs.existsSync(st))
			this.static = JSON.parse(fs.readFileSync(st, "utf8"));
		const index = path.join(dir, "index.json");
		if (fs.existsSync(index)) {
			for (const e of JSON.parse(fs.readFileSync(index, "utf8"))) this.add(e);
		}
	}

	private add(e: Entry) {
		this.entries.push(e);
		this.byKey.set(e.method + " " + e.url, e);
		const u = new URL(e.url);
		const k = e.method + " " + u.host + u.pathname;
		if (!this.byPath.has(k)) this.byPath.set(k, e);
	}

	record(
		method: string,
		url: string,
		status: number,
		headers: [string, string][],
		body: Buffer
	) {
		if (this.byKey.has(method + " " + url)) return;
		const file = crypto.createHash("sha1").update(body).digest("hex");
		fs.mkdirSync(path.join(this.dir, "bodies"), { recursive: true });
		const p = path.join(this.dir, "bodies", file);
		if (!fs.existsSync(p)) fs.writeFileSync(p, body);
		this.add({
			method,
			url,
			status,
			headers: headers.filter(([k]) => !DROP.has(k.toLowerCase())),
			file,
		});
	}

	save() {
		fs.writeFileSync(
			path.join(this.dir, "index.json"),
			JSON.stringify(this.entries, null, 1)
		);
	}

	hosts() {
		if (this.static) return [this.static.host];
		return [...new Set(this.entries.map((e) => new URL(e.url).hostname))];
	}

	/** serve files under `root` for https://`host`/... */
	static: { host: string; root: string } | null = null;

	lookup(method: string, url: string) {
		const u = new URL(url);
		u.hash = "";
		if (this.static && u.host === this.static.host) {
			let p = path.join(this.static.root, decodeURIComponent(u.pathname));
			if (!p.startsWith(this.static.root)) return null;
			if (fs.existsSync(p) && fs.statSync(p).isDirectory())
				p = path.join(p, "index.html");
			if (!fs.existsSync(p)) return null;
			return {
				status: 200,
				headers: [["content-type", mimeFor(p)]] as [string, string][],
				body: fs.readFileSync(p),
			};
		}
		let e = this.byKey.get(method + " " + u.href);
		if (!e && method === "HEAD") e = this.byKey.get("GET " + u.href);
		if (!e) e = this.byPath.get(method + " " + u.host + u.pathname);
		if (!e) return null;
		return {
			status: e.status,
			headers: e.headers,
			body: fs.readFileSync(path.join(this.dir, "bodies", e.file)),
		};
	}
}

// the cleartext transport sends https://host/path to http://127.0.0.1:port/path
// with the logical Host header
/** the same, over TLS, for a bare browser pointed here by its resolver */
export function serveStoreHttps(
	store: Store,
	port: number,
	tls: { key: Buffer; cert: Buffer }
) {
	const server = https.createServer(tls, storeHandler(store, null));
	return new Promise<https.Server>((r) =>
		server.listen(port, "127.0.0.1", () => r(server))
	);
}

export function serveStore(
	store: Store,
	port: number,
	// a first byte `latency` ms after the request, then the body at `kbps`
	net: { latency: number; kbps: number } | null = null
) {
	const server = http.createServer(storeHandler(store, net));
	return new Promise<http.Server>((r) =>
		server.listen(port, "127.0.0.1", () => r(server))
	);
}

function storeHandler(
	store: Store,
	net: { latency: number; kbps: number } | null
): http.RequestListener {
	return async (req, res) => {
		if (net?.latency) await new Promise((r) => setTimeout(r, net.latency));
		// the bench's fetch transport cannot set Host, and says it here
		const bench = req.headers["x-bench-host"];
		if (bench) {
			res.setHeader("access-control-allow-origin", "*");
			res.setHeader("access-control-expose-headers", "*");
			if (req.method === "OPTIONS") {
				res.setHeader("access-control-allow-headers", "*");
				res.setHeader("access-control-allow-methods", "*");
				return res.end();
			}
		}
		if (
			req.method === "OPTIONS" &&
			req.headers["access-control-request-method"]
		) {
			res.setHeader("access-control-allow-origin", "*");
			res.setHeader("access-control-allow-headers", "*");
			res.setHeader("access-control-allow-methods", "*");
			return res.end();
		}
		const url = "https://" + (bench ?? req.headers.host) + req.url;
		const hit = store.lookup(req.method!, url);
		if (!hit) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not recorded");
			return;
		}
		for (const [k, v] of hit.headers) {
			try {
				res.appendHeader(k, v);
			} catch {}
		}
		res.statusCode = hit.status;
		if (req.method === "HEAD") return res.end();
		if (!net?.kbps) return res.end(hit.body);
		// 16KB at a time, paced to the bandwidth
		const CHUNK = 16384;
		const perChunk = (CHUNK * 8) / net.kbps;
		res.flushHeaders();
		for (let at = 0; at < hit.body.length; at += CHUNK) {
			res.write(hit.body.subarray(at, at + CHUNK));
			if (at + CHUNK < hit.body.length)
				await new Promise((r) => setTimeout(r, perChunk));
		}
		res.end();
	};
}

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".wasm": "application/wasm",
};
function mimeFor(p: string) {
	return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}
