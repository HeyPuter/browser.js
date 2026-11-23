// A recorded copy of a site's responses, so a page can be loaded the same way
// many times, bare and proxied, without the network in the measurement.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";

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
		return [...new Set(this.entries.map((e) => new URL(e.url).hostname))];
	}

	lookup(method: string, url: string) {
		const u = new URL(url);
		u.hash = "";
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
export function serveStore(store: Store, port: number) {
	const server = http.createServer((req, res) => {
		const url = "https://" + req.headers.host + req.url;
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
		res.end(req.method === "HEAD" ? undefined : hit.body);
	});
	return new Promise<http.Server>((r) =>
		server.listen(port, "127.0.0.1", () => r(server))
	);
}
