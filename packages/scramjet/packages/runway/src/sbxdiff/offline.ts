/**
 * Re-diff two trace directories. No Chromium, no store, no network.
 *
 *   pnpm sbxoffline                          # .traces/oracle vs .traces/sandbox
 *   pnpm sbxoffline --coverage               # what the diff cannot see
 *   pnpm sbxoffline --all-realms             # every realm the sides share
 *   pnpm sbxoffline --realm challenges       # scope to one
 *   pnpm sbxoffline --oracle <dir> --sandbox <dir>
 *   pnpm sbxoffline --self-check             # treat --sandbox as a 2nd oracle
 *   pnpm sbxoffline --timeline               # when each side reached each realm
 *
 * The run that produced the traces is over; this only re-reads its bytes. So a
 * change to the differ can be measured against a FIXED input, which a live run
 * cannot do -- two live runs differ from each other as well as from the change,
 * and telling those apart was costing two headed browser runs per idea.
 *
 * Gating stays with `index.ts`. This prints; it does not decide.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	bucketize,
	diff,
	formatReport,
	withinNoiseSpread,
	DEFAULT_SHIM_IDENTIFIERS,
	type DiffOptions,
	type LeakMarkers,
	type Side,
} from "./diff.ts";
import { attributionFor, guestUrlPredicate } from "./attribution.ts";
import { coverage, formatCoverage } from "./coverage.ts";
import { loadSide } from "./sides.ts";
import { guestOps, guestOpStats } from "./guestop.ts";
import { diffExtraRealms, formatTimeline, realmTimeline } from "./realms.ts";
import {
	formatSequences,
	requestSequence,
	sequenceDivergences,
} from "./requests.ts";
import {
	diffExceptions,
	formatExceptions,
	thrownErrors,
} from "./exceptions.ts";
import {
	bodyDivergences,
	compareBodies,
	endpointShape,
	loadDumpedBodies,
	splitKey,
} from "./bodydiff.ts";

const HERE = import.meta.dirname;

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
	const i = args.indexOf(name);

	return i >= 0 ? args[i + 1] : fallback;
};
const has = (name: string) => args.includes(name);

const oracleDir = path.resolve(
	flag("--oracle", path.join(HERE, ".traces", "oracle"))!
);
const sandboxDir = path.resolve(
	flag("--sandbox", path.join(HERE, ".traces", "sandbox"))!
);
const selfCheck = has("--self-check");
const realmMatch = flag("--realm");
const target = flag("--url", "https://rateyourmusic.com/")!;
const chromeOrigin = flag("--chrome-origin", "localhost:4500")!;

/**
 * Which realm to compare. The same predicates `index.ts` runs live.
 *
 * They have to BE the same, not merely similar: an offline re-diff that scoped
 * to a different realm than the run it is re-reading would report a difference
 * that is its own.
 *
 * `--realm <substring>` matches the realm URL on both sides, which works
 * because the sandbox's proxied URL still contains the guest URL, encoded.
 */
const oracleGuest = realmMatch
	? (u: string) => u.includes(realmMatch)
	: (u: string) => u.startsWith(target);
const sandboxGuest = realmMatch
	? (u: string) =>
			u.includes(realmMatch) || u.includes(encodeURIComponent(realmMatch))
	: selfCheck
		? (u: string) => u.startsWith(target)
		: (u: string) =>
				u.includes("/~/sj/") && u.includes(encodeURIComponent(target));

const oracle = await loadSide(oracleDir, oracleGuest);
const sandbox = await loadSide(sandboxDir, sandboxGuest);

const pct = (s: { trace: { records: unknown[] }; outside: number }) =>
	Math.round((s.outside / Math.max(1, s.trace.records.length)) * 100);

console.log(
	`\n  oracle : ${oracle.trace.records.length} records, realm r${oracle.realm}`
);
console.log(`           ${oracle.url}`);
console.log(
	`           ${oracle.outside} record(s) outside it (${pct(oracle)}%)`
);
console.log(
	`  sandbox: ${sandbox.trace.records.length} records, realm r${sandbox.realm}`
);
console.log(`           ${sandbox.url}`);
console.log(
	`           ${sandbox.outside} record(s) outside it (${pct(sandbox)}%)`
);

