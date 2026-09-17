/**
 * Launches the patched Chromium and collects the traces a run produces.
 *
 * Deliberately no Playwright and no CDP. A DevTools session is itself
 * page-observable (`navigator.webdriver`, `Runtime.enable` eagerly serializing
 * console arguments through page getters) and it injects a `chrome://headless/`
 * realm into every trace. The patched binary drives itself with
 * `--sbxdiff-run`, and the harness pages take their target from `location.hash`.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decode, type Trace } from "./trace.ts";

export const CHROME =
	process.env.SBXDIFF_CHROME ??
	path.resolve(
		import.meta.dirname,
		"../../../../../../../src/out/sbx/Chromium.app/Contents/MacOS/Chromium"
	);

export type RunOptions = {
	url: string;
	traceDir: string;
	runKey: string;
	/** Real-time grace after the page stops loading, ms. */
	graceMs?: number;
	initialTimeMs?: number;
	virtualTimeBudgetMs?: number;
	netRecord?: string;
	netReplay?: string;
	/** "deterministic" (default), "advance", or "pause". */
	virtualTimePolicy?: "deterministic" | "advance" | "pause";
	/** Defer enabling virtual time until a realm whose URL contains this. */
	virtualTimeAfter?: string;
	/** Restore Chromium's default of fencing task queues while paused. */
	virtualTimeFence?: boolean;
	/** Serve an empty 200 for a replay miss instead of blocking. */
	softMiss?: boolean;
	headed?: boolean;
	/** Persistent user-data-dir; keeps cookies (and challenge clearance). */
	profileDir?: string;
	timeoutMs?: number;
	/** Trusted click, for challenge widgets: "x,y[,delay[,repeat[,interval]]]". */
	click?: string;
	/** Send the click to the frame whose URL contains this substring. */
	clickFrame?: string;
	/**
	 * Capture the viewport every `shotsIntervalMs` into this directory.
	 *
	 * The switch has existed in the binary since patch 0011 and nothing passed
	 * it. It answers the one question a per-side elapsed time cannot: a sandbox
	 * that takes 92 seconds longer than the oracle is either doing work or
	 * waiting for something that never comes, and those have opposite fixes.
	 *
	 * Browser-side (`RenderWidgetHostView::CopyFromSurface`), so nothing about
	 * it is visible to the page -- no `Page.captureScreenshot`, no CDP realm,
	 * and no guest-observable call. Capture pixels are viewport pixels 1:1.
	 */
	shotsDir?: string;
	/** Capture interval in ms. The binary's own default is 2000. */
	shotsIntervalMs?: number;
	/**
	 * `<origin>,<prefix>`: how to tell the proxy's OWN scripts from the pages it
	 * rewrites. Both are on the same origin and only the prefix separates them.
	 *
	 * The sandbox side only. The oracle has no shim, and saying so by omission
	 * is exactly right -- with the switch absent nothing is classified as one.
	 */
	shimScripts?: string;
	/**
	 * Write every request body this side sends to this directory, one file per
	 * `bodyFileStem(url, ordinal)`. The hash in the log says two bodies differ;
	 * only the bytes say HOW, and a 1 KB delta on a Cloudflare payload is not
	 * something a hash can explain.
	 */
	bodyDumpDir?: string;
	/**
	 * Switches this run needs and no other does.
	 *
	 * For `cfrun.ts`, which points both sides at one HTTPS server standing in
	 * for the challenge's real hostnames: `--host-resolver-rules`,
	 * `--ignore-certificate-errors`, and `--disable-web-security` on the
	 * proxied side only. Appended last so a caller can override a default.
	 */
	extraArgs?: string[];
};

/**
 * The flags every run shares.
 *
 * `--disable-site-isolation-trials` is absent, and this is the second time it
 * has been decided. The note it replaces said the `--disable-features` set
 * below "is what makes a cross-origin iframe share the page's renderer"; that
 * was never true -- `site-per-process` names no feature that exists, and an
 * unknown name in `--disable-features` is dropped in silence, so the oracle ran
 * four renderers to the sandbox's one (RULES.md #103).
 *
 * Turning it on was then measured, and it is worse: the oracle still kept a
 * separate renderer for the widget, its main renderer's logical clock went from
 * 5000 ms to 120100, and the report went from 14 unbaselined buckets to 19.
 * Collapsing the process tree is the wrong lever anyway -- what the two sides
 * have to share is the CLOCK, not the topology, and
 * `SBXDIFF_LOGICAL_CLOCK_FILE` shares that directly.
 */
