/**
 * Reader for an sbxdiff network store, and the HTTP endpoint the in-page
 * `SbxdiffTransport` fetches from.
 *
 * The store is written by `base/sbxdiff_net_store.cc` as one file per response:
 *
 *     "SBXD2\n" url \n mime \n encoding \n <header_bytes> \n <raw_headers> body
 *
 * `raw_headers` is Chromium's `net::HttpResponseHeaders::raw_headers()`: a NUL
 * separated status line and field list, which is why it is length-prefixed
 * rather than newline-delimited. Files without the magic are the older
 * `url \n mime \n encoding \n body` and carry no headers.
 *
 * The filename is derived from two `base::PersistentHash` values of the URL.
 * This reader deliberately does NOT reimplement that hash -- getting a
 * Chromium hash subtly wrong in JS would produce silent misses that look like
 * the sandbox diverging. It indexes the directory by reading each file's URL
 * line instead, which is exact by construction.
 */

import express from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const HERE_TRACES = path.join(import.meta.dirname, ".traces");

export type StoredResponse = {
	url: string;
	mime: string;
	encoding: string;
	/** HTTP status; 200 for a store written before headers were recorded. */
	status: number;
	/** Header name/value pairs, in the order they were received. */
	headers: [string, string][];
	/** The request body that produced this response, when there was one. */
	requestBody: Buffer;
	body: Buffer;
};

/**
 * FNV-1a over the bytes. Not a digest -- it only has to answer "is the sandbox
 * posting what the recording posted", and it has to be computable in the page
 * without SubtleCrypto's async ceremony on the request path.
 */
export function bodyHash(bytes: Uint8Array): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, 0x01000193) >>> 0;
	}

	return `${bytes.length}:${h.toString(36)}`;
}

/**
 * How a request body is identified across the two runs: the URL it was posted
 * to and which time it was posted there.
 *
 * The oracle's bodies are produced in C++ inside the network service and the
 * sandbox's in the guest's own JavaScript, so there is no object either side
 * can share -- only a string both sides can independently derive. The ordinal
 * is part of it because these endpoints are posted to repeatedly with a
 * different payload each time; keying on URL alone collapses the challenge's
 * three rounds onto one.
 */
export function reqBodyKey(url: string, ordinal: number): string {
	return `${url}#${ordinal}`;
}

/** `reqBodyKey`, made safe to use as a filename. */
export function bodyFileStem(url: string, ordinal: number): string {
	return reqBodyKey(url, ordinal)
		.replace(/[^A-Za-z0-9._-]+/g, "_")
		.slice(-120);
}

const MAGIC_V2 = "SBXD2\n";
const MAGIC_V3 = "SBXD3\n";

/** Splits Chromium's raw header block: status line, then NUL-separated fields. */
function parseRawHeaders(raw: string): {
	status: number;
	headers: [string, string][];
} {
	const parts = raw.split("\0").filter((p) => p.length > 0);
	const statusLine = parts.shift() ?? "";
	const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
	const headers: [string, string][] = [];
	for (const part of parts) {
		const i = part.indexOf(":");
		if (i < 0) continue;
		headers.push([part.slice(0, i).trim(), part.slice(i + 1).trim()]);
	}
	return { status: m ? Number(m[1]) : 200, headers };
}

function parse(buf: Buffer): StoredResponse | null {
	const v3 = buf.subarray(0, MAGIC_V3.length).toString("latin1") === MAGIC_V3;
	const v2 =
		v3 || buf.subarray(0, MAGIC_V2.length).toString("latin1") === MAGIC_V2;
	let pos = v2 ? MAGIC_V2.length : 0;
	// Newline-delimited fields, read one at a time rather than with split so a
	// body containing newlines survives.
	const field = (): string | null => {
		const end = buf.indexOf(0x0a, pos);
		if (end < 0) return null;
		const s = buf.subarray(pos, end).toString("utf8");
		pos = end + 1;
		return s;
	};
	const url = field();
	const mime = field();
	const encoding = field();
	if (url === null || mime === null || encoding === null) return null;
	let raw = "";
	let requestBody = Buffer.alloc(0);
	if (v2) {
		const lenStr = field();
		if (lenStr === null) return null;
		const len = Number(lenStr);
		if (!Number.isFinite(len)) return null;
		let bodyLen = 0;
		if (v3) {
			const bodyLenStr = field();
			if (bodyLenStr === null) return null;
			bodyLen = Number(bodyLenStr);
			if (!Number.isFinite(bodyLen)) return null;
		}
		if (pos + len + bodyLen > buf.length) return null;
		raw = buf.subarray(pos, pos + len).toString("latin1");
		pos += len;
		requestBody = buf.subarray(pos, pos + bodyLen);
		pos += bodyLen;
	}
	const { status, headers } = parseRawHeaders(raw);

	return {
		url,
		mime,
		encoding,
		status,
		headers,
		requestBody,
		body: buf.subarray(pos),
	};
}