const markers: LeakMarkers = {
	chromeOrigin,
	proxyPrefix: "/~/sj/",
	shimIdentifiers: DEFAULT_SHIM_IDENTIFIERS,
};
// What the guest asked scramjet for. Empty on a self-check, where the
// "sandbox" is a second oracle and there is no scramjet to record.
const ops = selfCheck || has("--no-guestops") ? [] : guestOps(sandbox.trace);
const opStats = guestOpStats(ops);
if (ops.length || !selfCheck) {
	const inRealm = opStats.byRealm.get(sandbox.realm) ?? 0;
	console.log(
		`  guest ops: ${opStats.total} total, ${inRealm} in the compared realm` +
			(opStats.overlong ? `, ${opStats.overlong} over-long` : ``) +
			(opStats.leaks.length ? `, ${opStats.leaks.length} LEAKING` : ``)
	);
	if (!opStats.total) {
		// A recorder that did not install reports as a clean run, which is the
		// failure this layer exists to remove. Say so rather than print zero.
		console.log(
			`             none -- the recorder did not install. Check the sandbox's` +
				` stderr for "sbxdiff-guestop: installed".`
		);
	}
	if (opStats.untraced.size) {
		const worst = [...opStats.untraced].sort((a, b) => b[1] - a[1]).slice(0, 5);
		const n = [...opStats.untraced.values()].reduce((a, b) => a + b, 0);
		console.log(
			`             ${n} on ${opStats.untraced.size} API(s) the binding tracer` +
				` cannot record, excluded: ` +
				worst.map(([m, c]) => `${m} x${c}`).join(", ")
		);
	}
	if (opStats.unmapped.size) {
		const worst = [...opStats.unmapped].sort((a, b) => b[1] - a[1]).slice(0, 8);
		console.log(
			`             ${opStats.unmapped.size} member(s) map to no traced API: ` +
				worst.map(([m, c]) => `${m} x${c}`).join(", ")
		);
	}
}

const opts: DiffOptions = {
	markers,
	oracleAttribution: attributionFor(oracle.trace, "oracle"),
	sandboxAttribution: attributionFor(
		sandbox.trace,
		selfCheck ? "oracle" : "sandbox"
	),
	sandboxGuestOps: ops,
};

if (has("--coverage")) {
	console.log(`\n  -- coverage, compared realm --`);
	console.log(
		formatCoverage(
			coverage(oracle, sandbox, { ...opts, guestOps: ops }),
			Number(flag("--top", "25"))
		)
	);
	console.log(`\n  -- coverage, whole run --`);
	console.log(
		formatCoverage(
			coverage(oracle, sandbox, {
				...opts,
				oracleRealm: null,
				sandboxRealm: null,
				guestOps: ops,
			}),
			Number(flag("--top", "25"))
		)
	);
}

/**
 * The request bodies, offline.
 *
 * Both sides' hashes are printed to Chromium's stderr and `sides.ts` parses
 * them, so this needs no browser either -- which matters, because the body is
 * the most live-predictive thing the harness measures and step 6 of the fixing
 * loop is an offline re-diff. Leaving it out of the offline path would have
 * meant iterating against everything EXCEPT the signal that decides the run.
 */
const noiseSpreads = await loadNoiseSpreads(target);
const dumps = path.join(HERE, ".traces", "bodydiff");
// The dumped BYTES, falling back to whatever the stderr parse found. A trace
// directory keeps the dumps; it does not always keep the log lines.
//
// `notBefore` is the oracle trace directory's own mtime: a dump older than the
// run that produced these traces belongs to a different run, and the flat
// `.sandbox` files were not cleared between runs until recently.
const runStart = await oldestOf(oracleDir);
// The dumps OR the stderr parse, never both merged.
//
// They key the same body differently -- the dumps count repeats of one URL as
// ordinals 0,1,2, and the log lines carry a per-request URL at ordinal 0 -- so
// merging them listed every body twice, once paired and once against nothing.
// The dumps are the better source (bytes, not hashes) and the stderr parse is
// the fallback for a directory that has none.
const pick = (dumped: Map<string, string>, logged: Map<string, string>) =>
	dumped.size ? dumped : logged;
