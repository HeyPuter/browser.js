/**
 * sbxdiff driver: run one page in bare Chromium and in scramjet, diff them.
 *
 *   pnpm runway sbxdiff                      # run the probe, print the report
 *   pnpm runway sbxdiff --baseline           # record the current buckets as expected
 *   pnpm runway sbxdiff --page other.html
 *
 * Both runs use the *same* patched binary and the *same* run key; the only
 * difference is which harness loads the page. That is what makes a divergence
 * attributable to the sandbox rather than to the browser.
 */

import express from "express";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { startHarness, PORT as SJ_PORT } from "../harness/scramjet/index.ts";
import { startBareHarness, BARE_PORT } from "../harness/bare/index.ts";
import {
	bucketize,
	carriesAnAbsoluteUrl,
	numericSpread,
	withinNoiseSpread,
	classifyScripts,
	diff,
	formatReport,
	selectGuestRealm,
	visibleRealmUrl,
	DEFAULT_SHIM_IDENTIFIERS,
	type DiffOptions,
	type Divergence,
	type LeakMarkers,
	type Report,
	type Side,
} from "./diff.ts";
import { loadTraces, mergeTraces, runChromium } from "./run.ts";
import { diffExtraRealms } from "./realms.ts";
import { requestSequence, sequenceDivergences } from "./requests.ts";
import {
	diffExceptions,
	formatExceptions,
	thrownErrors,
} from "./exceptions.ts";
import {
	formatStructural,
	loadStructural,
	structuralVerdict,
} from "./structural.ts";
import { Kind } from "./trace.ts";
import { loadStore, mountStoreEndpoint, reqBodyKey } from "./store.ts";
import { guestOps as readGuestOps, guestOpStats } from "./guestop.ts";
import { bodyShape } from "./bodyshape.ts";
import { bodySpread, withinBodyNoise } from "./bodynoise.ts";
import {
	bodyDivergences as bodyDivergenceRecords,
	endpointShape,
	splitKey,
} from "./bodydiff.ts";

const HERE = import.meta.dirname;
/** Where the probe pages are served from. The "site under test". */
const SITE_PORT = 4510;

// Known-and-accepted buckets, and buckets the oracle cannot reproduce against
// ITSELF -- both per target host.
//
// Per host because a bucket key is `tier|kind|api|class` with no page in it. A
// baseline recorded on rateyourmusic silently suppressed 28 probe-page buckets
// the first time the two shared one file, which is exactly the failure mode a
// baseline is supposed to prevent.
// host plus path, so two probe pages on the same origin do not share one file
// either -- `--page csp.html --baseline` would otherwise overwrite probe.html's.
function targetKey(target: string) {
	const u = new URL(target);
	const rest = u.pathname.replace(/^\/+/, "").replace(/[^a-zA-Z0-9.]+/g, "-");

	return rest ? `${u.hostname}.${rest}` : u.hostname;
}

function baselineFile(target: string) {
	return path.join(HERE, `baseline.${targetKey(target)}.json`);
}

// Buckets the oracle cannot reproduce against ITSELF, from --self-check
// --baseline. Kept apart from baseline.json on purpose: a baselined bucket is
// "known and accepted", whereas one in here is "the oracle has nothing to say",
// and conflating the two would let a real sandbox bug hide behind oracle noise
// without that ever being visible in the output.
function noiseFile(target: string) {
	return path.join(HERE, `noise.${targetKey(target)}.json`);
}

/**
 * Wall-clock epoch ms the virtual clock starts at when there is no store to
 * take it from. Arbitrary, and fine for a local probe page.
 */
const DEFAULT_TIME_BASE = 1700000000000;

/**
 * A store records WHEN it was captured, and a replay adopts that time.
 *
 * Recorded responses are not timeless. A Cloudflare challenge embeds tokens
 * minted at capture time and its script compares them against the device
 * clock; replaying those bytes under a clock pinned to some unrelated constant
 * makes the page reject its own challenge for having the wrong device time.
 * The same applies to anything else with an expiry -- cookies, JWTs, cache
 * validators.
 */
const TIME_BASE_FILE = "sbxdiff-time-base.json";

async function readTimeBase(dir: string): Promise<number | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(path.join(dir, TIME_BASE_FILE), "utf8")
		);
		return typeof raw.initialTimeMs === "number"
			? raw.initialTimeMs
			: undefined;
	} catch {
		return undefined;
	}
}
/** Where the oracle run records responses for the sandbox to replay. */
const STORE = path.join(HERE, ".traces", "store");
/** Filled by the store endpoint; a nonzero count means the runs saw different bytes. */
const storeMisses: string[] = [];
// Served from a recording whose URL differs in exactly one path segment. Real
// divergences -- a client-minted random id the two sides cannot agree on --
// reported apart from hits so they never pass as clean.
const storeNears: string[] = [];
// Served the LAST recording because the page asked more times than the
// recording did. The store's most dangerous leniency: for a site whose last
// recorded response is the destination, a page stuck in a retry loop is handed
// that destination and looks like it arrived.
const storePastEnds: string[] = [];
// The sandbox posted something other than what the recording posted, and was
// handed the recorded response anyway. The store cannot grade a request, so
// this is the only thing that separates "produced the same answer" from "was
// told what it wanted to hear".
const storeBodyMismatches: string[] = [];
// url#ordinal -> FNV-1a of the body the SANDBOX posted there, for every
// body-carrying request. Paired against the oracle's own hashes, which come
// out of its stderr. See `reqBodyKey`.
const sandboxReqBodies = new Map<string, string>();
// url#ordinal -> the hash the ORACLE posted there. Filled after the oracle run
// and before the sandbox starts, so the transport can grade the sandbox's
// requests the way the real server would rather than handing back a recorded
// "you passed" whatever was sent.
const oracleReqBodies = new Map<string, string>();
// Requests the transport refused under --strict-bodies.
const storeRejections: string[] = [];
// Set from --strict-bodies before the sandbox launches.
const strictBodies = { on: false };

async function startSite(store: Awaited<ReturnType<typeof loadStore>>) {
	const app = express();
	mountStoreEndpoint(
		app,
		store,
		storeMisses,
		storeNears,
		storePastEnds,
		storeBodyMismatches,
		sandboxReqBodies,
		oracleReqBodies,
		// A getter, not a value: the store is mounted before the flag is
		// parsed, and before the oracle has produced the hashes to grade
		// against.
		() => strictBodies.on,
		storeRejections
	);
	// A 302 to a real script, so `blankframe.html` can test the shape
	// Cloudflare's JS detections actually have: the URL a page injects is a
	// redirect, and a delegated load has to follow it the way the browser's own
	// would. Declared before the static mount so it wins over any file.
	app.get("/redir-marker.js", (_req, res) => {
		res.redirect(302, "/marker2.js");
	});
	app.use(express.static(path.join(HERE, "pages")));
	// A 1x1 PNG, so `img.src` resolves against something real.
	app.get("/asset.png", (_req, res) => {
		res
			.type("png")
			.send(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
					"base64"
				)
			);
	});
	await new Promise<void>((r) => app.listen(SITE_PORT, r));
	console.log(`    Site under test on port ${SITE_PORT}`);
}

type RunSpec = {
	label: string;
	/** null = navigate straight to the target, with no harness frame. */
	harnessUrl: string | null;
	/** Recognizes the realm the guest page owns in this run. */
	guest: (url: string) => boolean;
	/** Only the oracle records; the sandbox replays through its transport. */
	netRecord?: string;
	virtualTime?: boolean;
	/** Epoch ms the virtual clock starts at. See TIME_BASE_FILE. */
	initialTimeMs?: number;
	profileDir?: string;
	vtFence?: boolean;
	softMiss?: boolean;
	/** Real-time grace after the page stops loading, before the browser quits. */
	graceMs?: number;
	vtPolicy?: "deterministic" | "advance" | "pause";
	vtBudget?: number;
	/** URL substring of this run's guest realm; virtual time starts there. */
	vtAfter?: string;
	/** `<origin>,<prefix>` identifying the proxy's own scripts. Sandbox only. */
	shimScripts?: string;
	headed?: boolean;
	click?: string;
	clickFrame?: string;
	netReplay?: string;
	/** Capture the viewport every N ms into `.traces/<label>-shots/`. */
	shotsIntervalMs?: number;
};