export function headerValue(
	entry: StoredResponse,
	name: string
): string | undefined {
	const lower = name.toLowerCase();
	for (const [k, v] of entry.headers) if (k.toLowerCase() === lower) return v;

	return undefined;
}

export async function loadStore(
	dir: string
): Promise<Map<string, StoredResponse[]>> {
	const out = new Map<string, StoredResponse[]>();
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return out;
	}
	// Order comes from the `_<micros>_<seq>` suffix the recorder puts on each
	// filename; files without one predate ordinals and sort first.
	const staged: { key: [number, number]; entry: StoredResponse }[] = [];
	for (const name of names) {
		// Metadata, not a recording.
		if (name.startsWith("sbxdiff-")) continue;
		const parsed = parse(await readFile(path.join(dir, name)));
		if (!parsed) continue;
		const m = /_(\d+)_(\d+)$/.exec(name);
		staged.push({
			key: m ? [Number(m[1]), Number(m[2])] : [0, 0],
			entry: parsed,
		});
	}
	staged.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
	for (const { entry } of staged) {
		const list = out.get(entry.url);
		if (list) list.push(entry);
		else out.set(entry.url, [entry]);
	}
	return out;
}

/** The wire shape the in-page transport consumes. */
type Served = {
	mime: string;
	status: number;
	headers: [string, string][];
	/** Of the request that produced this, for the transport to check against. */
	reqHash?: string;
	body: string;
};

function serve(hit: StoredResponse): Served {
	return {
		mime: hit.mime,
		status: hit.status,
		// Redirects are stored as real entries now, so the transport has to be
		// able to see `Location` and follow the chain itself -- flattening it
		// here would put the page at a URL the recording never committed, and
		// Cloudflare's challenge reads its token out of `location`.
		headers: hit.headers,
		reqHash: hit.requestBody.length ? bodyHash(hit.requestBody) : undefined,
		body: hit.body.toString("base64"),
	};
}

/**
 * The one stored URL that differs from `url` in exactly one path segment.
 *
 * Client-minted random ids in URLs cannot replay across two different JS
 * environments, and that is not a bug in either of them. Cloudflare's Turnstile
 * builds `…/turnstile/f/av0/rch/<widget-id>/…` from a random value: the oracle
 * reproduces the recording's `q7dlh` because it runs the same code against the
 * same pinned PRNG, and the sandbox lands on `t0rxw` because scramjet's own
 * shim draws from that stream 2705 times before the guest does (measured
 * against the oracle's 6). Both sides are individually reproducible; they just
 * cannot agree on the value.
 *
 * So: one differing segment, one candidate, or nothing. Same origin, same
 * number of segments, same query. Ambiguity is a miss, because serving the
 * wrong body is worse than serving none -- and every near match is logged and
 * reported separately from a hit, since it IS a divergence, just not one the
 * store can resolve.
 */
function nearMatch(
	store: Map<string, StoredResponse[]>,
	url: string
): [string, StoredResponse[]] | undefined {
	let want: URL;
	try {
		want = new URL(url);
	} catch {
		return undefined;
	}
	const wantSegs = want.pathname.split("/");
	let found: [string, StoredResponse[]] | undefined;
	for (const [candidate, hits] of store) {
		let have: URL;
		try {
			have = new URL(candidate);
		} catch {
			continue;
		}
		if (have.origin !== want.origin || have.search !== want.search) continue;
		const haveSegs = have.pathname.split("/");
		if (haveSegs.length !== wantSegs.length) continue;
		let differing = 0;
		for (let i = 0; i < haveSegs.length; i++) {
			if (haveSegs[i] !== wantSegs[i]) differing++;
		}
		if (differing !== 1) continue;
		// A second candidate means we cannot tell which one was meant.
		if (found) return undefined;
		found = [candidate, hits];
	}

	return found;
}

