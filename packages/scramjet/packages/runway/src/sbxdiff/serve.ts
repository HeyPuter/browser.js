/**
 * Manual replay: starts the servers, prints the URLs, and optionally launches
 * the patched Chromium on one of them.
 *
 *     pnpm serve --store <dir> --url https://rateyourmusic.com/ --open sandbox
 *     pnpm serve --page probe.html
 *
 * The point is to drive a recorded store by hand -- click the Turnstile widget
 * yourself, scroll the real page, open devtools -- rather than through the
 * differ. Nothing is traced and nothing is compared; this is for looking.
 *
 * Two sides, same store:
 *
 *   sandbox  the target through scramjet, its transport reading the store over
 *            `/__sbxdiff/fetch`. This is the proxied page a user would see.
 *   oracle   the target directly, with Chromium itself replaying the store
 *            (`--sbxdiff-net-replay`). This is the page as it was recorded.
 *
 * Neither passes `--sbxdiff-run`, so the browser stays open until you close it.
 */
import express from "express";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHarness, PORT } from "../harness/scramjet/index.ts";
import { startBareHarness, BARE_PORT } from "../harness/bare/index.ts";
import { loadStore, mountStoreEndpoint } from "./store.ts";
import { CHROME } from "./run.ts";

const HERE = import.meta.dirname;
const SITE_PORT = 4510;
const TIME_BASE_FILE = "sbxdiff-time-base.json";
const DEFAULT_TIME_BASE = 1700000000000;
// Same key the driver uses. It seeds the deterministic PRNG, and a store whose
// recording depended on a drawn value -- Turnstile's widget id is in a URL --
// only replays under the key it was recorded with.
const RUN_KEY = "sbxdiff-scramjet";

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);

	return i >= 0 ? args[i + 1] : undefined;
};

const storeDir = path.resolve(
	flag("--store") ??
		process.env.SBXDIFF_STORE ??
		path.join(HERE, ".traces", "store")
);
const page = flag("--page") ?? "probe.html";
const target = flag("--url") ?? `http://localhost:${SITE_PORT}/${page}`;
const open = flag("--open");
// --wisp is the live path: scramjet's own egress, epoxy over a WebSocket to the
// wisp server, with TLS done inside the page. That is the transport production
// uses, and the only one whose handshake is ours to shape -- see
// sbxdiff-epoxy-transport.js. ?sbxdiffLibcurl swaps epoxy for libcurl on the
// same path.
//
// It needs nothing relaxed in the browser: the request never touches Chromium's
// network stack, so there are no forbidden headers to carry and no CORS to
// disable. Two other live transports were tried -- one fetching from Node, one
// through Blink -- and both are gone; see the harness page for why.
const wisp = args.includes("--wisp");
// Same shape as the driver's, so a manual session can reproduce the automated
// one without a human hand on the mouse.
// --trace <dir> turns the tracer on for a manual session, so a live run can be
// compared against a replayed one with the same tooling the differ uses.
const trace = flag("--trace");
const click = flag("--click");
const clickFrame = flag("--click-frame");
// --shots [<interval_ms>]: a viewport strip into `.traces/serve-<side>-shots/`.
// Needs the in-binary runner, so it comes free with --click or --quit-after and
// does nothing without one. Browser-side capture: no CDP, nothing the page can
// see. This is how a LIVE run says whether the sandbox is working or waiting.
// `flag` reads the NEXT token, which for an optional-value switch may be the
// following switch or nothing at all -- so presence is `includes` and the value
// is whatever parses, defaulting to a second.
const shotsInterval = args.includes("--shots")
	? Number(flag("--shots")) || 1000
	: undefined;
/** Where a side's strip goes. The capture callback will not create it. */
const shotsDir = (side: string) =>
	path.join(HERE, ".traces", `serve-${side}-shots`);
// Quit this many ms after the page settles, with no click involved. For a probe
// page that reports and is done.
// --real-clock opts out of the store-clock pin below, for anyone who wants
// the old behaviour of replaying under the device's own now.
const realClock = args.includes("--real-clock");
const quitAfter = flag("--quit-after");

