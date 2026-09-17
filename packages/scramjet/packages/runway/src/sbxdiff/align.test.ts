/**
 * Calls are paired by position within an API, so one extra call on either side
 * shifts every pairing after it.
 *
 * The "divergences" that follow are two unrelated calls held up next to each
 * other. Measured on rateyourmusic: `Element.tagName.get` reported oracle
 * "BODY" against sandbox "SCRIPT" twenty-seven times, which is not a divergence
 * -- it is the comparison having lost its place. Four of the six T1 buckets
 * there were that, and T1 is a tier the run is judged on.
 *
 * A count mismatch is already reported on its own. What it must not do is lend
 * its drift the authority of T1. A LEAK is the exception and keeps its tier:
 * that classification looks only at the sandbox's own string -- a proxy URL is
 * a proxy URL whoever it was paired against -- so drift cannot invent one.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/align.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { diff, type Side, numericSpread, withinNoiseSpread } from "./diff.ts";
import { Kind, type Trace } from "./trace.ts";

const str = (s: string) => ({ t: 4, len: s.length, s, truncated: false });

const call = (seq: number, name: string, result: unknown) =>
	({
		kind: Kind.BindingCall,
		level: 0,
		seq,
		realm: 1,
		task: 0,
		name,
		threw: false,
		// script 1 is classified "guest" below, so these are guest-direct and
		// eligible for T0/T1 -- without that everything is T2 and the test
		// would pass for the wrong reason.
		topScript: 1,
		entryScript: 1,
		recv: { t: 0 },
		result,
		argcTotal: 0,
		args: [],
	}) as never;

const side = (calls: unknown[]): Side => ({
	trace: {
		file: "t.sbxd",
		version: 1,
		pid: 1,
		runKey: 1,
		realms: new Map([[1, "https://site.example/"]]),
		realmCreatedUs: new Map([[1, 1]]),
		scripts: new Map([[1, "https://site.example/app.js"]]),
		records: calls as never,
		truncatedBytes: 0,
	} satisfies Trace,
	realm: 1,
	url: "https://site.example/",
	reqBodies: new Map(),
});

const opts = {
	markers: {
		chromeOrigin: "http://localhost:4500",
		proxyPrefix: "/~/sj/",
		shimIdentifiers: ["$scramjet"],
	},
	oracleAttribution: { classes: new Map([[1, "guest" as const]]) },
	sandboxAttribution: { classes: new Map([[1, "guest" as const]]) },
};

test("equal-length sequences produce a T1 value divergence", () => {
	const d = diff(
		side([call(1, "Element.tagName.get", str("BODY"))]),
		side([call(1, "Element.tagName.get", str("DIV"))]),
		opts
	);
	const v = d.filter((x) => x.api === "Element.tagName.get");
	assert.equal(v.length, 1);
	assert.equal(v[0].tier, "T1", "a real pair is judged");
});

test("a count mismatch keeps its value divergences out of T1", () => {
	// The sandbox makes one call more, so every pairing after the first is two
	// unrelated calls. The count difference is reported on its own; the values
	// must not be.
	const d = diff(
		side([
			call(1, "Element.tagName.get", str("BODY")),
			call(2, "Element.tagName.get", str("DIV")),
		]),
		side([
			call(1, "Element.tagName.get", str("SCRIPT")),
			call(2, "Element.tagName.get", str("BODY")),
			call(3, "Element.tagName.get", str("DIV")),
		]),
		opts
	);
	const valued = d.filter(
		(x) => x.api === "Element.tagName.get" && x.kind === "value-divergence"
	);
	assert.ok(valued.length > 0, "the drifted pairs are still reported");
	assert.ok(
		valued.every((x) => x.tier === "T2"),
		`drifted pairs must not reach T1, got ${valued.map((x) => x.tier).join(",")}`
	);
	// And the count difference itself is still said out loud.
	assert.ok(
		d.some((x) => x.api === "Element.tagName.get" && x.kind.endsWith("-call"))
	);
});

test("a leak keeps its tier even when the counts drift", () => {
	// The classification looks at the sandbox's own string, not at the pair, so
	// misalignment cannot invent one -- and must not suppress one either.
	const d = diff(
		side([call(1, "Location.href.get", str("https://site.example/a"))]),
		side([
			call(1, "Location.href.get", str("https://site.example/a")),
			call(
				2,
				"Location.href.get",
				str("http://localhost:4500/~/sj/ctx/https%3A%2F%2Fsite.example%2Fb")
			),
		]),
		opts
	);
	assert.ok(
		d.some((x) => x.tier === "T0"),
		"a proxy URL the guest read is a leak however the sequences line up"
	);
});

test("the same values in a different order are not a divergence", () => {
	// Equal LENGTHS are not enough, and that gap reported fourteen divergences
	// that were one offset. Measured on rateyourmusic, in the Turnstile
	// widget's realm, `DOMRect.width.get` -- 17 calls on each side, so
	// "aligned" by length:
	//
	//   oracle   [20, 144, 84.71875, 68, ...]
	//   sandbox  [231.1875 x6, 20, 144, 84.71875, 68, ...]
	//
	// The same numbers, shifted by six, because the shim measured the widget
	// six times before the guest did. Every pairing after that holds one call
	// up against a different call, and it arrived as T1 -- the tier the run is
	// judged on.
	const shared = [20, 144, 84.71875, 68, 806.35, 132.3];
	const early = [231.1875, 231.1875, 231.1875];
	const oracle = side(
		[...shared, ...early].map((v, i) =>
			call(i + 1, "DOMRect.width.get", { t: 3, v })
		)
	);
	const sandbox = side(
		[...early, ...shared].map((v, i) =>
			call(i + 1, "DOMRect.width.get", { t: 3, v })
		)
	);

	const out = diff(oracle, sandbox, opts as never);
	const width = out.filter((d) => d.api === "DOMRect.width.get");
	assert.equal(
		width.filter((d) => d.tier === "T1").length,
		0,
		`reordering must not reach T1: ${JSON.stringify(width.slice(0, 3))}`
	);
	// And it is said ONCE, not once per pairing -- N copies of one fact about
	// the sequence would read as N findings.
	const order = width.filter((d) => d.kind === "order-divergence");
	assert.equal(order.length, 1, JSON.stringify(width.map((d) => d.kind)));
});

test("a genuine value divergence still reaches T1 when order is identical", () => {
	// The guard must not swallow the real thing: same length, same ORDER, one
	// value actually different.
	const oracle = side(
		[31280035, 31280035, 24258196].map((v, i) =>
			call(i + 1, "MemoryInfo.usedJSHeapSize.get", { t: 3, v })
		)
	);
	const sandbox = side(
		[138859726, 138859726, 148427919].map((v, i) =>
			call(i + 1, "MemoryInfo.usedJSHeapSize.get", { t: 3, v })
		)
	);

	const out = diff(oracle, sandbox, opts as never);
	const heap = out.filter(
		(d) => d.api === "MemoryInfo.usedJSHeapSize.get" && d.tier === "T1"
	);
	assert.ok(heap.length > 0, "a real divergence must still be T1");
	assert.equal(
		out.filter((d) => d.kind === "order-divergence").length,
		0,
		"nothing was reordered"
	);
});

test("a numeric bucket in the noise floor still fails when it is far outside it", () => {
	// The bucket key is tier|kind|api|class and carries no magnitude, so the
	// oracle disagreeing with ITSELF by 0.7 ms and the sandbox disagreeing by
	// 171 ms land on the same key. Measured on Cloudflare's widget:
	// PerformanceEntry.duration was 14.29 vs 13.575 oracle-against-oracle and
	// 14.495 vs 185.4 oracle-against-sandbox. Suppressing by name alone hides
	// the second behind the first.
	const d = {
		oracle: "185.4",
		sandbox: "14.495",
		bucket: "T1|value-divergence|PerformanceEntry.duration.get|numeric-delta",
	} as unknown as Parameters<typeof withinNoiseSpread>[0];
	assert.equal(numericSpread(d), 170.905);
	// The oracle's own spread was 0.7 ms; 171 is not that.
	assert.equal(withinNoiseSpread(d, 0.715), false);
});

test("ordinary jitter stays suppressed", () => {
	const d = {
		oracle: "14.29",
		sandbox: "13.575",
	} as unknown as Parameters<typeof withinNoiseSpread>[0];
	// Scaled, because the oracle's own spread varies run to run and demanding a
	// run land under a number sampled once would fail on the very noise the
	// floor exists to tolerate.
	assert.equal(withinNoiseSpread(d, 0.715), true);
	// And an absolute floor, so a recorded spread of 0 does not reject every
	// later run over a rounding difference.
	assert.equal(withinNoiseSpread(d, 0), true);
});

test("a non-numeric divergence is unaffected", () => {
	const d = { oracle: "true", sandbox: "false" } as unknown as Parameters<
		typeof withinNoiseSpread
	>[0];
	assert.equal(numericSpread(d), undefined);
	assert.equal(withinNoiseSpread(d, 0.5), true);
});