/**
 * Mounts `GET /__sbxdiff/fetch?url=…`.
 *
 * A miss is a 404 and is counted, never a live fetch: falling through to the
 * network would make a real divergence look like a clean run (RULES.md #14).
 */
export function mountStoreEndpoint(
	app: express.Express,
	store: Map<string, StoredResponse[]>,
	misses: string[],
	nears: string[] = [],
	pastEnds: string[] = [],
	bodyMismatches: string[] = [],
	reqBodies: Map<string, string> = new Map(),
	/**
	 * `reqBodyKey(url, ordinal)` -> the hash the ORACLE posted there, filled in
	 * after the oracle run and before the sandbox starts. Handed to the
	 * transport so it can grade a request the way the real server would.
	 */
	oracleBodies: Map<string, string> = new Map(),
	/**
	 * Refuse a recorded response when the body posted to it does not match the
	 * oracle's.
	 *
	 * Without this a store is a server that cannot grade: Cloudflare's recorded
	 * "you passed" comes back whatever was posted, so a sandbox whose payload
	 * the real server would REJECT sails through replay and looks like it
	 * passed. That is why the live loop -- post, rejected, retry -- has never
	 * reproduced here, and why a diff scoped to the document the run ended on
	 * was describing a journey the sandbox does not actually complete.
	 *
	 * Graded against the ORACLE's body, not the recording's. The recording came
	 * from a different run with a different clock and different entropy, and
	 * unmodified Chromium does not reproduce it either (RULES.md #61) -- so
	 * grading against it would fail both sides and measure nothing.
	 */
	/**
	 * Read at request time, not at mount time: the store is mounted before the
	 * flags are parsed and long before the oracle has produced the hashes to
	 * grade against.
	 */
	strictBodies: () => boolean = () => false,
	/** Requests the transport refused; see `/__sbxdiff/reject`. */
	rejections: string[] = []
) {
	// Reported by the in-page transport, which serves preloaded hits without
	// ever reaching this server and so is the only thing that can see them.
	//
	// Past-the-end is the store's most dangerous leniency: a page that asks for
	// a URL more times than the recording did keeps getting the LAST recorded
	// response. For rateyourmusic that is the real page, so a sandbox stuck in
	// a challenge loop would eventually be HANDED the destination and look like
	// it had passed. Counting it is what tells those two apart.
	// Reported by the transport when what it posted is not what the recording
	// posted. A store cannot grade a request, so an anti-bot endpoint's recorded
	// "you passed" comes back whatever was sent to it; this is what tells "the
	// sandbox produced the same answer" apart from "it was told what it wanted
	// to hear".
	// Reported for EVERY request that carries a body, not only for one that
	// disagrees with the recording.
	//
	// The recording is the wrong thing to hold either side to. Measured on
	// rateyourmusic, unmodified Chromium replaying this store sends 2263 bytes
	// where the recording sent 2274, and disagrees with it on all five of the
	// endpoints the sandbox does -- Cloudflare's payload is built from the clock
	// and from entropy drawn during the run, so the bytes are not reproducible
	// across runs by ANYONE. Scoring the sandbox against them scores it against
	// noise. What means something is oracle against sandbox, and that comparison
	// needs a hash from every request on both sides, not just the failing ones.
	app.options("/__sbxdiff/reqbody", (_req, res) => {
		res.set("Access-Control-Allow-Origin", "*");
		res.set("Access-Control-Allow-Headers", "content-type");
		res.status(204).end();
	});
	app.post(
		"/__sbxdiff/reqbody",
		express.json({ limit: "64mb" }),
		(req, res) => {
			res.set("Access-Control-Allow-Origin", "*");
			const { url, ordinal, sent, sentHash, recordedHash } = req.body as {
				url: string;
				ordinal: number;
				sent: string;
				sentHash: string;
				recordedHash: string | null;
			};
			reqBodies.set(reqBodyKey(url, ordinal), sentHash);
			if (recordedHash && sentHash !== recordedHash) {
				bodyMismatches.push(
					`${sentHash} sent vs ${recordedHash} recorded  ${url}`
				);
			}
			// The bytes to disk, keyed the same way both sides key their hashes, so
			// a divergence can be BYTE-DIFFED rather than just counted.
			try {
				const dir = path.join(HERE_TRACES, "bodydiff");
				mkdirSync(dir, { recursive: true });
				const stem = path.join(dir, bodyFileStem(url, ordinal));
				writeFileSync(`${stem}.sandbox`, Buffer.from(sent ?? "", "base64"));
				const hits = store.get(url);
				const hit = hits?.[ordinal];
				if (hit?.requestBody?.length) {
					writeFileSync(`${stem}.recorded`, hit.requestBody);
				}
				writeFileSync(`${stem}.url`, `${url}\n#${ordinal}\n`);
			} catch {
				// diagnostics only; never fail the run over them
			}
			res.status(204).end();
		}
	);

	// Reported by the transport when it refused a recorded response because the
	// body posted to it did not match the oracle's. This is the replay standing
	// in for the live server's rejection, and it is the only thing that makes a
	// challenge LOOP reproduce here instead of silently succeeding.
	app.options("/__sbxdiff/reject", (_req, res) => {
		res.set("Access-Control-Allow-Origin", "*");
		res.set("Access-Control-Allow-Headers", "content-type");
		res.status(204).end();
	});
	app.post("/__sbxdiff/reject", express.json({ limit: "1mb" }), (req, res) => {
		res.set("Access-Control-Allow-Origin", "*");
		const { url, ordinal, sent, oracle } = req.body as {
			url: string;
			ordinal: number;
			sent: string;
			oracle: string;
		};
		rejections.push(`#${ordinal} sent ${sent} vs oracle ${oracle}  ${url}`);
		res.status(204).end();
	});

	app.get("/__sbxdiff/pastend", (req, res) => {
		res.set("Access-Control-Allow-Origin", "*");
		pastEnds.push(
			`#${req.query.ordinal ?? "?"} of ${req.query.have ?? "?"} ${req.query.url ?? ""}`
		);
		res.status(204).end();
	});
	app.get("/__sbxdiff/fetch", (req, res) => {
		// The harness page and the store live on different ports, so the
		// transport's fetch is cross-origin.
		res.set("Access-Control-Allow-Origin", "*");

		// ?all=1 hands over the whole store in one response, so the transport
		// can answer the page under test without any real I/O. See the comment
		// on SbxdiffTransport.init.
		if (req.query.all) {
			// url -> ordered list; the transport keeps its own per-URL counter,
			// so the page under test sees the recorded sequence.
			const all: Record<string, Served[]> = {};
			for (const [url, hits] of store) {
				all[url] = hits.map((hit, ordinal) => ({
					...serve(hit),
					// What the oracle posted here, so the transport can refuse a
					// recorded response the real server would have refused.
					oracleHash: oracleBodies.get(reqBodyKey(url, ordinal)) ?? null,
				}));
			}
			res.json({ hits: all, strictBodies: strictBodies() });

			return;
		}

		const url = String(req.query.url ?? "");
		const method = String(req.query.method ?? "GET").toUpperCase();
		// Answered for ANY method, exactly like the Chromium-side replay, which
		// keys on URL alone too. Refusing non-GET here made the sandbox
		// stricter than the oracle: Cloudflare POSTs to its `fo/` endpoint, the
		// recording holds that response, the oracle replays it and the sandbox
		// reported a miss -- a divergence manufactured by the harness. The
		// ordinal is what separates repeated requests to one URL; the method is
		// not part of the key on either side.
		const ordinal = Number(req.query.ordinal ?? 0) || 0;
		let hits = store.get(url);
		if (!hits) {
			const near = nearMatch(store, url);
			if (near) {
				nears.push(`${method} ${url}\n        served: ${near[0]}`);
				hits = near[1];
			}
		}
		// Past the end reuses the last: a resource fetched more often than it
		// was recorded is normal, and the oracle saw no more than it recorded.
		const hit = hits?.[Math.min(ordinal, hits.length - 1)];
		if (!hit) {
			misses.push(`${method} ${url}`);
			res.status(404).json({ error: "no recorded response", url, method });

			return;
		}
		res.json(serve(hit));
	});
}
