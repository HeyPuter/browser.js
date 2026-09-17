/**
 * Where does a run that PASSES and a run that FAILS first do different things?
 *
 *     node --experimental-strip-types --no-warnings src/sbxdiff/cfdiverge.ts \
 *       --pass <trace-dir> --fail <trace-dir> [--realm <regex>] [--context <n>]
 *
 * The differ answers "do these two runs agree", against a recorded store, with
 * both sides fed the same bytes. It cannot answer this one: measured on
 * rateyourmusic, the store-backed sandbox redeems the challenge and reaches the
 * real page, because a replayed journey carries a recorded verdict and passes
 * whatever the page does. The failure only exists live, where the two sides are
 * answered by Cloudflare separately and legitimately differ in every token, ray
 * and timestamp they are given.
 *
 * So this compares SHAPE, not values. Two live runs cannot agree on a token;
 * they can agree on which calls the challenge made, in what order, with what
 * kinds of argument. The first place that sequence parts company is the first
 * place the two runs actually decided something different -- everything after
 * it is consequence.
 *
 * Scoped to the challenge's own scripts by `entryScript`, which is what makes
 * the comparison legible at all: the sandbox's records are mostly scramjet's
 * shim doing work the oracle has no equivalent of, and including those means
 * the sequences diverge at record one and say nothing.
 *
 * Get the two trace directories from `serve.ts --trace`:
 *
 *     pnpm serve --wisp --url https://rateyourmusic.com/ --open oracle  \
 *       --trace .traces/live-oracle  --click-frame challenges.cloudflare.com \
 *       --click 22,32,8000,10,4000 --grace 60000
 *     pnpm serve --wisp --url https://rateyourmusic.com/ --open sandbox \
 *       --trace .traces/live-sandbox --click-frame challenges.cloudflare.com \
 *       --click 22,32,8000,10,4000 --grace 60000
 */
import path from "node:path";
import { loadTraces, mergeTraces } from "./run.ts";
import { Kind, Tag, type Record_, type Trace, type Value } from "./trace.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);

	return i >= 0 ? args[i + 1] : undefined;
};

const passDir = flag("--pass");
const failDir = flag("--fail");
// The challenge's realms: the interstitial, the Turnstile widget, and the
// widget's blob workers, on either host and proxied or not.
const realmMatch = new RegExp(
	flag("--realm") ??
		"challenges\\.cloudflare\\.com|challenge-platform|turnstile"
);
const context = Number(flag("--context") ?? 12);
if (!passDir || !failDir) {
	console.error(
		"usage: cfdiverge.ts --pass <trace-dir> --fail <trace-dir> [--realm <regex>] [--context <n>]"
	);
	process.exit(2);
}

/**
 * What a value is, without what it happens to be.
 *
 * A string's LENGTH is kept and its contents are not: two live runs are handed
 * different tokens of the same shape, and a length that changes is worth
 * seeing while the bytes never match. Object ids are dropped for the same
 * reason -- they are allocation order, not meaning.
 */
function shape(v: Value | undefined): string {
	if (!v) return "-";
	switch (v.t) {
		case Tag.String:
			return `str:${v.len}`;
		case Tag.Number:
			return "num";
		case Tag.Bool:
			return `bool:${v.v}`;
		case Tag.DomWrapper:
			return `dom:${v.iface}`;
		case Tag.Object:
			return "obj";
		case Tag.Function:
			return "fn";
		case Tag.Proxy:
			return "proxy";
		case Tag.Null:
			return "null";
		case Tag.Undefined:
			return "undef";
		default:
			return "other";
	}
}

/** The comparable identity of one record. */
function key(r: Record_): string {
	if (r.kind === Kind.BindingCall) {
		return `call ${r.name}(${r.args.map(shape).join(",")})${r.threw ? " THREW" : ""}`;
	}
	if (r.kind === Kind.Interceptor) {
		const what = r.written !== undefined ? `=${shape(r.written)}` : "";
		return `intercept ${r.name}${what}`;
	}
	if (r.kind === Kind.NetRequest) {
		// The path without the query: every live token is in the query.
		return `net ${r.method} ${r.url.split("?")[0]}`;
	}
	if (r.kind === Kind.Exception) return "exception";

	return `kind${r.kind}`;
}

/** A record's value, for the lines printed around a divergence. */
function detail(r: Record_): string {
	if (r.kind === Kind.BindingCall) {
		const strs = r.args
			.filter((a) => a.t === Tag.String)
			.map((a) => JSON.stringify((a as { s: string }).s.slice(0, 60)));

		return strs.length ? ` ${strs.join(" ")}` : "";
	}
	if (r.kind === Kind.Interceptor && r.written?.t === Tag.String) {
		return ` ${JSON.stringify(r.written.s.slice(0, 60))}`;
	}
	if (r.kind === Kind.NetRequest) return ` ${r.url.slice(0, 90)}`;

	return "";
}