const timeBase = await readFile(path.join(storeDir, TIME_BASE_FILE), "utf8")
	.then((raw) => Number(JSON.parse(raw).initialTimeMs))
	.catch(() => undefined);

// A previous run's browser and harness outlive the command that started them --
// `serve` launches and returns -- so without this the next run finds port 4500
// or 4510 taken and dies with an EADDRINUSE stack trace, while the OLD window
// sits there looking like a result. That is not a slow run or a flaky one: it
// is a window showing the previous build. `rym.sh live` has carried this guard
// for the same reason; plain `serve` did not, and it cost a round of
// "it still says incorrect device time" against a browser that predated the fix.
{
	const { execSync } = await import("node:child_process");
	const stale = (pattern: string) => {
		try {
			return execSync(`pgrep -f ${JSON.stringify(pattern)}`, {
				stdio: ["ignore", "pipe", "ignore"],
			})
				.toString()
				.trim();
		} catch {
			return ""; // pgrep exits 1 when nothing matches
		}
	};
	const patterns = [`sbxdiff-run-key=${RUN_KEY}`, "sbxdiff/serve.ts"];
	const found = patterns.filter((p) => stale(p) !== "");
	if (found.length) {
		console.log(`  killing a previous serve run still holding the ports`);
		for (const p of patterns) {
			try {
				execSync(`pkill -f ${JSON.stringify(p)}`, { stdio: "ignore" });
			} catch {
				/* nothing matched, or already gone */
			}
		}
		// Let the listeners actually close before the next bind.
		for (let i = 0; i < 10; i++) {
			if (!patterns.some((p) => stale(p) !== "")) break;
			execSync("sleep 1");
		}
	}
}

const app = express();
// The same endpoint the driver mounts. Without it a manual run fails with a
// CORS error from a 404, which looks like a transport bug rather than a
// missing route.
const store = await loadStore(storeDir);
const misses: string[] = [];
mountStoreEndpoint(app, store, misses);
app.use(express.static(path.join(HERE, "pages")));
// What did the server actually receive? Used by pages/formpost.html to tell a
// form POST that survived the proxy from one that arrived as a GET -- which is
// the difference between redeeming a Cloudflare challenge and being handed
// another one.
// What did the server receive, in the ORDER it was sent?
//
// Header order is a fingerprint -- Cloudflare reads it -- and comparing the two
// sides' needs both to be making the same KIND of request to the same place.
// The rich public endpoints cannot do that: tls.peet.ws and browserleaks both
// refuse the oracle's fetch for want of `Access-Control-Allow-Origin`, so the
// only Chromium capture available was a top-level navigation, which differs
// from a fetch in Chrome too.
//
// Here the request is same-origin for both sides, so both can read the answer,
// and `req.rawHeaders` preserves order and case where `req.headers` lowercases
// and sorts into an object.
app.all("/__sbxdiff/headers", (req, res) => {
	const order: string[] = [];
	for (let i = 0; i < req.rawHeaders.length; i += 2)
		order.push(req.rawHeaders[i]);
	// Also to stdout under SBXDIFF_LOG_REQ_HEADERS. The response body answers
	// the question for a page that fetches this and reports; a top-level
	// NAVIGATION here renders as raw JSON and reports to nobody, and a
	// navigation is the request whose header set differs -- `accept-encoding`,
	// `priority` and `sec-fetch-user` only ride on one.
	if (process.env.SBXDIFF_LOG_REQ_HEADERS) {
		const pairs: string[] = [];
		for (let i = 0; i < req.rawHeaders.length; i += 2)
			pairs.push(`${req.rawHeaders[i]}=${req.rawHeaders[i + 1]}`);
		console.log(`  HEADERS ${req.method} ${pairs.join(" | ")}`);
	}
	res.json({ method: req.method, order });
});

