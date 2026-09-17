/**
 * The differ scopes to ONE realm per side, so picking the wrong one does not
 * produce a wrong divergence -- it produces a whole run of them, with the
 * authority of a tier the run is judged on.
 *
 * The rule is "the document the run ENDED on", because one URL can host several
 * documents in sequence: rateyourmusic serves a 403 challenge, that challenge
 * again, and finally the real page, all at https://rateyourmusic.com/. Picking
 * the busiest instead held a challenge page up against a real one.
 *
 * "Latest" needs a clock comparable across trace FILES, and `seq` is not one --
 * it counts records within a single file, so two realms in two files both begin
 * at 1. Measured: the oracle's two realms at that URL live in file 1 and file
 * 16, both reporting firstSeq=1, so the comparison fell through to its
 * tie-break and picked the busiest after all. Realm records carry a creation
 * time (trace format v4) for exactly this.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/realm.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	carriesAnAbsoluteUrl,
	classifyScripts,
	selectGuestRealm,
} from "./diff.ts";
import { Kind, type Trace } from "./trace.ts";

const rec = (seq: number, realm: number) =>
	({
		kind: Kind.BindingCall,
		level: 0,
		seq,
		realm,
		topScript: 0,
		entryScript: 0,
		name: "Node.nodeType.get",
		args: [],
		result: { t: 0 },
	}) as unknown as Trace["records"][number];

function trace(
	realms: [number, string][],
	created: [number, number][],
	counts: [number, number][],
	firstSeqs: Record<number, number> = {}
): Trace {
	const records: Trace["records"] = [];
	for (const [realm, n] of counts) {
		const start = firstSeqs[realm] ?? 1;
		for (let i = 0; i < n; i++) records.push(rec(start + i, realm));
	}
	return {
		file: "t",
		version: created.length ? 4 : 3,
		pid: 1,
		runKey: 1,
		realms: new Map(realms),
		realmCreatedUs: new Map(created),
		scripts: new Map(),
		records,
		truncatedBytes: 0,
	} as Trace;
}

const RYM = "https://rateyourmusic.com/";
const here = (u: string) => u === RYM;

test("picks the document the run ended on, across trace files", () => {
	// The real case: two realms at one URL, in different files, both firstSeq=1.
	// The challenge came first and is smaller; the real page came later and is
	// busier. Only the creation time distinguishes them honestly.
	const t = trace(
		[
			[1, RYM],
			[2, RYM],
		],
		[
			[1, 1_000_000],
			[2, 9_000_000],
		],
		[
			[1, 2106],
			[2, 7465],
		],
		{ 1: 1, 2: 1 }
	);
	assert.deepEqual(selectGuestRealm(t, here), { realm: 2, url: RYM });
});

test("the later document wins even when it is the QUIETER one", () => {
	// This is the case seq cannot get right and "busiest" gets backwards. A
	// challenge page that ran a lot of script, then the real page, cut short by
	// the grace period. Picking the busy one compares a challenge against a
	// real page and every value after that is noise.
	const t = trace(
		[
			[1, RYM],
			[2, RYM],
		],
		[
			[1, 1_000_000],
			[2, 9_000_000],
		],
		[
			[1, 8000],
			[2, 120],
		],
		{ 1: 1, 2: 1 }
	);
	assert.deepEqual(selectGuestRealm(t, here), { realm: 2, url: RYM });
});

test("an empty realm is never picked, however late it is", () => {
	// A document that never ran. Picking it trades one wrong answer for an
	// empty one, which reads as "the sandbox did nothing".
	const t = trace(
		[
			[1, RYM],
			[2, RYM],
		],
		[
			[1, 1_000_000],
			[2, 9_000_000],
		],
		[[1, 300]]
	);
	assert.deepEqual(selectGuestRealm(t, here), { realm: 1, url: RYM });
});

test("realms that do not match the hint are ignored", () => {
	const t = trace(
		[
			[1, RYM],
			[2, "https://challenges.cloudflare.com/x"],
		],
		[
			[1, 1_000_000],
			[2, 9_000_000],
		],
		[
			[1, 10],
			[2, 9999],
		]
	);
	assert.deepEqual(selectGuestRealm(t, here), { realm: 1, url: RYM });
});

test("a v3 trace still works, falling back to seq", () => {
	// No creation times. Within ONE file seq is a real ordering, so the old
	// rule is correct there and must keep working.
	const t = trace(
		[
			[1, RYM],
			[2, RYM],
		],
		[],
		[
			[1, 500],
			[2, 500],
		],
		{ 1: 1, 2: 900 }
	);
	assert.deepEqual(selectGuestRealm(t, here), { realm: 2, url: RYM });
});

test("no matching realm is null, not a guess", () => {
	const t = trace([[1, "https://example.com/"]], [[1, 1]], [[1, 5]]);
	assert.equal(selectGuestRealm(t, here), null);
});

test("a proxied blob: URL is the guest's, not the shim's", () => {
	// Cloudflare runs its detections in blob realms -- 35021 records a side on
	// rateyourmusic, including a 5000-iteration SubtleCrypto benchmark -- and
	// the proxy rewrites a Blob URL to `/~/sj/<ctx>/blob:https://host/uuid`
	// with the inner URL NOT percent-encoded. The old test was `%3A%2F%2F`
	// alone, so every one of those scripts was classified as the shim's and
	// dropped, and the differ reported "sandbox: 0 calls" against the oracle's
	// 5000 -- which reads like a missing call rather than a blind spot.
	assert.equal(
		carriesAnAbsoluteUrl(
			"http://localhost:4500/~/sj/l105dq1z/cm0euskr/blob:https://challenges.cloudflare.com/9a1adbed"
		),
		true
	);
});

test("a percent-encoded guest URL still counts", () => {
	assert.equal(
		carriesAnAbsoluteUrl(
			"http://localhost:4500/~/sj/l105dq1z/cm0euskr/https%3A%2F%2Frateyourmusic.com%2F"
		),
		true
	);
});

test("the shim's own assets under the prefix do not", () => {
	// The prefix alone is not enough: scramjet serves scramjet.wasm.js through
	// it, and counting that as guest would attribute shim work to the page.
	assert.equal(
		carriesAnAbsoluteUrl(
			"http://localhost:4500/~/sj/l105dq1z/scramjet.wasm.js"
		),
		false
	);
	assert.equal(
		carriesAnAbsoluteUrl("http://localhost:4500/scramjet/scramjet.js"),
		false
	);
});

test("a worker's blob script is classified by the realm it ran in", () => {
	// Under a proxy a Blob worker's own URL is `blob:<proxy-origin>/<uuid>` and
	// carries no guest identity: the oracle's says
	// blob:https://challenges.cloudflare.com/... and the sandbox's says
	// blob:http://localhost:4500/... for the very same worker. 35013 records --
	// Cloudflare's whole detection worker -- were classified as the shim's
	// because there was nothing in the URL to classify them by.
	const isGuest = (u: string) =>
		u.includes("/~/sj/") && carriesAnAbsoluteUrl(u);
	const trace = {
		scripts: new Map([[7, "blob:http://localhost:4500/9a1adbed"]]),
		realms: new Map([
			[
				100,
				"http://localhost:4500/~/sj/ctx/a/blob:https://challenges.cloudflare.com/9a1adbed",
			],
		]),
		records: [{ realm: 100, topScript: 7, name: "x" }],
	} as unknown as Trace;
	assert.equal(classifyScripts(trace, isGuest).get(7), "guest");
});

test("a blob script whose realms disagree keeps what its own URL said", () => {
	// Not upgraded to guest: an upgrade needs evidence, and realms that
	// disagree are not evidence. For a proxy blob its own URL says shim.
	const isGuest = (u: string) =>
		u.includes("/~/sj/") && carriesAnAbsoluteUrl(u);
	const trace = {
		scripts: new Map([[7, "blob:http://localhost:4500/9a1adbed"]]),
		realms: new Map([
			[
				100,
				"http://localhost:4500/~/sj/ctx/a/blob:https://challenges.cloudflare.com/x",
			],
			[101, "http://localhost:4500/scramjet/worker.js"],
		]),
		records: [
			{ realm: 100, topScript: 7, name: "x" },
			{ realm: 101, topScript: 7, name: "y" },
		],
	} as unknown as Trace;
	assert.equal(classifyScripts(trace, isGuest).get(7), "shim");
});