async function capture(spec: RunSpec, target: string, runKey: string) {
	const dir = path.join(HERE, ".traces", spec.label);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });

	// Per side, because a self-check runs two ORACLES and a shared directory
	// would have the second overwrite the first -- leaving a byte-diff of a
	// file against itself.
	//
	// The SANDBOX's dumps do not land here: a real sandbox posts its bytes to
	// the store server, which writes them flat at the root. Those are cleared
	// once per run in `main()`, not here -- clearing them per side would have
	// the sandbox's capture delete what it is about to write.
	const bodyDumpDir = path.join(HERE, ".traces", "bodydiff", spec.label);
	await rm(bodyDumpDir, { recursive: true, force: true });

	// Beside the trace rather than inside it: `loadTraces` globs the trace
	// directory, and a subdirectory of PNGs there is a decode failure waiting
	// to happen.
	const shotsDir = spec.shotsIntervalMs
		? path.join(HERE, ".traces", `${spec.label}-shots`)
		: undefined;
	if (shotsDir) await rm(shotsDir, { recursive: true, force: true });

	// base64, so the target does not appear literally in the harness page's own
	// URL -- --sbxdiff-virtual-time-after matches on a URL substring and an
	// embedded copy made the harness match as the guest realm.
	const url = spec.harnessUrl
		? `${spec.harnessUrl}#b64:${Buffer.from(target).toString("base64")}`
		: target;
	const t0 = Date.now();
	const { stderr } = await runChromium({
		url,
		traceDir: dir,
		runKey,
		bodyDumpDir,
		shimScripts: spec.shimScripts,
		graceMs: spec.graceMs ?? 3000,
		netRecord: spec.netRecord,
		netReplay: spec.netReplay,
		headed: spec.headed,
		profileDir: spec.profileDir,
		softMiss: spec.softMiss,
		click: spec.click,
		clickFrame: spec.clickFrame,
		shotsDir,
		shotsIntervalMs: spec.shotsIntervalMs,
		// Virtual time needs the `advance` policy here. The default,
		// kDeterministicLoading, pauses the clock while a load is outstanding,
		// which deadlocks any load served by a worker that needs timers to make
		// progress. Both sides get identical settings either way -- asymmetric
		// clocks would diverge on every timing-derived value.
		// The side that cannot have virtual time still gets the same clock
		// ORIGIN. Otherwise it runs on the real wall clock while the other runs
		// from a pinned one, and that is guest-readable: Cloudflare's JS
		// detections compare the challenge's issue time from
		// `__CF$cv$params.t` against `Date.now()`, so a recorded challenge
		// replayed hours later looks stale and the script stops without an
		// error -- measured, the oracle posted 16270 bytes to `jsd/oneshot` and
		// the sandbox posted nothing at all.
		...(spec.virtualTime
			? {}
			: { timeOriginMs: spec.initialTimeMs ?? DEFAULT_TIME_BASE }),
		...(spec.virtualTime
			? {
					initialTimeMs: spec.initialTimeMs ?? DEFAULT_TIME_BASE,
					virtualTimeBudgetMs: spec.vtBudget ?? 30000,
					virtualTimePolicy: spec.vtPolicy ?? "advance",
					virtualTimeAfter: spec.vtAfter,
					virtualTimeFence: spec.vtFence,
				}
			: {}),
		// Generous, because the two sides need very different amounts of WALL
		// clock for the same journey. The oracle's clock is virtual, so its
		// whole run compresses -- on rateyourmusic its Cloudflare JS-detections
		// frame finishes at 18% of the run. The sandbox cannot have virtual time
		// (RULES.md #59), so the same work happens at real speed and lands at
		// the very end: measured, that frame was still working at 99.5% of the
		// run and the run ended on top of it. A timeout that cuts the sandbox
		// short turns "the sandbox never sent this request" into a finding when
		// it is the harness's stopwatch.
		timeoutMs: Number(process.env.SBXDIFF_RUN_TIMEOUT_MS ?? 240000),
	});

	if (process.env.SBXDIFF_VERBOSE) {
		await writeFile(path.join(dir, "stderr.log"), stderr);
	}
	// The oracle's request bodies never touch the store server -- it replays
	// inside the network service -- so its hashes come back the only way they
	// can, printed to stderr. Parsed unconditionally: this is the reference the
	// sandbox is scored against, not a debugging aid to switch on later.
	const reqBodies = new Map<string, string>();
	// And its MISSES, for the same reason and from the same place.
	//
	// Without these the run reports "the sandbox asked for bytes the oracle
	// never fetched" having never looked at what the oracle asked for. It only
	// knows what the oracle FETCHED, which is not the same thing: a URL neither
	// side can find in the store is a gap in the recording, not a divergence
	// between them. Measured on rateyourmusic, all three such "misses" were
	// Google Analytics endpoints that BOTH sides beacon to -- the traces show
	// `Navigator.sendBeacon` on each -- carrying a timestamp in `cid` that no
	// recording can match.
	const misses = new Set<string>();
	for (const line of stderr.split("\n")) {
		const m = /sbxdiff: replay REQBODY #(\d+) (\S+) (\S+)$/.exec(line.trim());
		if (m) reqBodies.set(reqBodyKey(m[3], Number(m[1])), m[2]);
		const miss = /sbxdiff: replay MISS #\d+ (\S+)$/.exec(line.trim());
		if (miss) misses.add(miss[1]);
	}
	const traces = await loadTraces(dir);
	const merged = mergeTraces(traces);
	const found = selectGuestRealm(merged, spec.guest);
	console.log(
		`    ${spec.label}: ${traces.length} file(s), ${merged.records.length} records, ${Date.now() - t0}ms`
	);
	if (!found) {
		console.log(`      realms seen: ${[...merged.realms.values()].join(", ")}`);
		throw new Error(`${spec.label}: no guest realm matched`);
	}
	console.log(`      guest realm r${found.realm} -> ${found.url}`);
	// What the diff is NOT looking at.
	//
	// The differ scopes to ONE realm per side, because that is the only scoping
	// under which two sides are comparable at all. The cost is that everything
	// else is invisible, and invisible reads as absent: a self-check reported
	// "0 divergences" while five request bodies still differed, because the
	// Cloudflare payload is built in a blob worker on challenges.cloudflare.com
	// and the diffed realm was the page. Silence about the rest of the run is
	// the thing that turns a scope into a wrong answer, so say the size of it.
	let outside = 0;
	for (const r of merged.records) {
		if (r.realm !== found.realm) outside++;
	}
	if (outside) {
		console.log(
			`      not diffed: ${merged.realms.size - 1} other realm(s), ` +
				`${outside} record(s) (${Math.round((outside / merged.records.length) * 100)}% of the run) ` +
				`-- --realm <substring> to scope to one of them`
		);
	}
	return {
		trace: merged,
		realm: found.realm,
		url: found.url,
		reqBodies,
		misses,
	} satisfies Side;
}