// A response in each of the four encodings scramjet now advertises.
//
// Claiming an encoding a transport cannot decode is worse than not claiming
// it: the server takes the offer and every byte of the response arrives as
// noise. `accept-encoding` is set in one place (`fetch/headers.ts`) and
// honoured somewhere else entirely (epoxy's decompression layer, compiled from
// Rust to wasm), so the claim and the decoder can drift apart without anything
// failing loudly. This is what catches that.
//
// `?enc=zstd` is the one that matters -- it is the encoding that was added --
// but all four are here so a pass on zstd can be read against a control.
app.get("/__sbxdiff/encoding", (req, res) => {
	const enc = String(req.query.enc ?? "identity");
	// Long enough that a decoder which silently passes the bytes through cannot
	// coincidentally produce it, and self-describing so the page says which.
	const body = Buffer.from(
		`<!doctype html><title>${enc}</title><pre>DECODED ${enc} ` +
			"payload ".repeat(200) +
			"</pre>"
	);
	const encoded =
		enc === "gzip"
			? zlib.gzipSync(body)
			: enc === "deflate"
				? zlib.deflateSync(body)
				: enc === "br"
					? zlib.brotliCompressSync(body)
					: enc === "zstd"
						? zlib.zstdCompressSync(body)
						: body;
	res.setHeader("content-type", "text/html");
	if (enc !== "identity") res.setHeader("content-encoding", enc);
	res.setHeader("content-length", String(encoded.length));
	console.log(
		`  ENCODING ${enc}: sent ${encoded.length}b for ${body.length}b plaintext`
	);
	res.end(encoded);
});

app.all("/__sbxdiff/echo", (req, res) => {
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", () => {
		const what = `${req.method} ct=${req.headers["content-type"] ?? "none"} bytes=${body.length}`;
		console.log(`  ECHO ${what}`);
		res
			.type("html")
			.send(
				`<!doctype html><title>${what}</title><script>location.replace("/formpost.html?echoed")</script>`
			);
	});
});
// SBXDIFF_STORE_OUT records the LIVE run into a store, from the transport
// rather than from Chromium.
//
// `--sbxdiff-net-record` cannot do this: it records what the browser's network
// stack received, and on the wisp path the sandbox's upstream never touches it.
// So the only place the sandbox's own journey exists is the transport, and
// that runs in the page.
//
// The point is a store recorded from a FAILING run. Both sides then replay the
// same challenge instance -- the same branch, the same scripts, the same
// tokens -- so a trace comparison isolates the guest environment instead of
// comparing two different challenge programs, which is what an oracle and a
// sandbox are otherwise handed.
const storeOut = process.env.SBXDIFF_STORE_OUT
	? path.resolve(process.env.SBXDIFF_STORE_OUT)
	: null;