/**
 * Everything the challenge did, scoped by REALM.
 *
 * Not by script URL. That was the first attempt and it lied: under the proxy
 * the Turnstile widget runs its code from `blob:` URLs, which contain neither
 * `challenge-platform` nor anything else to match on, so every record from the
 * widget was dropped -- and the tool reported that the failing run never
 * rendered the widget's UI when in fact it renders all of it. A filter that
 * silently excludes one side's records reads exactly like a finding.
 *
 * Realm URLs survive proxying: the widget's realm is the rewritten
 * `challenges.cloudflare.com/...` URL, and its blob realms are named after it
 * too.
 */
function challengeRecords(trace: Trace): Record_[] {
	const wanted = new Set<number>();
	for (const [id, url] of trace.realms) {
		if (realmMatch.test(url)) wanted.add(id);
	}
	if (!wanted.size) {
		console.error(
			`  no realm matched ${realmMatch} -- the run may not have reached ` +
				`the challenge`
		);
	}

	return trace.records.filter((r) => "realm" in r && wanted.has(r.realm));
}

const [pass, fail] = await Promise.all(
	[passDir, failDir].map(async (dir) =>
		challengeRecords(mergeTraces(await loadTraces(path.resolve(dir))))
	)
);

console.log(
	`  pass: ${pass.length} record(s) from the challenge's own scripts`
);
console.log(`  fail: ${fail.length} record(s)\n`);

/**
 * The behavioural signature of a run: the things it did that mean something,
 * in order.
 *
 * Not every call. Aligning those failed outright -- 12552 records against
 * 166368 for the same challenge -- because under the proxy the challenge's own
 * script id is also on the stack for every scramjet wrapper it goes through, so
 * the sandbox makes an order of magnitude more calls to do the same work. The
 * sequences part company at record two and say nothing.
 *
 * What survives that asymmetry is what the run put on the page and what it
 * asked the network for. Cloudflare writes its state into the document as text
 * -- "Performing security verification", "Verification successful. Waiting for
 * ...", "Success!" -- so the text stream is the challenge narrating itself.
 */
type Event = { what: string; detail: string };

function signature(rows: Record_[]): Event[] {
	const out: Event[] = [];
	for (const r of rows) {
		const k = key(r);
		if (/textContent|innerText|innerHTML/.test(k)) {
			const text = detail(r).trim().replace(/^"|"$/g, "");
			// Style and markup blobs are feature probes, not state. Kept as a
			// length so a run that writes a different one still shows up.
			if (!text) continue;
			out.push({
				what: "text",
				detail: /^[<@.#]/.test(text) ? `<markup ${text.length}>` : text,
			});
		} else if (r.kind === Kind.NetRequest) {
			out.push({ what: "net", detail: r.url.split("?")[0] });
		} else if (r.kind === Kind.Exception) {
			out.push({ what: "exception", detail: "" });
		}
	}

	return out;
}

/**
 * One challenge attempt.
 *
 * A failing run loops: it is handed a fresh challenge and starts over, three
 * times in the measured run. Comparing all of that against a passing run's one
 * attempt compares a retry against a success.
 *
 * Split on the RAY ID, not on the "Performing security verification" banner.
 * The banner is written twice per attempt on both sides, because `Critical-CH`
 * makes the navigation restart and the first challenge page is thrown away --
 * so slicing on it cuts the passing run off at its own restart and compares a
 * discarded page to a whole attempt. Cloudflare stamps each attempt with its
 * own ray, which is exactly one per attempt.
 */
function firstAttempt(events: Event[]): Event[] {
	const isRay = (e: Event) => e.detail.startsWith("Ray ID:");
	const rays = events.filter(isRay).map((e) => e.detail);
	if (rays.length < 2) return events;
	const second = events.findIndex((e) => isRay(e) && e.detail === rays[1]);

	return second < 0 ? events : events.slice(0, second);
}

const passSig = firstAttempt(signature(pass));
const failSig = firstAttempt(signature(fail));
console.log(
	`  signature: ${passSig.length} event(s) in the passing attempt, ` +
		`${failSig.length} in the failing one\n`
);

/** Longest common subsequence, so an extra event on one side does not shift
 * everything after it into a false divergence. */
function lcs(a: Event[], b: Event[]): boolean[][] {
	const n = a.length;
	const m = b.length;
	const table: number[][] = Array.from({ length: n + 1 }, () =>
		new Array(m + 1).fill(0)
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i][j] =
				a[i].what === b[j].what && a[i].detail === b[j].detail
					? table[i + 1][j + 1] + 1
					: Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}
	const keepA = new Array(n).fill(false);
	const keepB = new Array(m).fill(false);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i].what === b[j].what && a[i].detail === b[j].detail) {
			keepA[i] = true;
			keepB[j] = true;
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) i++;
		else j++;
	}

	return [keepA, keepB];
}

const [keepPass, keepFail] = lcs(passSig, failSig);

console.log("  === only the PASSING run did these");
let shown = 0;
for (let i = 0; i < passSig.length; i++) {
	if (keepPass[i]) continue;
	console.log(`   #${i} ${passSig[i].what} ${passSig[i].detail.slice(0, 96)}`);
	if (++shown >= 40) break;
}
console.log("\n  === only the FAILING run did these");
shown = 0;
for (let j = 0; j < failSig.length; j++) {
	if (keepFail[j]) continue;
	console.log(`   #${j} ${failSig[j].what} ${failSig[j].detail.slice(0, 96)}`);
	if (++shown >= 40) break;
}