/**
 * The port WebRTC may bind, so an ICE candidate reads the same twice.
 *
 * ONE port, not a range. A range only moves the problem: the two sides bound
 * 47105 and 47103 out of 47100-47119, because the offset within a range
 * depends on how many sockets were opened before and the two sides do not open
 * the same ones. The candidate string is guest-readable and goes into
 * Cloudflare's payload, so "some port in a known range" is still a divergence.
 */
const WEBRTC_UDP_PORT_RANGE = "47100-47100";

export function baseArgs(o: RunOptions, userDataDir: string): string[] {
	const args = [
		...(o.headed ? [] : ["--headless=new"]),
		"--no-sandbox",
		`--user-data-dir=${userDataDir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--use-mock-keychain",
		"--enable-unsafe-swiftshader",
		// No infobar. Chromium warns about `--no-sandbox` with one, and it slides
		// in about a second after startup -- shrinking the content area by 56px
		// UNDER the running page. The oracle's guest reads `innerHeight` before
		// that lands and the sandbox's cannot: service worker registration and
		// scramjet boot sit in front of the guest's first line. Measured on
		// `pointer.html`, the oracle said 813 and then 757, the sandbox said 757
		// twice, and the sandbox got blamed for a viewport the browser moved.
		"--test-type",
		"--window-size=1280,900",
		"--num-raster-threads=1",
		"--force-color-profile=srgb",
		"--lang=en-US",
		// KeepAliveInBrowserMigration is off so that `sendBeacon` reaches the
		// replay interceptor.
		//
		// It is enabled by default, and it moves keepalive requests to a loader
		// in the BROWSER -- past `WillCreateURLLoaderFactory`, which is where
		// sbxdiff_net_replay installs itself. So a beacon escaped the store
		// entirely: the oracle's trace shows `Navigator.sendBeacon` called with
		// a Google Analytics collect URL, its stderr shows no `replay MISS` for
		// it, and the store holds no such entry -- a lookup would have missed,
		// so there was no lookup. Either the request was dropped at shutdown or
		// it left the process, and the second is exactly what RULES.md #14 says
		// must never happen.
		"--disable-features=IsolateOrigins,IsolateSandboxedIframes,BackgroundResourceFetch,KeepAliveInBrowserMigration",
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
		// Without an explicit scale factor the BROWSER process CHECK-fails
		// painting a toolbar icon (image_skia_rep_default.cc:36, an empty
		// bitmap out of ScaleImageSkiaRep) about ten seconds in, which the
		// runner reports as `sandbox: no guest realm matched`. GPU init fails
		// on this machine and the icon has no representation at the scale it
		// is asked for. Independent of the colour scheme above: pinning that
		// alone does not stop it.
		"--force-device-scale-factor=1",
		"--js-flags=--random-seed=1337 --hash-seed=1337 --no-turbo-fast-api-calls",
		`--sbxdiff-run-key=${o.runKey}`,
		`--sbxdiff-trace-out=${o.traceDir}`,
		`--sbxdiff-run=${o.graceMs ?? 2500}`,
	];
	if (o.shimScripts) args.push(`--sbxdiff-shim-scripts=${o.shimScripts}`);
	if (o.initialTimeMs !== undefined)
		args.push(`--sbxdiff-initial-time=${o.initialTimeMs}`);
	if (o.timeOriginMs !== undefined)
		args.push(`--sbxdiff-time-offset=${o.timeOriginMs}`);
	if (o.virtualTimeBudgetMs !== undefined)
		args.push(`--sbxdiff-virtual-time-budget=${o.virtualTimeBudgetMs}`);
	if (o.virtualTimePolicy)
		args.push(`--sbxdiff-virtual-time-policy=${o.virtualTimePolicy}`);
	if (o.virtualTimeAfter)
		args.push(`--sbxdiff-virtual-time-after=${o.virtualTimeAfter}`);
	if (o.virtualTimeFence) args.push("--sbxdiff-virtual-time-fence");
	if (o.softMiss) args.push("--sbxdiff-net-replay-soft-miss");
	if (o.click) args.push(`--sbxdiff-click=${o.click}`);
	if (o.clickFrame) args.push(`--sbxdiff-click-frame=${o.clickFrame}`);
	if (o.shotsDir) {
		args.push(`--sbxdiff-shots=${o.shotsDir},${o.shotsIntervalMs ?? 2000}`);
	}
	if (o.netRecord) args.push(`--sbxdiff-net-record=${o.netRecord}`);
	if (o.netReplay) args.push(`--sbxdiff-net-replay=${o.netReplay}`);
	// Logging to stderr is ALWAYS on, because the run reads results out of it.
	// The oracle's request-body hashes are `LOG(WARNING)` lines from the replay
	// loader and the sandbox's per-request log is `console.info`; neither
	// reaches stderr without this. It used to be behind SBXDIFF_VERBOSE, which
	// meant a run without that variable saw no oracle bodies at all and
	// reported every one of them as "(none sent)" -- an instrument that
	// manufactures the divergence it is supposed to measure.
	//
	// `--v=1` stays behind the variable. That is the VERBOSE1 firehose (every
	// URLRequest, every virtual-time pauser), which is for reading by hand.
	args.push("--enable-logging=stderr");
	if (process.env.SBXDIFF_VERBOSE) args.push("--v=1");
	args.push(o.url);
	if (o.extraArgs) args.push(...o.extraArgs);

	return args;
}

/**
 * Remove temp profiles a previous run left behind.
 *
 * The normal path already deletes its own in a `finally`. What that cannot
 * cover is the harness being KILLED -- a timeout, a Ctrl-C, a `pkill` -- and a
 * headed Chromium profile is about 100 MB. Measured after a day of runs: 86 of
 * them, 8.9 GB, which filled the disk and stopped the build with an error that
 * looks nothing like its cause ("no space left on device" from the linker).
 *
 * An age cut rather than "delete them all", because runs can overlap: a
 * concurrent run's profile is minutes old and in use.
 */
async function sweepStaleProfiles(): Promise<void> {
	const dir = tmpdir();
	const cutoff = Date.now() - 60 * 60 * 1000;
	try {
		for (const name of await readdir(dir)) {
			if (!name.startsWith("sbxdiff-")) continue;
			const p = path.join(dir, name);
			try {
				if ((await stat(p)).mtimeMs < cutoff) {
					await rm(p, { recursive: true, force: true });
				}
			} catch {
				// raced with another run, or not ours to delete
			}
		}
	} catch {
		// best effort; never fail a run over housekeeping
	}
}

/**
 * Pin the UDP port range WebRTC binds, in the profile.
 *
 * An ICE candidate is guest-readable and an anti-bot payload records it.
 * Everything in it is already deterministic -- `sbxdiff_rand_stream.h` keys the
 * mDNS hostname -- except the port, which the OS hands out and which that same
 * comment says no PRNG here can pin. Measured in Cloudflare's Turnstile realm,
 * two runs a few minutes apart:
 *
 *   candidate:1791751595 1 udp 1677729535 75.52.94.178 47004 typ srflx ...
 *   candidate:1791751595 1 udp 1677729535 75.52.94.178 47003 typ srflx ...
 *
 * Identical but for `47004` against `47003`. Same length, so it never showed
 * up as a size divergence -- it is exactly the shape of the oracle disagreeing
 * with ITSELF inside a request body.
 *
 * `webrtc.udp_port_range` is an ordinary profile preference (Chrome parses it
 * in `renderer_preferences_util.cc`), so this needs no switch and no patch: a
 * `Default/Preferences` written before launch. A RANGE rather than one port,
 * because a run can want more than one socket and a range that cannot satisfy
 * them falls back to ephemeral -- which is the thing being avoided.
 */
async function pinWebRtcPorts(userDataDir: string): Promise<void> {
	const dir = path.join(userDataDir, "Default");
	const file = path.join(dir, "Preferences");
	await mkdir(dir, { recursive: true });
	let prefs: Record<string, unknown> = {};
	try {
		prefs = JSON.parse(await readFile(file, "utf8"));
	} catch {
		// A fresh profile, which is the usual case.
	}
	const webrtc = (prefs.webrtc ?? {}) as Record<string, unknown>;
	webrtc.udp_port_range = WEBRTC_UDP_PORT_RANGE;
	prefs.webrtc = webrtc;
	await writeFile(file, JSON.stringify(prefs));
}

export async function runChromium(o: RunOptions): Promise<{ stderr: string }> {
	// A persistent profile keeps cookies between runs. That is what lets a
	// Cloudflare challenge be passed ONCE, interactively, and then stay passed:
	// the clearance cookie is the only part of a challenge that outlives it.
	// A challenge itself cannot be replayed -- it is a challenge-response
	// protocol with server-minted, request-bound tokens, so recorded answers
	// never match a fresh attempt (measured: 109 retry iterations, zero missing
	// bytes).
	await sweepStaleProfiles();
	const userDataDir =
		o.profileDir ?? (await mkdtemp(path.join(tmpdir(), "sbxdiff-")));
	await pinWebRtcPorts(userDataDir);
	// The capture callback is a bare `base::WriteFile`, which does not create
	// its parent and reports nothing when it fails. Without this the run looks
	// exactly like one where the page never painted.
	if (o.shotsDir) await mkdir(o.shotsDir, { recursive: true });
	const args = baseArgs(o, userDataDir);
	try {
		return await new Promise((resolve, reject) => {
			const child = spawn(CHROME, args, {
				env: {
					...process.env,
					TZ: "America/Los_Angeles",
					// BoringSSL seeds its own DRBG from the OS, and WebCrypto's key
					// generation and RSA-OAEP padding draw from that DRBG -- so they
					// stayed random even with //base's PRNG pinned. Cloudflare's
					// payload prepends an RSA-encrypted random key, which is why the
					// oracle disagreed with ITSELF on 6 of 8 request bodies. Keyed
					// off the run key, like everything else that has to be
					// reproducible across the two sides of a comparison.
					SBXDIFF_RAND_KEY: `sbxdiff-${o.runKey}`,
					// One logical clock for the whole run, shared by every process
					// in it.
					//
					// A browser has one clock. The logical clock was per process,
					// and the two sides do not have the same processes: the oracle
					// gives the page, the Turnstile widget and
					// brunhild.challenges.cloudflare.com a renderer each, counting
					// from zero in each, while the sandbox collapses every origin
					// onto its own and runs all of them in one, counting all their
					// timers. 7200 ms apart by the time the page minted the `ts`
					// field of its SecChk body -- which was the whole of the
					// difference between two otherwise byte-identical bodies
					// (RULES.md #102, #103).
					//
					// Per SIDE, in that side's trace directory: the oracle and the
					// sandbox must not share one, or the comparison measures a
					// clock both of them are advancing.
					SBXDIFF_LOGICAL_CLOCK_FILE: path.join(o.traceDir, "logical-clock"),
					...(o.bodyDumpDir ? { SBXDIFF_BODY_DUMP_DIR: o.bodyDumpDir } : {}),
				},
				stdio: ["ignore", "ignore", "pipe"],
			});
			let stderr = "";
			child.stderr.on("data", (d) => {
				stderr += d;
			});
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				// WITH the stderr. A run that times out is the case where the
				// evidence matters most, and throwing it away leaves "chromium
				// did not exit" and nothing else -- which cost three runs of
				// guessing at why a change hung the sandbox. The tail, because
				// what a stalled run was doing is at the end of it.
				const tail = stderr.split("\n").slice(-40).join("\n");
				reject(
					new Error(
						`chromium did not exit within ${o.timeoutMs ?? 60000}ms\n` +
							`--- last of its stderr ---\n${tail}`
					)
				);
			}, o.timeoutMs ?? 60000);
			child.on("error", (e) => {
				clearTimeout(timer);
				reject(e);
			});
			child.on("exit", () => {
				// Chromium's stderr, kept beside the traces. The harness parses a
				// few lines out of it and discards the rest, so anything logged
				// from inside the browser -- which is the only way to see what a
				// renderer did -- was unreachable without re-running by hand
				// under a different set of flags, which is a different experiment.
				try {
					writeFileSync(path.join(o.traceDir, "chromium.stderr.log"), stderr);
				} catch {
					// diagnostics only; never fail a run over them
				}
				clearTimeout(timer);
				resolve({ stderr });
			});
		});
	} finally {
		if (!o.profileDir) {
			await rm(userDataDir, { recursive: true, force: true });
		}
	}
}

/**
 * A run produces one file per thread that recorded, not one per run -- a
 * dedicated worker gets its own, because the tracer is thread-local. Never
 * select one by size; load them all and scope by realm.
 */
export async function loadTraces(dir: string): Promise<Trace[]> {
	const out: Trace[] = [];
	for (const name of await readdir(dir)) {
		if (!name.endsWith(".sbxd")) continue;
		const file = path.join(dir, name);
		out.push(decode(file, await readFile(file)));
	}
	return out;
}

/** Merges every thread's records into one logical trace, ordered by seq. */
export function mergeTraces(traces: Trace[]): Trace {
	if (traces.length === 1) return traces[0];
	const realms = new Map<number, string>();
	// Script AND realm ids are per-ISOLATE, so every trace file numbers them
	// from 1 and they collide on merge. "First mapping wins" is not good
	// enough: it silently attributed the page's script 4 to the browser UI
	// process's script 4, which made every guest record in the sandbox look
	// like it was entered by `chrome://resources/lit/v3_0/lit.rollup.js`.
	//
	// Realms were left colliding when scripts were fixed, and that was worse,
	// because realm is what the whole comparison is scoped BY. Measured on
	// rateyourmusic: realm id 1 was claimed by all 17 of the oracle's trace
	// files -- the browser toolbar, the page itself, the Turnstile widget, and
	// every blob worker -- so `selectGuestRealm` matched "realm 1 is
	// https://rateyourmusic.com/" and then swept up 357 195 records belonging
	// to seventeen different documents. The sandbox's guest realm had a large
	// id that collided with nothing, so it stayed clean. Every diff has been
	// comparing a seventeen-document union against one document, which is
	// where the 650 `missing-call` buckets in the baseline came from.
	//
	// Namespace both by file index and rewrite the records to match.
	const scripts = new Map<number, string>();
	const realmCreatedUs = new Map<number, number>();
	const records: Trace["records"] = [];
	const SPACE = 1 << 20;
	traces.forEach((t, i) => {
		const base = i * SPACE;
		for (const [k, v] of t.realms) realms.set(base + k, v);
		for (const [k, v] of t.realmCreatedUs ?? [])
			realmCreatedUs.set(base + k, v);
		for (const [k, v] of t.scripts) scripts.set(base + k, v);
		for (const r of t.records) {
			// 0 means "no JS on the stack" / "no realm" and must stay 0, not
			// become a valid id in this file's namespace.
			const realm = r.realm === 0 ? 0 : base + r.realm;
			if ("topScript" in r) {
				records.push({
					...r,
					realm,
					topScript: r.topScript === 0 ? 0 : base + r.topScript,
					entryScript: r.entryScript === 0 ? 0 : base + r.entryScript,
				});
			} else {
				records.push({ ...r, realm });
			}
		}
	});
	// NOTE: `seq` counts records within ONE file, so this only orders records
	// that share a file. That is enough for the differ, which scopes to a single
	// realm and a realm lives in one file -- but it is not a global ordering,
	// and anything comparing seq ACROSS files is comparing two unrelated
	// counters. Realm creation times (realmCreatedUs) are the cross-file clock.
	records.sort((a, b) => a.seq - b.seq);
	return {
		file: traces.map((t) => path.basename(t.file)).join(","),
		version: traces[0]?.version ?? 0,
		pid: traces[0]?.pid ?? 0,
		runKey: traces[0]?.runKey ?? 0,
		realms,
		realmCreatedUs,
		scripts,
		records,
		truncatedBytes: traces.reduce((n, t) => n + t.truncatedBytes, 0),
	};
}