if (storeOut) {
	mkdirSync(storeOut, { recursive: true });
	writeFileSync(
		path.join(storeOut, TIME_BASE_FILE),
		JSON.stringify({ initialTimeMs: Date.now() })
	);
	let seq = 0;
	console.log(`  recording the live run into ${storeOut}`);
	app.post(
		"/__sbxdiff/record",
		express.raw({ limit: "256mb", type: () => true }),
		(req, res) => {
			res.set("Access-Control-Allow-Origin", "*");
			try {
				// The page sends one framed blob so the body bytes stay bytes: a
				// JSON envelope would have to base64 them, and these run to
				// megabytes.
				const buf = req.body as Buffer;
				const split = buf.indexOf(0x0a);
				const meta = JSON.parse(buf.subarray(0, split).toString("utf8")) as {
					url: string;
					mime: string;
					encoding: string;
					status: number;
					statusText: string;
					headers: [string, string][];
					reqBodyLen: number;
				};
				const rest = buf.subarray(split + 1);
				const reqBody = rest.subarray(0, meta.reqBodyLen);
				const body = rest.subarray(meta.reqBodyLen);
				// Chromium's `raw_headers()`: a NUL-separated status line and field
				// list. store.ts parses exactly this, so it is written exactly this
				// way rather than approximated.
				const raw =
					[
						`HTTP/1.1 ${meta.status} ${meta.statusText}`,
						...meta.headers.map(([k, v]) => `${k}: ${v}`),
					].join("\0") + "\0";
				const rawBuf = Buffer.from(raw, "latin1");
				const head = Buffer.from(
					`SBXD3\n${meta.url}\n${meta.mime}\n${meta.encoding}\n` +
						`${rawBuf.length}\n${reqBody.length}\n`,
					"utf8"
				);
				// The reader indexes by the URL inside each file, so the name only
				// has to end in `_<micros>_<seq>` for ordering.
				const name = `live_${Date.now()}_${(seq++).toString().padStart(6, "0")}`;
				writeFileSync(
					path.join(storeOut, name),
					Buffer.concat([head, rawBuf, reqBody, body])
				);
				res.status(204).end();
			} catch (err) {
				console.error(`  record failed: ${err}`);
				res.status(500).end();
			}
		}
	);
	app.options("/__sbxdiff/record", (_q, r) => {
		r.set("Access-Control-Allow-Origin", "*");
		r.set("Access-Control-Allow-Headers", "*");
		r.status(204).end();
	});
}
app.get("/asset.png", (_q, r) =>
	r
		.type("png")
		.send(
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
				"base64"
			)
		)
);
await new Promise<void>((r) => app.listen(SITE_PORT, r));
await startHarness();
await startBareHarness();

const encoded = Buffer.from(target).toString("base64");
// ?sbxdiffStore is what swaps the wisp transport for the store-backed one; the
// hash is base64 so the target does not appear literally in the harness URL.
// SBXDIFF_LOG_REQ_HEADERS on the wisp path turns on the live logger's header
// dump -- what did this side actually send. On the wisp transports the headers
// it logs ARE the wire bytes: nothing between that seam and the socket adds,
// drops, renames or reorders one.
//
// SBXDIFF_LIVE_TRANSPORT=libcurl swaps epoxy for libcurl on that same path.
// Both do TLS in the page, so the comparison is between two handshakes and
// nothing else.
const liveParams = new URLSearchParams();
if (process.env.SBXDIFF_LOG_REQ_HEADERS) liveParams.set("sbxdiffHdr", "1");
if (process.env.SBXDIFF_LIVE_TRANSPORT === "libcurl") {
	liveParams.set("sbxdiffLibcurl", "1");
}
// SBXDIFF_LOG_FORMS turns on the harness's form probe -- see index.html.
if (process.env.SBXDIFF_LOG_FORMS) liveParams.set("sbxdiffForms", "1");
// SBXDIFF_PROBE=<path> runs that script at the top of every guest document,
// ahead of the page's own. The harness's own form probe polls from outside and
// cannot win that race: Cloudflare caches `createElement` and `submit` at parse
// time.
if (process.env.SBXDIFF_PROBE) {
	liveParams.set("sbxdiffProbe", process.env.SBXDIFF_PROBE);
}
if (storeOut) liveParams.set("sbxdiffRecord", String(SITE_PORT));
// Every branch gets them, which took embarrassingly long to be true.
//
// `liveQuery` was spliced into the WISP url only, so on the store-replay path
// -- the one `--store` uses, and the common one -- `SBXDIFF_PROBE`,
// `SBXDIFF_LOG_FORMS`, `SBXDIFF_LOG_REQ_HEADERS` and `SBXDIFF_LIVE_TRANSPORT`
// were accepted, printed nothing, and did nothing. A switch that silently
// no-ops is worse than one that is missing: two runs were read as evidence
// about a change that had never been turned on.
const sandboxParams = new URLSearchParams(liveParams);
if (!wisp) sandboxParams.set("sbxdiffStore", String(SITE_PORT));
const sandboxQuery = sandboxParams.size ? `?${sandboxParams}` : "";
const sandboxUrl = `http://localhost:${PORT}/${sandboxQuery}#b64:${encoded}`;
const bareUrl = `http://localhost:${BARE_PORT}/#b64:${encoded}`;