async function main() {
	const args = process.argv.slice(2);
	const recordBaseline = args.includes("--baseline");
	// On by default: a pinned clock is the point of the oracle, and it now
	// produces the same diff as a real-clock run (1191/1/1 either way) with
	// Date.now() reproducible to ~1 ms. --no-virtual-time opts out.
	// --no-virtual-time [oracle|sandbox|both], default both, same shape as
	// --vt-fence.
	//
	// Per side because the two sides need opposite things on a page like
	// rateyourmusic. The ORACLE needs virtual time: it is what makes the clock
	// reproducible, and with it the challenge passes. The SANDBOX cannot have
	// it: under `kDeterministicLoading` the Turnstile widget's frame never
	// starts its blocking `<script src>` at all -- measured, the frame sits at
	// `readyState: "loading"` with one script and 83 bytes of DOM for the whole
	// run. Without it the widget runs, its blob workers spin up, and the realm
	// goes from 268 records to 41756.
	const vtArg = args.indexOf("--no-virtual-time");
	const vtOffSide =
		vtArg >= 0 && ["oracle", "sandbox", "both"].includes(args[vtArg + 1] ?? "")
			? args[vtArg + 1]
			: "both";
	const vtOff = vtArg >= 0;
	const useVirtualTimeOracle = !(vtOff && vtOffSide !== "sandbox");
	const useVirtualTimeSandbox = !(vtOff && vtOffSide !== "oracle");
	const useVirtualTime = !vtOff;
	// --vt-policy <policy> [oracle|sandbox|both], default deterministic on both.
	//
	// deterministic, not advance: advance turns every idle moment into a
	// nondeterministic clock jump (measured 54/60/54/80 s of drift, and it even
	// slipped an exact 250 ms timer to 249).
	//
	// Per side, the same shape as --vt-fence and for the same reason: what is
	// right for the oracle is wrong for the sandbox. kDeterministicLoading
	// pauses the clock while a load is outstanding, and a sandbox's loads are
	// served by a service worker whose transport needs timers to progress, so
	// neither side ever moves -- which is why `--vt-policy deterministic` on the
	// sandbox does not merely diverge, it HANGS (measured: the run never
	// finished within 240 s and the guest iframe sat on Express's 404 body,
	// meaning the worker never intercepted the navigation at all).
	// `advance` is the documented sandbox policy for exactly this reason.
	const vtPolicyArg = args.indexOf("--vt-policy");
	const vtPolicyValue = (
		vtPolicyArg >= 0 ? args[vtPolicyArg + 1] : "deterministic"
	) as "deterministic" | "advance" | "pause";
	const vtPolicySide =
		vtPolicyArg >= 0 &&
		["oracle", "sandbox", "both"].includes(args[vtPolicyArg + 2] ?? "")
			? args[vtPolicyArg + 2]
			: "both";
	const vtPolicyOracle =
		vtPolicySide === "sandbox" ? "deterministic" : vtPolicyValue;
	const vtPolicySandbox =
		vtPolicySide === "oracle" ? "deterministic" : vtPolicyValue;
	const vtBudgetArg = args.indexOf("--vt-budget");
	const vtBudgetRaw = vtBudgetArg >= 0 ? Number(args[vtBudgetArg + 1]) : 30000;
	// A NaN here becomes `--sbxdiff-virtual-time-budget=NaN`, which Chromium
	// rejects and which failed the run with an unrelated-looking "no guest
	// realm matched".
	if (!Number.isFinite(vtBudgetRaw)) {
		console.error(
			`  --vt-budget must be a number, got ${args[vtBudgetArg + 1]}`
		);
		process.exit(2);
	}
	const vtBudget = vtBudgetRaw;
	const pageArg = args.indexOf("--page");
	const page = pageArg >= 0 ? args[pageArg + 1] : "probe.html";
	// --url points both runs at a real site instead of a probe page. The
	// sandbox reaches it only through the store, never the live network.
	const urlArg = args.indexOf("--url");
	const target =
		urlArg >= 0 ? args[urlArg + 1] : `http://localhost:${SITE_PORT}/${page}`;
	const headed = args.includes("--headed");
	// Persistent profile, so a challenge passed once stays passed.
	// Chromium's default fencing. Off by default because it deadlocks a
	// service-worker sandbox; on, a page cannot observe JS running while the
	// clock is frozen.
	// --vt-fence [oracle|sandbox|both], default both.
	//
	// Per side because the two sides serve loads from different places, and
	// fencing is only safe for one of them (RULES.md #40). The oracle NEEDS the
	// fence -- without it rateyourmusic's challenge takes different branches and
	// stalls at 5510 records. The sandbox's loads are served by a service worker
	// that delegates back to the client page, so fencing the page stops the work
	// that would release the pause.
	const vtFenceArg = args.indexOf("--vt-fence");
	const vtFenceSide =
		vtFenceArg >= 0 &&
		["oracle", "sandbox", "both"].includes(args[vtFenceArg + 1] ?? "")
			? args[vtFenceArg + 1]
			: "both";
	const vtFence = vtFenceArg >= 0;
	const vtFenceOracle = vtFence && vtFenceSide !== "sandbox";
	const vtFenceSandbox = vtFence && vtFenceSide !== "oracle";
	// --strict-bodies: refuse a recorded response when the body posted to it
	// does not match the ORACLE's.
	//
	// A store cannot grade a request, so by default Cloudflare's recorded "you
	// passed" comes back whatever was posted -- which means a sandbox whose
	// payload the live server would reject sails through replay and looks like
	// it passed. That is why the live failure (post, rejected, retry, loop) has
	// never reproduced here. With this on, replay answers 403 exactly where the
	// real server would, and the loop appears.
	strictBodies.on = args.includes("--strict-bodies");
	const softMiss = args.includes("--soft-miss");
	const profileArg = args.indexOf("--profile");
	const profileDir =
		profileArg >= 0 ? path.resolve(args[profileArg + 1]) : undefined;
	// Real-time grace after the page stops loading. The default 3 s is plenty
	// for a probe page; a challenge that has to run on a real clock (see
	// --no-virtual-time above) needs the browser kept alive for its own
	// timers, which are seconds long.
	const graceArg = args.indexOf("--grace");
	const graceMs = graceArg >= 0 ? Number(args[graceArg + 1]) : 3000;
	if (!Number.isFinite(graceMs)) {
		console.error(`  --grace must be a number, got ${args[graceArg + 1]}`);
		process.exit(2);
	}
	const clickArg = args.indexOf("--click");
	const click = clickArg >= 0 ? args[clickArg + 1] : undefined;
	const clickFrameArg = args.indexOf("--click-frame");
	const clickFrame = clickFrameArg >= 0 ? args[clickFrameArg + 1] : undefined;
	// --shots [<interval_ms>]: a viewport strip per side, in
	// `.traces/<label>-shots/`. Off unless asked for -- a capture every second
	// over a 276-second run is 276 PNGs a side, and it is diagnostic rather
	// than part of the gate.
	const shotsArg = args.indexOf("--shots");
	let shotsIntervalMs: number | undefined;
	if (shotsArg >= 0) {
		const next = args[shotsArg + 1];
		shotsIntervalMs = next && !next.startsWith("--") ? Number(next) : 1000;
		if (!Number.isFinite(shotsIntervalMs) || shotsIntervalMs <= 0) {
			console.error(`  --shots must be a positive number of ms, got ${next}`);
			process.exit(2);
		}
	}
	// Reuse an existing store instead of recording one. The rym recipe records
	// it once from a direct headed run that passes Turnstile, then replays that
	// into both sides.
	const storeOutArg = args.indexOf("--store-out");
	const storeArg = args.indexOf("--store");
	const storeDir =
		storeOutArg >= 0
			? path.resolve(args[storeOutArg + 1])
			: storeArg >= 0
				? path.resolve(args[storeArg + 1])
				: STORE;
	const reuseStore = storeArg >= 0;
	// Record only: do the oracle run, keep the store, skip the sandbox. The
	// expensive headed challenge-passing run happens once.
	const recordOnly = storeOutArg >= 0;
	// Everything that has to recognise "the page under test" derives from this,
	// so --url works without three separate hardcoded origins going stale.
	// Captured BEFORE the recording run so it brackets everything the store
	// contains, and reused verbatim on replay.
	const timeBase = reuseStore ? await readTimeBase(storeDir) : Date.now();
	if (reuseStore && timeBase === undefined) {
		console.log(
			`  (store has no ${TIME_BASE_FILE}; falling back to the default clock —\n` +
				`   anything in it with an expiry, a Cloudflare challenge especially,\n` +
				`   will see the wrong device time and reject itself)`
		);
	}
	// --realm <substring>: diff a realm OTHER than the page under test.
	//
	// The differ scopes to one realm per side, chosen by matching the target
	// URL, which means a cross-origin subframe is never compared at all. On
	// rateyourmusic that is where the interesting code lives: Cloudflare's
	// Turnstile widget is its own realm, it builds the `/fo/` payloads, and it
	// was invisible -- a run could report zero guest-visible divergences while
	// the widget's payload differed by a thousand bytes. Matching on a
	// substring works on both sides because the sandbox's realm URL contains
	// the upstream one, percent-encoded, inside the proxy path.
	const realmArg = args.indexOf("--realm");
	const realmMatch = realmArg >= 0 ? args[realmArg + 1] : undefined;
	const targetOrigin = new URL(target).origin;
	const targetHostPort = new URL(target).host;
	const runKey = "sbxdiff-scramjet";

	// The oracle records into the store, so it has to be empty first -- a stale
	// store would let the sandbox replay bytes from a previous page.
	if (!reuseStore) {
		await rm(storeDir, { recursive: true, force: true });
	}
	// And so do the flat body dumps the store server writes for the sandbox.
	//
	// They accumulated across every run this tool had ever done: measured,
	// 44 `.sandbox` files from three different days, carrying challenge tokens
	// from stores that no longer exist. An offline re-diff read them as bodies
	// the sandbox had posted and the oracle had not -- 44 divergences, none of
	// them from this run. The per-side directories were always cleared; these
	// never were, because nothing owned them.
	await rm(path.join(HERE, ".traces", "bodydiff"), {
		recursive: true,
		force: true,
	});
	await mkdir(storeDir, { recursive: true });
	// Loaded after the oracle run; the endpoint reads through this map.
	const store = new Map();
	await startSite(store);
	await startHarness();
	await startBareHarness();
	// The scramjet harness needs its service worker registered and its
	// controller ready before it can navigate; both servers are up now.
	await new Promise((r) => setTimeout(r, 500));

	console.log(`\n  target: ${target}\n`);

	// --framed-oracle puts the oracle's page in the bare harness's iframe.
	//
	// Off by default, and the default is the interesting bit: scramjet presents
	// the guest as a TOP-LEVEL document, so framing the oracle makes the two
	// sides disagree about facts the sandbox is deliberately (and correctly)
	// hiding -- top===self, parent===self, document.referrer. Those showed up as
	// three guest-observable divergences that were entirely artifacts of the
	// harness. Loading the oracle top-level matches what the sandbox claims, and
	// is also what a real visitor sees.
	const framedOracle = args.includes("--framed-oracle");
	// --self-check replaces the sandbox with a SECOND oracle run.
	//
	// An oracle that is not reproducible cannot convict the sandbox of
	// anything: every bucket it reports might be its own noise. This measures
	// that directly, with the same differ, on the same page -- so "rym has 40
	// unstable buckets" is a number rather than a hunch.
	const selfCheck = args.includes("--self-check");
	// --all-realms diffs every realm the two sides share, not just the page.
	// See diffExtraRealms: reported, never gated.
	const allRealms = args.includes("--all-realms");
	// The guest-op recorder. See the sandbox spec below for why it defaults on.
	const guestOps = !args.includes("--no-guestops");
	const oracleSpec = {
		label: "oracle",
		harnessUrl: framedOracle ? `http://localhost:${BARE_PORT}/` : null,
		// The TARGET page, not merely its origin. `selectGuestRealm` falls back
		// to "the realm with the most records", and a probe page with an iframe
		// has two realms on the origin: the moment the frame got busier than
		// the page, the two sides compared DIFFERENT documents and every
		// observation on both showed up as missing or extra.
		guest: realmMatch
			? (u) => u.includes(realmMatch)
			: (u) => u.startsWith(target),
		// Record unless a prepared store was supplied, in which case the
		// oracle replays it too so both sides see identical bytes.
		initialTimeMs: timeBase ?? DEFAULT_TIME_BASE,
		profileDir,
		netRecord: reuseStore ? undefined : storeDir,
		netReplay: reuseStore ? storeDir : undefined,
		headed,
		click,
		clickFrame,
		shotsIntervalMs,
		virtualTime: useVirtualTimeOracle,
		vtPolicy: vtPolicyOracle,
		vtBudget,
		vtFence: vtFenceOracle,
		graceMs,
		softMiss,
		// The oracle's guest realm is the site's own origin.
		vtAfter: targetHostPort,
	} as const;
	const oracle = await capture(oracleSpec, target, runKey);

	if (recordOnly) {
		// Deliberately on ONE line: the C++ store index skips any file with no
		// newline in it, so the metadata cannot be mistaken for a recording
		// without teaching the C++ side about it.
		await writeFile(
			path.join(storeDir, TIME_BASE_FILE),
			JSON.stringify({ initialTimeMs: timeBase })
		);
		const recorded = await loadStore(storeDir);
		const n = [...recorded.values()].reduce((a, v) => a + v.length, 0);
		const repeats = [...recorded.values()].filter((v) => v.length > 1).length;
		console.log(
			`\n  Recorded ${n} response(s) across ${recorded.size} URL(s) -> ${storeDir}`
		);
		if (repeats) {
			// Worth surfacing: these are the URLs whose body changed between
			// requests, which is the case a URL-only key used to lose.
			console.log(`  ${repeats} URL(s) returned more than one response:`);
			for (const [url, v] of recorded) {
				if (v.length > 1) console.log(`      ×${v.length}  ${url}`);
			}
		}
		console.log("  Now: pnpm sbxdiff --url <same> --store <that dir>");
		process.exit(n > 0 ? 0 : 1);
	}

	// Hand the oracle's recording to the endpoint the sandbox's transport
	// fetches from, so the sandbox sees exactly the bytes the oracle saw.
	for (const [k, v] of await loadStore(storeDir)) store.set(k, v);
	const total = [...store.values()].reduce((a, v) => a + v.length, 0);
	console.log(
		`    store: ${total} recorded response(s) across ${store.size} URL(s)`
	);

	// The oracle has run; its request bodies are the reference the sandbox is
	// graded against. Must happen before the sandbox launches, because the
	// transport takes them in its preload.
	for (const [k, v] of oracle.reqBodies) oracleReqBodies.set(k, v);
	if (strictBodies.on) {
		console.log(
			`    strict bodies: ${oracleReqBodies.size} oracle body hash(es) to grade against`
		);
	}

	const farLabel = selfCheck ? "oracle#2" : "sandbox";
	const sandbox = selfCheck
		? await capture({ ...oracleSpec, label: farLabel }, target, runKey)
		: await capture(
				{
					label: "sandbox",
					// ?sbxdiffStore swaps the wisp transport for the store-backed one.
					// ?sbxdiffProbe runs the guest-op recorder at the top of
					// every guest document, ahead of the page's own scripts.
					//
					// It is on by default and `--no-guestops` turns it off,
					// which is the right way round: without it the differ cannot
					// see a single intercepted API and reports a clean run for
					// the 43 of them (1344 calls) rateyourmusic touches in the
					// page realm. A measurement instrument that has to be
					// remembered is one that will be forgotten.
					harnessUrl:
						`http://localhost:${SJ_PORT}/?sbxdiffStore=${SITE_PORT}` +
						(guestOps ? `&sbxdiffProbe=%2Fsbxdiff-guestop.js` : ``),
					// The proxied form of the TARGET page specifically -- the
					// prefix alone also matches its iframes. See the oracle's
					// `guest` above.
					guest: realmMatch
						? (u) => u.includes(realmMatch)
						: (u) =>
								u.includes("/~/sj/") && u.includes(encodeURIComponent(target)),
					initialTimeMs: timeBase ?? DEFAULT_TIME_BASE,
					headed,
					click,
					clickFrame,
					shotsIntervalMs,
					virtualTime: useVirtualTimeSandbox,
					vtPolicy: vtPolicySandbox,
					vtBudget,
					vtFence: vtFenceSandbox,
					graceMs,
					softMiss,
					// Everything on the proxy's origin that is not behind its
					// prefix is the shim itself; everything behind it is the page
					// under test. That is the only thing separating them, and it
					// is what lets a clock advance for one and not the other.
					shimScripts: `http://localhost:${SJ_PORT},/~/sj/`,
					// The sandbox's guest realm is the proxied page. Setup -- service
					// worker registration, controller handshake -- happens before this
					// and therefore on the real clock, which is the whole point.
					//
					// Matched on the ENCODED target origin, not just the proxy prefix:
					// scramjet serves its own assets under that prefix too
					// (`/~/sj/<ctx>/scramjet.wasm.js`), and each match re-arms the
					// virtual time budget. Matching the prefix alone re-armed it for
					// every shim asset, letting the clock drift ~90-110s by the time
					// guest script ran, differently on each run.
					vtAfter: encodeURIComponent(targetOrigin),
				},
				target,
				runKey
			);

	// Oracle against sandbox, which is the comparison that means something.
	//
	// A request body is guest-observable output in the strongest sense: it is
	// what the page TELLS the server about itself. Cloudflare's is a fingerprint
	// of the whole environment, so it catches divergences no API-call trace
	// reaches -- but only when scored against a run that is actually comparable.
	// Against the RECORDING it is scored against noise: the recording came from
	// a different run with a different wall clock, and unmodified Chromium
	// disagrees with it on all five of these endpoints too.
	//
	// The sandbox's hashes come from its transport, the oracle's from its
	// stderr; both are FNV-1a in the format `<length>:<base36>`, computed by
	// three separate implementations that have to agree (store.ts,
	// sbxdiff-transport.js, sbxdiff_net_replay.cc).
	//
	// Both sources, merged, because the far side is not always a sandbox. Under
	// --self-check it is a second ORACLE run, which replays in Chromium and so
	// reports through stderr like the first one; only a real sandbox run goes
	// through the in-page transport and the store server. Reading just the store
	// map made --self-check report no bodies at all -- and --self-check is
	// exactly where the noise floor for this measurement comes from.
	// The body spreads from the noise file, read here because the body
	// comparison happens before the bucket report. Not under --self-check:
	// subtracting the floor from the run that measures it reports zero.
	let noiseBodySpreads: Record<string, number> = {};
	if (!selfCheck) {
		try {
			const parsed = JSON.parse(await readFile(noiseFile(target), "utf8"));
			noiseBodySpreads = parsed.bodySpreads ?? {};
		} catch {
			// Optional, and its absence is the conservative direction: with no
			// floor recorded, any difference is charged to the sandbox.
		}
	}
	const sandboxBodies = new Map([...sandbox.reqBodies, ...sandboxReqBodies]);
	const bodyKeys = [
		...new Set([...oracle.reqBodies.keys(), ...sandboxBodies.keys()]),
	].sort();
	const allBodyDiffs = bodyKeys
		.map((key) => ({
			key,
			o: oracle.reqBodies.get(key),
			s: sandboxBodies.get(key),
		}))
		.filter(({ o, s }) => o !== s);
	// The noise floor is keyed on the endpoint's SHAPE, not on its URL.
	//
	// A challenge URL carries a per-run token minted when the store was
	// recorded, so a floor keyed on the URL stops matching the moment the store
	// is re-recorded -- silently, and in the direction that turns every body
	// into a divergence. The old keys are still read so an existing noise file
	// keeps working until it is re-recorded.
	const spreadKey = (key: string) => {
		const { url, ordinal } = splitKey(key);

		return `${endpointShape(url)}#${ordinal}`;
	};
	const floorFor = (key: string) =>
		noiseBodySpreads[spreadKey(key)] ?? noiseBodySpreads[key];
	// Scored against the oracle's own spread, like every other comparison here.
	//
	// This one demanded byte equality, and the oracle cannot give it: two
	// ORACLE runs of this recipe post 87746 bytes against 87767, because
	// Cloudflare's payload carries one entry per pointer event and no two runs
	// see the same number. A gate that fails for that fails for a second
	// oracle, which makes it a gate on nothing. See `bodynoise.ts`.
	const bodyDivergences = selfCheck
		? allBodyDiffs
		: allBodyDiffs.filter(
				({ key, o, s }) => !withinBodyNoise(o, s, floorFor(key))
			);
	const bodyNoise = allBodyDiffs.length - bodyDivergences.length;
	// An empty side is an instrument failure, not a run in which the page sent
	// nothing. Report it as one, rather than listing every request the other
	// side made as a divergence.
	if (sandboxBodies.size && !oracle.reqBodies.size) {
		console.log(
			`\n  request bodies: the oracle reported none and the sandbox reported ` +
				`${sandboxBodies.size}. That is the instrument, not the page -- the ` +
				`oracle's hashes come from its stderr, so check that Chromium logging ` +
				`is on.`
		);
	} else if (!bodyDivergences.length && bodyNoise) {
		console.log(
			`\n  ${bodyNoise} request body(ies) differ but are inside the oracle's own spread ` +
				`(--self-check --baseline records it).`
		);
	} else if (bodyDivergences.length) {
		console.log(
			`\n  ${bodyDivergences.length} request-body divergence(s) -- the two runs told the server different things about themselves:`
		);
		if (bodyNoise) {
			console.log(
				`      (${bodyNoise} more differ but are inside the oracle's own spread)`
			);
		}
		for (const { key, o, s } of bodyDivergences.slice(0, 10)) {
			const [url, ord] = key.split(/#(\d+)$/);
			console.log(`      #${ord} oracle ${o ?? "(none sent)"}`);
			console.log(`          sandbox ${s ?? "(none sent)"}`);
			console.log(`          ${url}`);
			const shape = bodyShape(oracleSpec.label, farLabel, url!, Number(ord));
			if (shape) console.log(`          ${shape}`);
		}
	} else if (bodyKeys.length) {
		console.log(
			`\n  ${bodyKeys.length} request body(ies), all byte-identical across the two runs.`
		);
	}
	if (storeBodyMismatches.length) {
		// Informational, and NOT a failure. Both sides disagree with the
		// recording here; see above for why that is expected rather than a bug.
		console.log(
			`\n  (${storeBodyMismatches.length} of those also differ from the recording, as the oracle's do -- see RULES.md #61)`
		);
	}
	if (storeRejections.length) {
		// Not a divergence on its own -- it is the consequence of one, and the
		// request-body list above says which. What it adds is that the run got
		// the answer a real server would have given, so anything after this
		// point is the sandbox's actual behaviour under rejection rather than a
		// recorded success it was handed regardless.
		console.log(
			`\n  ${storeRejections.length} request(s) REFUSED (--strict-bodies) -- replay answered 403 where the real server would:`
		);
		for (const m of storeRejections.slice(0, 10)) console.log(`      ${m}`);
	}
	if (storePastEnds.length) {
		console.log(
			`\n  ${storePastEnds.length} past-the-end hit(s) -- asked more times than recorded, served the last:`
		);
		for (const m of [...new Set(storePastEnds)].slice(0, 10)) {
			console.log(`      ${m}`);
		}
	}
	if (storeNears.length) {
		console.log(
			`\n  ${storeNears.length} near match(es) -- one path segment differed, served anyway:`
		);
		for (const m of [...new Set(storeNears)].slice(0, 10)) {
			console.log(`      ${m}`);
		}
	}
	// Split the sandbox's misses by whether the ORACLE missed them too. A URL
	// neither side could find is a gap in the recording; only a URL the sandbox
	// alone asked for is a divergence between them.
	const sharedMisses = storeMisses.filter((m) => {
		const url = m.replace(/^[A-Z]+ /, "");
		return oracle.misses?.has(url);
	});
	const sandboxOnlyMisses = storeMisses.filter(
		(m) => !sharedMisses.includes(m)
	);
	if (sharedMisses.length) {
		console.log(
			`\n  ${sharedMisses.length} miss(es) BOTH sides had -- a gap in the recording, not a divergence:`
		);
		for (const m of sharedMisses.slice(0, 5)) console.log(`      ${m}`);
	}
	if (sandboxOnlyMisses.length) {
		console.log(
			`\n  ${sandboxOnlyMisses.length} store miss(es) the sandbox alone had` +
				` (of ${storeMisses.length}) -- asked for bytes the oracle did not:`
		);
		for (const m of [...new Set(sandboxOnlyMisses)].slice(0, 10)) {
			console.log(`      ${m}`);
		}
	}

	const markers: LeakMarkers = {
		chromeOrigin: `localhost:${SJ_PORT}`,
		proxyPrefix: "/~/sj/",
		shimIdentifiers: DEFAULT_SHIM_IDENTIFIERS,
	};

	// Guest scripts: in the oracle every web-origin script is the page's, because
	// there IS no shim there; in the sandbox they are the rewritten copies
	// served under the proxy prefix. Everything else on the chrome origin --
	// scramjet.js, the controller, the transport, the harness page itself -- is
	// the shim.
	//
	// The oracle's test used to be the TARGET's origin, which quietly excluded
	// every cross-origin subframe. A page's own scripts are not the only guest
	// code on the page: Cloudflare's Turnstile widget is a realm of its own, it
	// builds the `/fo/` payloads, and none of its scripts matched -- so nothing
	// it did could ever be classified guest-direct, and no T0 or T1 divergence
	// could be reported for it. `chrome://` and friends are the browser's own
	// UI and are the only thing that is not the page.
	const diffOptions: DiffOptions = {
		markers,
		oracleAttribution: {
			classes: classifyScripts(
				oracle.trace,
				(u) => !!u && !u.startsWith("chrome") && !u.startsWith("devtools")
			),
		},
		sandboxAttribution: {
			// Under the proxy prefix AND carrying an encoded absolute URL. The
			// prefix alone is not enough: scramjet serves some of its OWN
			// assets through it (`/~/sj/<ctx>/scramjet.wasm.js`), and counting
			// those as guest would attribute shim work to the page.
			//
			// `%3A%2F%2F`, not `http%3A%2F%2F`. The scheme is part of what gets
			// encoded, and "https%3A%2F%2F" does not contain "http%3A%2F%2F" --
			// after "http" comes "s", not "%". So on any HTTPS site not one
			// guest script was ever classified as guest, which silently turned
			// off T0 and T1 entirely: every rateyourmusic run this tool has ever
			// produced reported "0 T0 leak(s)" because no record could reach the
			// tier, not because there was nothing there. The probe pages are
			// served over plain http, which is the only reason the tiering
			// appeared to work at all.
			//
			// Under --self-check the "sandbox" is a second oracle, so it is
			// classified the same way the first one is.
			classes: classifyScripts(
				sandbox.trace,
				selfCheck
					? (u) => !!u && !u.startsWith("chrome") && !u.startsWith("devtools")
					: (u) => u.includes("/~/sj/") && carriesAnAbsoluteUrl(u)
			),
		},
	};
	// What the guest asked scramjet for, from the in-page recorder. Without it
	// the differ compares only the APIs scramjet does NOT intercept -- which is
	// the set it cannot be wrong about.
	const ops = selfCheck || !guestOps ? [] : readGuestOps(sandbox.trace);
	if (!selfCheck && guestOps) {
		const st = guestOpStats(ops);
		const inRealm = st.byRealm.get(sandbox.realm) ?? 0;
		console.log(
			`    guest ops: ${st.total} recorded, ${inRealm} in the compared realm` +
				(st.overlong ? `, ${st.overlong} over-long` : ``) +
				(st.unmapped.size ? `, ${st.unmapped.size} unmapped member(s)` : ``)
		);
		if (!st.total) {
			console.log(
				`               none -- the recorder did not install, so every` +
					` intercepted API is unmeasured in this run`
			);
		}
	}
	diffOptions.sandboxGuestOps = ops;
	const divergences = diff(oracle, sandbox, diffOptions);

	const shimScripts = [...sandbox.trace.scripts.entries()].filter(
		([, u]) => u && !u.includes("/~/sj/")
	).length;
	console.log(
		`    attribution: ${sandbox.trace.scripts.size} script(s) in the sandbox, ${shimScripts} shim`
	);
	// Body divergences join the tiered report rather than sitting beside it.
	//
	// They already decided the exit code -- and appeared nowhere in the tiers,
	// so the summary could say "0 T0 leak(s)" and exit 1 for a reason a reader
	// had to scroll up to find. On the endpoints Cloudflare grades they are T1,
	// because that is the difference between passing and not and it survives
	// replay only because a store cannot grade a request.
	divergences.push(
		...bodyDivergenceRecords({
			divergences: bodyDivergences,
			noise: bodyNoise,
			total: bodyKeys.length,
			oneSided: null,
		})
	);
	const report = bucketize(divergences);

	// What each side ASKED FOR, in order.
	//
	// The one thing replay can still adjudicate after the store has stopped
	// being able to grade a body: whatever answer it gives, the two sides either
	// requested the same things in the same order or they did not. On
	// rateyourmusic they do not, and FINDINGS #232 had to find that by grepping
	// two traces by hand. It fails the run.
	const seqDivergences = sequenceDivergences(
		requestSequence(oracle, diffOptions.oracleAttribution),
		requestSequence(sandbox, diffOptions.sandboxAttribution, ops)
	);
	if (seqDivergences.length) {
		console.log(
			`\n  ${seqDivergences.length} realm(s) where the two sides asked for` +
				` different things, or in a different order -- this fails the run:`
		);
		for (const d of seqDivergences) {
			console.log(`      ${d.realm}`);
			console.log(`          at #${d.at}  oracle : ${d.oracle ?? "--"}`);
			console.log(`                   sandbox: ${d.sandbox ?? "--"}`);
		}
	}

	// What each side THREW.
	//
	// Cloudflare provokes errors on purpose -- three invalid selectors and a
	// cross-origin `pushState` on rateyourmusic -- and reads the wording of the
	// refusal. `exception-divergence` has been a declared finding kind with no
	// producer since the beginning, so none of it was compared.
	//
	// The oracle has no guest ops and needs none: with no shim in front of it,
	// every error it throws comes out of a binding.
	const oracleThrows = thrownErrors(oracle.trace.records, []);
	const sandboxThrows = thrownErrors(sandbox.trace.records, ops);
	const exceptions = diffExceptions(oracleThrows, sandboxThrows, markers);
	console.log("");
	for (const line of formatExceptions(
		oracleThrows,
		sandboxThrows,
		exceptions
	)) {
		console.log(line);
	}

	// Loaded before the realm sweep below, which needs it: an extra-realm
	// finding is keyed by realm AND bucket, so it has to be checked against the
	// same accepted set everything else is.
	let baseline: Set<string> | undefined;
	try {
		baseline = new Set(
			JSON.parse(await readFile(baselineFile(target), "utf8")).buckets
		);
	} catch {
		console.log("  (no baseline; every bucket is reported as new)");
	}
	// Divergences the two sides provably cannot agree on, each with a written
	// cause and a magnitude bound. NOT a baseline -- see structural.ts. Printed
	// in full below, every run, because an exception nobody reads is a baseline.
	const structural = await loadStructural(target);
	// Loaded HERE, beside the baseline, and not further down where it used to
	// sit -- the realm sweep runs between the two and needs it. The noise file
	// is the ONLY writer of `<realm-url>||<bucket>` keys, and the sweep was the
	// only reader that never consulted it, so every realm-scoped entry in it
	// was dead on arrival and its findings re-failed every run.
	//
	// Not loaded under --self-check: subtracting the noise floor from the run
	// that measures it would always report zero.
	let noise: Set<string> | undefined;
	// How far the oracle disagreed with ITSELF in each numeric bucket. A run
	// inside that is noise; a run far outside it is a finding wearing the same
	// bucket key (RULES.md #127).
	let noiseSpreads: Record<string, number> = {};
	if (!selfCheck) {
		try {
			const f = noiseFile(target);
			const parsed = JSON.parse(await readFile(f, "utf8"));
			noise = new Set(parsed.buckets);
			noiseSpreads = parsed.spreads ?? {};
		} catch {
			// Optional. Without it every bucket is attributed to the sandbox,
			// which is the conservative direction.
		}
	}

	// T0 and T1 in ANY realm both sides have, not just the page's.
	//
	// The page realm is 2% of a rateyourmusic run. Cloudflare's fingerprinting
	// happens in the Turnstile widget's realm and in blob workers, and the first
	// time anyone diffed the widget's it turned up six T1 divergences at once --
	// while the gate was reporting a clean run. A gate scoped to the 2% is a
	// gate on the part that was never in question.
	const extraRealmFindings: string[] = [];
	const structuralHits = new Set<string>();
	/** Buckets in the COMPARED realm a structural entry accounts for. */
	const structuralBuckets = new Set<string>();

	/**
	 * `structuralVerdict`, with this file's voice for a bound that was exceeded.
	 *
	 * The rule itself lives in `structural.ts` so the gate and the offline
	 * re-differ share it. A divergence being unfixable is a property of the
	 * divergence and not of which realm happened to notice it, so an entry may
	 * name a bare bucket or a realm-scoped one and the realm-scoped one wins.
	 */
	const coveredByStructural = (
		key: string,
		sample: { oracle: unknown; sandbox: unknown } | undefined,
		realm?: string
	): boolean => {
		const v = structuralVerdict(structural, key, sample, realm);
		if (v.exceeded) {
			console.log(
				`          EXCEEDS its structural bound: ${v.exceeded.spread} > ${v.exceeded.bound}`
			);
		}

		return v.covered;
	};
	if (allRealms) {
		const notes: string[] = [];
		const extra = diffExtraRealms(oracle, sandbox, diffOptions, notes);
		for (const k of notes) console.log(`  --all-realms: ${k}`);
		if (!extra.length) {
			console.log(`\n  --all-realms: no T0 or T1 in any other shared realm.`);
		}
		for (const { url, report: r } of extra) {
			const keys = [...r.buckets.keys()].filter(
				(k) => k.startsWith("T0|") || k.startsWith("T1|")
			);
			console.log(`\n  --all-realms: ${url}`);
			for (const k of keys) {
				const b = r.buckets.get(k)!;
				console.log(`      ${k}  x${b.count}`);
				console.log(`          oracle : ${b.sample.oracle}`);
				console.log(`          sandbox: ${b.sample.sandbox}`);
				// Keyed by realm as well as bucket: the same API diverging in the
				// widget and in the page are two findings, not one, and they have
				// different causes.
				//
				// A structural entry covers this only INSIDE its recorded bound.
				// Without the magnitude check "the heap differs" would license the
				// heap differing by anything, which is the failure the file exists
				// to avoid (RULES #127, in a new place).
				const coveredHere = coveredByStructural(k, b.sample, url);
				// The oracle's own floor counts here too. A bucket the oracle
				// could not reproduce against ITSELF in this realm is not
				// evidence about the sandbox, and `rym.sh noise` has been
				// recording exactly these keys all along.
				const noisyHere = noise?.has(`${url}||${k}`) ?? false;
				if (!baseline?.has(`${url}||${k}`) && !coveredHere && !noisyHere) {
					extraRealmFindings.push(`${url}||${k}`);
				}
				if (coveredHere) structuralHits.add(`${url}||${k}`);
			}
		}
		if (extraRealmFindings.length) {
			console.log(
				`\n  ${extraRealmFindings.length} T0/T1 finding(s) outside the page realm -- this fails the run.`
			);
		}
		if (structuralHits.size) {
			console.log(
				`\n  ${structuralHits.size} of those are structural exceptions, accepted:`
			);
			for (const k of structuralHits) console.log(`      ${k}`);
		}
	}
	// And the compared realm, on the same terms. A T0 is never covered: the
	// file holds divergences the sandbox cannot avoid, and a guest-observable
	// leak is never one of those.
	for (const [k, b] of report.buckets) {
		if (k.startsWith("T0|")) continue;
		if (!coveredByStructural(k, b.sample)) continue;
		structuralHits.add(k);
		structuralBuckets.add(k);
	}

	// In full, every run. An exception nobody reads is a baseline.
	const structuralReport = formatStructural(structural, structuralHits);
	if (structuralReport) console.log(`\n${structuralReport}`);

	if (recordBaseline) {
		// --self-check --baseline writes the NOISE floor instead: what came out
		// of diffing the oracle against itself is, by construction, not a
		// property of the sandbox.
		const out = selfCheck ? noiseFile(target) : baselineFile(target);
		// T2 and below. T0 and T1 are never baselined at all.
		//
		// T1 used to be recordable-but-not-inheritable, which sounded careful
		// and was not: a baseline run accepted every guest-observable value
		// divergence it happened to see, and the next ordinary run reported
		// green. Measured the first time the realm sweep was switched on, that
		// swallowed eleven findings in one go -- cross-origin resource sizes
		// leaking through `PerformanceResourceTiming`, resource timings an order
		// of magnitude apart, the graded request bodies.
		//
		// A T1 IS the work. A baseline is for the shim overhead that will always
		// be there; the noise floor (`noise.<host>.json`, from --self-check) is
		// for what the oracle cannot reproduce against itself. Neither is for a
		// divergence nobody has looked at yet.
		//
		// The NOISE file is the exception and has to be: its whole job is to
		// record what the oracle cannot reproduce against itself, and a T1 the
		// oracle cannot reproduce is the most important thing in it. Filtering
		// T1 out of the noise floor would charge the oracle's own jitter to the
		// sandbox on every run after.
		const keys = [...report.buckets.keys()].filter(
			(k) => !k.startsWith("T0|") && (selfCheck || !k.startsWith("T1|"))
		);
		// And HOW FAR apart the oracle was from itself in each numeric bucket.
		// A key alone cannot tell 0.7 ms of jitter from 171 ms of divergence,
		// and recording only the key suppresses both (RULES.md #127).
		const spreads: Record<string, number> = {};
		for (const d of report.divergences) {
			const spread = numericSpread(d);
			if (spread === undefined) continue;
			spreads[d.bucket] = Math.max(spreads[d.bucket] ?? 0, spread);
		}
		// And how far apart the two runs' request BODIES were, per endpoint.
		// Recorded only by a self-check, because that is the only run whose two
		// sides are the same browser; a sandbox's spread is what is being
		// measured, not the floor.
		const bodySpreads: Record<string, number> = {};
		if (selfCheck) {
			for (const { key, o, s } of allBodyDiffs) {
				const spread = bodySpread(o, s);
				if (spread === undefined) continue;
				const k = spreadKey(key);
				bodySpreads[k] = Math.max(bodySpreads[k] ?? 0, spread);
			}
		}
		// A BASELINE run also unions, and only over T2 and below.
		//
		// One run samples the API surface the page happens to touch, and the
		// shim-attributed buckets are exactly the ones that come and go with
		// it: measured on rateyourmusic, a baseline recorded in one run had
		// `Document.querySelector` and not `querySelectorAll`, `Window.location`
		// and not `Window.top` -- eleven buckets of a shape 800 others in the
		// same file already carry, reported as new because that run did not
		// reach them. A gate that fires on which APIs a page felt like calling
		// is not measuring the sandbox.
		//
		// Neither T0 nor T1 is here to union -- see the filter above; the
		// inherited set is filtered again anyway, so an older file written under
		// the looser rule cannot reintroduce one.
		// A realm-scoped finding, keyed `<realm>||<bucket>`, goes into the NOISE
		// floor on the same terms as anything else and never into the baseline:
		// the realm sweep reports T0 and T1 only, and neither is baselineable.
		let unioned = selfCheck
			? [...keys, ...extraRealmFindings.filter((k) => !k.includes("||T0|"))]
			: keys;
		// What THIS run contributed, before anything is inherited. Printed so a
		// second recording says whether it found anything new or only re-read
		// the file.
		const fresh = unioned.length;
		if (!selfCheck) {
			try {
				const prevFile = JSON.parse(await readFile(out, "utf8"));
				const inherited: string[] = (prevFile.buckets ?? []).filter(
					(k: string) => !k.startsWith("T0|") && !k.startsWith("T1|")
				);
				unioned = [...new Set([...inherited, ...unioned])];
			} catch {
				// First recording.
			}
		}
		if (selfCheck) {
			// Union with what is already there. One run samples the noise; a
			// bucket that happened to be stable this time is still unstable,
			// and leaving it out would charge it to the sandbox next run.
			try {
				const prevFile = JSON.parse(await readFile(out, "utf8"));
				const prev: string[] = prevFile.buckets;
				unioned = [...new Set([...prev, ...unioned])];
				// The widest spread any sampling run saw, for the same reason
				// the keys are unioned: one run only samples the noise.
				for (const [k, v] of Object.entries(prevFile.bodySpreads ?? {})) {
					bodySpreads[k] = Math.max(bodySpreads[k] ?? 0, Number(v));
				}
				for (const [k, v] of Object.entries(prevFile.spreads ?? {})) {
					spreads[k] = Math.max(spreads[k] ?? 0, Number(v));
				}
			} catch {
				// First recording.
			}
		}
		await writeFile(
			out,
			JSON.stringify(
				{ buckets: unioned.sort(), spreads, bodySpreads },
				null,
				"\t"
			)
		);
		console.log(
			`\n  Recorded ${unioned.length} ${selfCheck ? "noise" : "baseline"} bucket(s)` +
				(selfCheck ? ` (${fresh} this run)` : "") +
				` -> ${path.relative(process.cwd(), out)}`
		);
		console.log("  T0 leaks are never baselined; they always fail.");
		printSummary(report.divergences, null, null);
		process.exit(0);
	}

	console.log(formatReport(report, baseline, noise));
	printSummary(report.divergences, baseline ?? null, noise ?? null);

	// A T0 leak always fails, even if the oracle is unstable in that bucket: a
	// guest-observable leak is not something a flaky oracle can invent, because
	// both sides of it come from the SANDBOX trace.
	const newBuckets = [...report.buckets.keys()].filter((k) => {
		if (k.startsWith("T0|")) return true;
		// Named in structural.<host>.json, with a cause, and inside the bound
		// that entry recorded. Printed in full above either way.
		if (structuralBuckets.has(k)) return false;
		if (!baseline?.has(k) && !noise?.has(k)) return true;
		// A request body has already been through a magnitude check, in BYTES,
		// against the per-endpoint floor in `bodySpreads` -- so a bucket that
		// got this far is one the oracle's own spread does not explain.
		// Subtracting it again by NAME would dismiss a 1400-byte divergence
		// because two oracle runs differ by 20 on the same endpoint, which is
		// the one signal in this gate that predicts live behaviour.
		//
		// The general check below cannot do it: `numericSpread` parses the
		// printed value, and a body prints as `<length>:<base36>`.
		if (k.includes("|body:")) return true;
		// In the floor by NAME. It only counts as noise if this run's numbers
		// are also inside the spread the oracle showed itself -- otherwise a
		// thirteenfold divergence hides behind sub-millisecond jitter.
		const sample = report.buckets.get(k)?.sample;

		return sample ? !withinNoiseSpread(sample, noiseSpreads[k]) : false;
	});
	// A request-body divergence fails the run on its own. It is not a bucket --
	// nothing in the API trace produced it -- but it is the strongest evidence
	// the tool collects that the two runs are distinguishable: the page itself
	// described its environment to the server, twice, and gave two answers.
	//
	// The store's three lenienices fail it too, and they did not used to.
	//
	// Every one of them is a place where replay answered a request it could not
	// grade: a near match served the one candidate for a URL the sandbox spelled
	// differently, a past-the-end hit served the last recorded response to a
	// request the recording never saw, and a sandbox-only miss is the sandbox
	// asking for bytes the oracle never wanted. `TOOLS.md` already said all
	// three are "counted and reported so they never pass as clean" -- and then
	// nothing read the count, so they passed as clean. Reported is not gated.
	//
	// Shared misses stay out of it: a URL NEITHER side could find is a gap in
	// the recording, which is a fact about the store rather than about the
	// sandbox.
	const storeLeniencies =
		storePastEnds.length + storeNears.length + sandboxOnlyMisses.length;
	if (storeLeniencies) {
		console.log(
			`\n  ${storeLeniencies} request(s) replay could not grade and answered anyway` +
				` -- this fails the run.`
		);
	}
	// Exceptions and request sequences went straight into the exit code with no
	// suppression consulted at all -- the only two producers that did. They are
	// gated now, but on the NOISE floor and the structural file and NOT on the
	// baseline: every divergence they emit is T1, and a baseline records T2 and
	// below by construction. Suppressing a T1 by baselining it is the one thing
	// none of these files is allowed to do.
	const gatedExceptions = exceptions.divergences.filter((d) => {
		if (noise?.has(d.bucket)) return false;

		return !structuralVerdict(structural, d.bucket, d).covered;
	});
	if (exceptions.divergences.length !== gatedExceptions.length) {
		console.log(
			`\n  ${exceptions.divergences.length - gatedExceptions.length} exception` +
				` divergence(s) are the oracle's own noise or a structural exception.`
		);
	}
	process.exit(
		newBuckets.length ||
			bodyDivergences.length ||
			extraRealmFindings.length ||
			structural.errors.length ||
			seqDivergences.length ||
			gatedExceptions.length ||
			storeLeniencies
			? 1
			: 0
	);
}

function printSummary(
	divergences: Divergence[],
	baseline: Set<string> | null,
	noise: Set<string> | null
) {
	const t0 = divergences.filter((d) => d.tier === "T0").length;
	const fresh = new Set(
		divergences.filter((d) => !baseline?.has(d.bucket)).map((d) => d.bucket)
	);
	// Same exemption as the gate makes: a body bucket is never "the oracle's
	// own noise" by name, because its magnitude check already ran in bytes.
	const unstable = [...fresh].filter(
		(b) => noise?.has(b) && !b.includes("|body:")
	).length;
	console.log(
		`\n  ${divergences.length} divergence(s), ${fresh.size - unstable} bucket(s) not in the baseline` +
			(unstable
				? `, ${unstable} within the oracle's own noise (--self-check)`
				: "") +
			`, ${t0} T0 leak(s).`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(2);
});
