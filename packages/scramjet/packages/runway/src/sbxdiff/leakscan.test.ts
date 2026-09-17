/**
 * The absolute leak scan runs, and catches the two classes alignment cannot.
 *
 * `scanLeaks` was exported, documented as "checked before any alignment and can
 * never be suppressed by a baseline", and called from nowhere. Everything that
 * did run classifies a value only once literal comparison has already FAILED,
 * so a leak reached a tier only if it also diverged and was paired. Two classes
 * fall straight through that, and both are tested here:
 *
 *   - an ARGUMENT, which the argument loop pushes at T2 unconditionally even
 *     when the classifier answers `proxy-url-leak`;
 *   - anything an interceptor WROTE, which `apiSequences` never reads at all,
 *     because it takes `kBindingCall` records only.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/leakscan.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { diff, scanLeaks, type Side } from "./diff.ts";
import { Kind, type Trace } from "./trace.ts";

const str = (s: string) => ({ t: 4, len: s.length, s, truncated: false });

const call = (
	seq: number,
	name: string,
	result: unknown,
	args: unknown[] = []
) =>
	({
		kind: Kind.BindingCall,
		level: 0,
		seq,
		realm: 1,
		task: 0,
		name,
		threw: false,
		topScript: 1,
		entryScript: 1,
		recv: { t: 0 },
		result,
		argcTotal: args.length,
		args,
	}) as never;

const wrote = (seq: number, name: string, written: unknown) =>
	({
		kind: Kind.Interceptor,
		level: 0,
		seq,
		realm: 1,
		task: 0,
		name,
		topScript: 1,
		entryScript: 1,
		keyKind: 0,
		recv: { t: 0 },
		key: str("href"),
		written,
	}) as never;

const side = (records: unknown[]): Side => ({
	trace: {
		file: "t.sbxd",
		version: 1,
		pid: 1,
		runKey: 1,
		realms: new Map([[1, "https://site.example/"]]),
		realmCreatedUs: new Map([[1, 1]]),
		scripts: new Map([[1, "https://site.example/app.js"]]),
		records: records as never,
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

test("a proxy URL passed INTO a native is T0, not T2", () => {
	// Both sides call once, so the sequences are aligned and the pairing is
	// honest -- the only difference is the argument, which is exactly the case
	// the argument loop reports at T2.
	const oracle = side([
		call(1, "Window.fetch", { t: 0 }, [str("https://site.example/a")]),
	]);
	const sandbox = side([
		call(1, "Window.fetch", { t: 0 }, [
			str("/~/sj/cfg/ctx/https://site.example/a"),
		]),
	]);

	const out = diff(oracle, sandbox, opts as never);
	const leaks = out.filter((d) => d.tier === "T0");

	assert.ok(
		leaks.some((d) => d.class === "proxy-url-leak"),
		"the proxy URL in the argument must fail the run, not land in a T2 bucket"
	);
});

test("a proxy URL an interceptor WROTE is seen at all", () => {
	// No binding call on either side, so `apiSequences` produces nothing and
	// every comparison below it has no material to work with. Before the scan
	// was wired this diff was empty.
	const oracle = side([]);
	const sandbox = side([
		wrote(
			1,
			"HTMLAnchorElement.href",
			str("/~/sj/cfg/ctx/https://site.example/b")
		),
	]);

	const out = diff(oracle, sandbox, opts as never);

	assert.ok(
		out.some((d) => d.tier === "T0" && d.class === "proxy-url-leak"),
		"an interceptor's written value is guest-observable and must be scanned"
	);
});

test("a clean run stays clean", () => {
	const oracle = side([
		call(1, "Window.fetch", str("ok"), [str("https://x/")]),
	]);
	const sandbox = side([
		call(1, "Window.fetch", str("ok"), [str("https://x/")]),
	]);

	assert.equal(
		diff(oracle, sandbox, opts as never).filter((d) => d.tier === "T0").length,
		0,
		"the scan must not invent a leak where no marker appears"
	);
});

test("the same leaking string is reported once, not once per record", () => {
	// Called directly: `diff` has a SECOND leak path for calls past the shorter
	// side's count, keyed on `<api>#arg<n>` where the scan keys on `<api>`, so
	// going through it would be counting two mechanisms rather than testing
	// this one's dedupe. The overlap is harmless -- both fail the run, which is
	// the right answer -- but it is not what this asserts.
	const url = "/~/sj/cfg/ctx/https://site.example/c";
	const one = scanLeaks(
		side([call(1, "Window.fetch", { t: 0 }, [str(url)])]),
		opts.markers
	);
	const three = scanLeaks(
		side([
			call(1, "Window.fetch", { t: 0 }, [str(url)]),
			call(2, "Window.fetch", { t: 0 }, [str(url)]),
			call(3, "Window.fetch", { t: 0 }, [str(url)]),
		]),
		opts.markers
	);

	assert.equal(one.length, 1, "one record, one report");
	assert.equal(
		three.length,
		one.length,
		"one phenomenon: the report must not scale with how often the page did it"
	);
});