/**
 * Extra Chromium flags from SBXDIFF_CHROME_EXTRA.
 *
 * A JSON array when it starts with `[`, whitespace-separated otherwise. The
 * JSON form exists because a flag's VALUE can contain spaces and the
 * whitespace form cannot carry one: `--user-agent=Mozilla/5.0 (X11; Linux ...)`
 * splits into six arguments. Substituting underscores for the spaces does not
 * help -- measured, Chromium sent the underscores, Cloudflare was handed a
 * user-agent no browser has ever sent, and the run was answered with neither
 * challenge branch.
 */
function chromeExtra(): string[] {
	const raw = process.env.SBXDIFF_CHROME_EXTRA;
	if (!raw) return [];
	if (raw.trimStart().startsWith("[")) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			console.error(
				"  SBXDIFF_CHROME_EXTRA looks like JSON but does not parse"
			);
		}
	}

	return raw.split(/\s+/).filter(Boolean);
}

/** Everything a manual run needs, minus --sbxdiff-run so it stays open. */
function chromeArgs(userDataDir: string, side: "sandbox" | "oracle") {
	return [
		"--no-sandbox",
		`--user-data-dir=${userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--use-mock-keychain",
		"--enable-unsafe-swiftshader",
		"--window-size=1280,900",
		"--num-raster-threads=1",
		"--force-color-profile=srgb",
		"--lang=en-US",
		"--disable-features=site-per-process,IsolateOrigins,IsolateSandboxedIframes,BackgroundResourceFetch",
		// The recorded journey is the DARK widget, and the store is keyed by
		// URL: Turnstile asks for `.../dark/fbE/new/normal` or `.../light/...`
		// depending on `prefers-color-scheme`, so a browser that answers the
		// media query differently from the recording MISSES the widget document
		// and the whole journey collapses -- the oracle ends on
		// `chrome-error://chromewebdata/` and the gate reads 304 unbaselined
		// buckets where it read 4.
		//
		// Blink's `preferredColorScheme` initialises to kLight and is normally
		// overridden from the OS; this binary does not do that override here,
		// GPU and display initialisation both having failed. Pinning it makes
		// the harness independent of the host's appearance setting, which a
		// differential tool wants anyway: the store outlives whatever the
		// desktop was doing the night it was recorded.
		//
		// kDark is 0 (`preferred_color_scheme.mojom` declares kDark first).
		"--blink-settings=preferredColorScheme=0",
		// Same CHECK the replay runner guards against, and the live path needs
		// it just as much: without an explicit scale factor the BROWSER process
		// dies in `image_skia_rep_default.cc:36` painting a toolbar icon, about
		// ten seconds in. Here that reads as the harness printing "launching
		// sandbox..." and then nothing ever reaching the site.
		"--force-device-scale-factor=1",
		"--js-flags=--random-seed=1337 --hash-seed=1337 --no-turbo-fast-api-calls",
		// Whitespace-separated Chromium flags, appended verbatim. Exists to
		// answer questions about the BROWSER rather than about the proxy, by
		// changing one thing about it and seeing whether a site notices.
		//
		// To degrade the handshake, use `--ssl-version-max=tls1.2`. Measured
		// with pages/tlsfp.html: it really does what it says -- TLSv1.2, and
		// 0x1301/2/3 gone from the offered ciphers.
		//
		// NOT `--cipher-suite-blacklist=0x1301,0x1302,0x1303`. That switch is
		// accepted, reaches the browser, and does nothing: it feeds
		// `SSLContextConfig::disabled_cipher_suites`, which BoringSSL does not
		// apply to the TLS 1.3 suites. Measured four ways -- headless and
		// headed, on and off -- the offered cipher list is byte-identical every
		// time.
		//
		// It reads as though it works, because the JA3 hash changes when you
		// set it. That is Chrome permuting its extension order per connection:
		// two runs with the flag OFF give two different hashes as well. Compare
		// the cipher list, not the hash.
		//
		// What the working knob then says: at TLS 1.2 only, the oracle still
		// passes rateyourmusic's challenge, still redeems it, and still takes
		// the `jsd` branch rather than the `brunhild` one the proxy gets. So
		// Cloudflare is not branching on the handshake here.
		...chromeExtra(),
		`--sbxdiff-run-key=${RUN_KEY}`,
		...(trace ? [`--sbxdiff-trace-out=${path.resolve(trace)}`] : []),
		// NO --sbxdiff-initial-time. That switch is what ENABLES virtual time
		// (page.cc), and on its own it takes the default policy and the default
		// 2000 ms budget -- so two seconds of virtual time in, the clock stops
		// and every timer freezes. Manually that looks like a blank iframe: the
		// harness navigates, the guest frame never loads, and nothing is logged
		// because nothing throws. The driver only passes it inside its
		// virtual-time branch, which is why the automated run is unaffected.
		//
		// A manual session wants a real clock anyway: virtual time either races
		// ahead while you are looking at the page (kAdvance) or freezes when the
		// budget runs out (kDeterministicLoading).
		// The oracle reads the store in the browser process; the sandbox reads
		// it in the page, through the transport, so it must NOT also have the
		// interceptor -- that would block the harness's own assets.
		// --sbxdiff-click needs the in-binary runner, and the runner only
		// attaches when --sbxdiff-run is set -- which also means the browser
		// quits after that grace. Ten minutes by default, so a "manual" session
		// with an automated click is still long enough to watch.
		// --quit-after gets the same runner without a click, for a page that
		// finishes on its own. Without it such a run never ends: nothing in a
		// manual session asks the browser to stop, and killing it from outside
		// races the page -- a probe that reports in its last 200 ms reports
		// nothing at all if the kill lands first.
		...(click
			? [
					`--sbxdiff-click=${click}`,
					`--sbxdiff-run=${flag("--grace") ?? 600000}`,
					...(clickFrame ? [`--sbxdiff-click-frame=${clickFrame}`] : []),
				]
			: quitAfter
				? [`--sbxdiff-run=${quitAfter}`]
				: []),
		// Replay under the clock the store was RECORDED at.
		//
		// A challenge mints tokens and checks them against the device clock, so
		// a store replayed days later makes the page reject itself -- measured,
		// rateyourmusic's interstitial says "incorrect device time" and never
		// reaches the widget. This page used to print a warning about that and
		// offer no way out: "Re-record the store if the page rejects itself."
		//
		// `--sbxdiff-time-offset` is not virtual time and does not enable it.
		// It installs `TimeNowIgnoringOverride() + delta`, so the clock still
		// RUNS in real time and is merely shifted to when the recording was
		// made -- which is what a manual replay wants, and is why the objection
		// in the note below (virtual time races ahead or freezes) does not
		// apply to it. `run.ts` has passed it on the un-virtualised side all
		// along; only this file was missing it.
		//
		// Never on a LIVE path: `--wisp` talks to the real
		// Cloudflare, which expects the real now, and shifting the clock three
		// days back would break the thing the live run exists to test.
		...(timeBase !== undefined && !wisp && !realClock
			? [`--sbxdiff-time-offset=${timeBase}`]
			: []),
		...(shotsInterval
			? [`--sbxdiff-shots=${shotsDir(side)},${shotsInterval}`]
			: []),
		...(side === "oracle" && !wisp
			? [`--sbxdiff-net-replay=${storeDir}`]
			: []),
		side === "oracle" ? target : sandboxUrl,
	];
}