const oracleBodies = pick(
	await loadDumpedBodies(dumps, path.basename(oracleDir), "oracle", runStart),
	oracle.reqBodies
);
const sandboxBodies = pick(
	await loadDumpedBodies(
		dumps,
		path.basename(sandboxDir),
		selfCheck ? "oracle" : "sandbox",
		runStart
	),
	sandbox.reqBodies
);
const bodies = compareBodies(oracleBodies, sandboxBodies, noiseSpreads);
if (bodies.oneSided) {
	console.log(
		`  request bodies: the ${bodies.oneSided} reported none. That is the` +
			` instrument, not the page -- its hashes come from stderr, so check that` +
			` chromium.stderr.log was kept.`
	);
} else if (bodies.divergences.length) {
	console.log(
		`  request bodies: ${bodies.divergences.length} divergence(s) of ${bodies.total}` +
			(bodies.noise ? `, ${bodies.noise} inside the oracle's own spread` : ``)
	);
	for (const { key, o, s } of bodies.divergences.slice(0, 8)) {
		const { url, ordinal } = splitKey(key);
		console.log(
			`      #${ordinal} oracle ${o ?? "(none)"}  sandbox ${s ?? "(none)"}  ${endpointShape(url)}`
		);
	}
} else if (bodies.total) {
	console.log(
		`  request bodies: ${bodies.total} compared, none beyond the oracle's own spread`
	);
}

const baselineSet = has("--no-baseline")
	? undefined
	: await loadBaseline(target);
const { buckets: noiseBuckets, spreads: noiseSpreadsByBucket } =
	await loadNoise(target);

if (!has("--no-diff")) {
	const divergences = diff(oracle, sandbox, opts);
	divergences.push(...bodyDivergences(bodies));
	const report = bucketize(divergences);
	const baseline = baselineSet;
	console.log(`\n${formatReport(report, baseline)}`);
	const t0 = report.divergences.filter((d) => d.tier === "T0").length;
	const fresh = new Set(
		report.divergences
			.filter((d) => !baseline?.has(d.bucket))
			.map((d) => d.bucket)
	);
	// Minus the floor the oracle set against itself, on the same terms the live
	// gate applies: in the noise set by name AND inside the recorded spread, and
	// never for a request body, whose magnitude check already ran in bytes.
	const unstable = [...fresh].filter((k) => {
		if (!noiseBuckets?.has(k) || k.includes("|body:")) return false;
		const sample = report.buckets.get(k)?.sample;

		return sample ? withinNoiseSpread(sample, noiseSpreadsByBucket[k]) : true;
	}).length;
	console.log(
		`  ${report.divergences.length} divergence(s), ${fresh.size - unstable} bucket(s) not in the baseline` +
			(unstable ? `, ${unstable} within the oracle's own noise` : ``) +
			`, ${t0} T0 leak(s).`
	);
	// A baseline entry that suppresses nothing is not harmless. It is a claim
	// about the run that has stopped being true, and a file full of them hides
	// the ones that still matter -- there is no way to tell, reading the file,
	// which is which. Measured on rateyourmusic after the guest-op layer landed:
	// 782 of 838 entries dead, 631 of those the `missing-call` buckets that WERE
	// the blind spot. Printed on every run so it cannot quietly grow again.
	if (baseline) {
		const dead = [...baseline].filter((b) => !report.buckets.has(b));
		if (dead.length) {
			const mc = dead.filter((b) => b.includes("|missing-call|")).length;
			console.log(
				`  ${dead.length} of ${baseline.size} baseline bucket(s) suppress nothing` +
					(mc ? ` (${mc} of them missing-call)` : ``) +
					` -- re-record with \`rym.sh baseline\``
			);
		}
	}
}

// When each side got where, from `realmCreatedUs`. Off by default because it
// answers a different question from the diff: not "do the two agree" but "did
// the sandbox take twenty times as long to get there", which on rateyourmusic
// is the one that matters (FINDINGS #234).
if (has("--timeline")) {
	console.log(`\n  realm timeline -- oracle / sandbox / drift`);
	for (const line of formatTimeline(realmTimeline(oracle, sandbox))) {
		console.log(`    ${line}`);
	}
}

// What each side asked for, in order. Always on: it is cheap, it is the one
// thing replay can still adjudicate once the store has stopped being able to
// grade a body, and it was the finding FINDINGS #232 had to make by hand.
{
	const oReq = requestSequence(oracle, opts.oracleAttribution);
	const sReq = requestSequence(sandbox, opts.sandboxAttribution, ops);
	const seqDiffs = sequenceDivergences(oReq, sReq);
	if (seqDiffs.length) {
		console.log(
			`\n  ${seqDiffs.length} realm(s) where the two sides asked for different` +
				` things, or in a different order:`
		);
		for (const d of seqDiffs) {
			for (const line of formatSequences(d.realm, oReq, sReq, d.at)) {
				console.log(line);
			}
		}
	} else if (oReq.length) {
		console.log(
			`\n  request sequences identical in every shared realm` +
				` (${oReq.length} guest request(s)).`
		);
	}
}