const total = [...store.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n  store  : ${total} response(s) across ${store.size} URL(s)`);
console.log(`           ${storeDir}`);
// A manual run is on the REAL clock (see chromeArgs), so a store recorded long
// ago replays under a device time its own tokens disagree with. Cloudflare says
// so out loud; most things just fail quietly.
const skewMs =
	timeBase === undefined ? undefined : Math.abs(Date.now() - timeBase);
if (process.env.SBXDIFF_PROBE) {
	console.log(`  probe  : ${process.env.SBXDIFF_PROBE}`);
}
console.log(
	`  clock  : ${timeBase !== undefined && !wisp && !realClock ? "pinned to the store" : "real"}${
		timeBase === undefined
			? ` -- no ${TIME_BASE_FILE} in the store`
			: `, store recorded ${Math.round((skewMs ?? 0) / 60000)} min ago`
	}`
);
if (skewMs === undefined || skewMs > 60 * 60 * 1000) {
	console.log(
		`           WARNING: a challenge checks its tokens against the device clock.\n` +
			`           Re-record the store if the page rejects itself.`
	);
}
console.log(`  target : ${target}`);
console.log(
	`  mode   : ${
		wisp
			? "WISP -- scramjet's own transport, live, the store is ignored"
			: "replay"
	}\n`
);
console.log(`  sandbox: ${sandboxUrl}`);
console.log(`  bare   : ${bareUrl}\n`);

for (const side of ["sandbox", "oracle"] as const) {
	const quoted = chromeArgs("/tmp/sbxdiff-manual-" + side, side)
		.map((a) => (/[ "&]/.test(a) ? `'${a}'` : a))
		.join(" \\\n    ");
	console.log(`  ${side}, by hand:\n    ${CHROME} \\\n    ${quoted}\n`);
}

if (open === "sandbox" || open === "oracle") {
	const dir = await mkdtemp(path.join(tmpdir(), "sbxdiff-manual-"));
	// Chromium's stderr goes to a file, not the terminal: a manual session is
	// exactly when something goes wrong with no trace to read afterwards, and
	// console messages from the page are in here. SBXDIFF_VERBOSE adds
	// Chromium's own logging on top.
	const logPath = path.join(HERE, ".traces", `serve-${open}.log`);
	const log = createWriteStream(logPath);
	await new Promise((r) => log.once("open", r));
	console.log(`  launching ${open}...`);
	console.log(`  log: ${logPath}\n`);
	if (shotsInterval) {
		// `base::WriteFile` in the capture callback does not create its parent
		// and says nothing when it fails, so a missing directory reads exactly
		// like a page that never painted.
		rmSync(shotsDir(open), { recursive: true, force: true });
		mkdirSync(shotsDir(open), { recursive: true });
		console.log(`  shots: ${shotsDir(open)} every ${shotsInterval}ms\n`);
	}
	const extra = process.env.SBXDIFF_VERBOSE
		? ["--enable-logging=stderr", "--v=1"]
		: ["--enable-logging=stderr"];
	const argv = chromeArgs(dir, open);
	const child = spawn(CHROME, [...extra, ...argv], {
		stdio: ["ignore", "ignore", log],
		env: { ...process.env, TZ: "America/Los_Angeles" },
	});
	// A fresh profile per run, removed when the run ends. Chromium writes its
	// caches, its code cache and its GPU blobs in here, which is half a gigabyte
	// after a session that loads a real site -- and this used to be left behind
	// every time. Twenty-seven of them had accumulated to 13 GB, which is a full
	// disk rather than a slow one: the Chromium build alone is 10 GB and there
	// is nowhere for it to go.
	//
	// Removed on the way out of the process, not on the child's exit alone, so
	// that a run killed from outside -- which is how most of them end -- cleans
	// up too.
	const cleanup = () => {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* a profile we cannot remove is not worth failing a run over */
		}
	};
	process.on("exit", cleanup);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => {
			child.kill();
			cleanup();
			process.exit(0);
		});
	}

	child.on("exit", () => {
		if (misses.length) {
			console.log(`\n  ${misses.length} store miss(es):`);
			for (const m of [...new Set(misses)].slice(0, 20))
				console.log(`      ${m}`);
		}
		cleanup();
		process.exit(0);
	});
}

await new Promise(() => {});