// What each side THREW, compared by text.
//
// Cloudflare provokes errors on purpose and reads the wording of the refusal:
// three invalid selectors and a cross-origin `pushState` on rateyourmusic. The
// tracer has recorded them all along and nothing compared them --
// `exception-divergence` was a declared kind with no producer.
{
	const oThrew = thrownErrors(oracle.trace.records, []);
	const sThrew = thrownErrors(sandbox.trace.records, ops);
	const report = diffExceptions(oThrew, sThrew, markers);
	console.log("");
	for (const line of formatExceptions(oThrew, sThrew, report)) {
		console.log(line);
	}
}

// The realm sweep, on by default -- because the gate is.
//
// 13 of the 16 findings on rateyourmusic are OUTSIDE the page realm, in the
// Turnstile widget and the eight Cloudflare blob workers. An offline re-diff
// that skipped them would report on a fifth of what the gate fails on, which
// is the wrong fifth to iterate against.
if (!has("--no-realms")) {
	const notes: string[] = [];
	const extra = diffExtraRealms(oracle, sandbox, opts, notes);
	for (const k of notes) console.log(`  realms: ${k}`);
	let n = 0;
	for (const { url, report: r } of extra) {
		const keys = [...r.buckets.keys()].filter(
			(k) => k.startsWith("T0|") || k.startsWith("T1|")
		);
		if (!keys.length) continue;
		console.log(`\n  realm ${url}`);
		for (const k of keys) {
			const b = r.buckets.get(k)!;
			const known = baselineSet?.has(`${url}||${k}`) ? "  (baselined)" : "";
			console.log(`      ${k}  x${b.count}${known}`);
			console.log(`          oracle : ${b.sample.oracle}`);
			console.log(`          sandbox: ${b.sample.sandbox}`);
			if (!known) n++;
		}
	}
	console.log(
		`\n  ${n} T0/T1 finding(s) outside the page realm` +
			(n ? ` -- these fail the gate` : ``)
	);
}

/** When the run that wrote this trace directory started, near enough. */
async function oldestOf(dir: string): Promise<number | undefined> {
	const { readdir, stat } = await import("node:fs/promises");
	try {
		const names = await readdir(dir);
		const times = await Promise.all(
			names
				.filter((n) => n.endsWith(".sbxd"))
				.map(async (n) => (await stat(path.join(dir, n))).mtimeMs)
		);

		// A minute of slack: the oracle's traces are flushed when IT exits, and
		// the sandbox posts its bodies after that.
		return times.length ? Math.min(...times) - 60_000 : undefined;
	} catch {
		return undefined;
	}
}

/** What the oracle could not reproduce against itself, and by how much. */
async function loadNoise(t: string): Promise<{
	buckets: Set<string> | undefined;
	spreads: Record<string, number>;
}> {
	try {
		const raw = JSON.parse(
			await readFile(path.join(HERE, `noise.${targetKey(t)}.json`), "utf8")
		);

		return {
			buckets: new Set<string>(raw.buckets),
			spreads: raw.spreads ?? {},
		};
	} catch {
		return { buckets: undefined, spreads: {} };
	}
}

/** The per-endpoint body spread the oracle showed against itself. */
async function loadNoiseSpreads(t: string): Promise<Record<string, number>> {
	try {
		const raw = JSON.parse(
			await readFile(path.join(HERE, `noise.${targetKey(t)}.json`), "utf8")
		);

		return raw.bodySpreads ?? {};
	} catch {
		// Absent is the conservative direction: with no floor recorded, every
		// difference is charged to the sandbox.
		return {};
	}
}

function targetKey(t: string): string {
	const u = new URL(t);
	const rest = u.pathname.replace(/^\/+/, "").replace(/[^a-zA-Z0-9.]+/g, "-");

	return rest ? `${u.hostname}.${rest}` : u.hostname;
}

async function loadBaseline(t: string): Promise<Set<string> | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(path.join(HERE, `baseline.${targetKey(t)}.json`), "utf8")
		);

		return new Set<string>(raw.buckets ?? raw);
	} catch {
		return undefined;
	}
}
