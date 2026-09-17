/**
 * The run reads its results out of Chromium's stderr, so the flag that puts
 * them there is not optional.
 *
 * The oracle's request-body hashes are `LOG(WARNING)` lines from the replay
 * loader; the sandbox's per-request log is `console.info` from the store
 * transport. Neither reaches stderr without `--enable-logging=stderr`. It used
 * to be behind SBXDIFF_VERBOSE, and the failure that caused is the reason this
 * file exists: a run without that variable saw no oracle bodies at all, so
 * every request the sandbox made came out as "oracle (none sent)" -- seven
 * divergences reported by an instrument that was simply switched off.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/runargs.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { baseArgs } from "./run.ts";

const opts = {
	url: "http://localhost:4510/probe.html",
	traceDir: "/tmp/sbxdiff-test",
	runKey: 1,
};

test("stderr logging is on whether or not SBXDIFF_VERBOSE is set", () => {
	const was = process.env.SBXDIFF_VERBOSE;
	try {
		delete process.env.SBXDIFF_VERBOSE;
		const quiet = baseArgs(opts as never, "/tmp/sbxdiff-profile");
		assert.ok(
			quiet.includes("--enable-logging=stderr"),
			"the oracle's body hashes are stderr WARNING lines; without this the " +
				"run reports every request as 'oracle (none sent)'"
		);
		// The firehose stays optional: every URLRequest and every virtual-time
		// pauser, which is for reading by hand, not for the report.
		assert.ok(!quiet.includes("--v=1"));

		process.env.SBXDIFF_VERBOSE = "1";
		const loud = baseArgs(opts as never, "/tmp/sbxdiff-profile");
		assert.ok(loud.includes("--enable-logging=stderr"));
		assert.ok(loud.includes("--v=1"));
	} finally {
		if (was === undefined) delete process.env.SBXDIFF_VERBOSE;
		else process.env.SBXDIFF_VERBOSE = was;
	}
});

test("the side without virtual time still gets a clock origin", () => {
	// A sandbox cannot have virtual time (RULES.md #59), which left it on the
	// real wall clock while the oracle ran from a pinned origin. That is
	// guest-readable: Cloudflare's JS detections compare the challenge's issue
	// time from `__CF$cv$params.t` against `Date.now()`, so a recorded
	// challenge replayed hours later looks stale and the script stops without
	// an error. Measured, that cost the whole jsd chain -- the sandbox made
	// five XHR POSTs where the oracle made six, and posted nothing to
	// `jsd/oneshot`. With the origin shared it makes six.
	const offset = baseArgs(
		{ ...opts, timeOriginMs: 1789253391373 } as never,
		"/tmp/sbxdiff-profile"
	);
	assert.ok(offset.includes("--sbxdiff-time-offset=1789253391373"));
	// And it is NOT virtual time: the two switches are different mechanisms
	// and asking for one must not turn on the other.
	assert.ok(!offset.some((a) => a.startsWith("--sbxdiff-initial-time")));

	const virtual = baseArgs(
		{ ...opts, initialTimeMs: 1789253391373 } as never,
		"/tmp/sbxdiff-profile"
	);
	assert.ok(virtual.includes("--sbxdiff-initial-time=1789253391373"));
	assert.ok(!virtual.some((a) => a.startsWith("--sbxdiff-time-offset")));
});

test("the URL stays last", () => {
	// Chromium takes the positional URL as the page to open; a flag appended
	// after it is read as a second URL and opens a second tab. The logging
	// flags were originally spliced in before the last element for exactly
	// this reason, so a test that only checked "includes" would not have
	// noticed them moving to the end.
	const args = baseArgs(opts as never, "/tmp/sbxdiff-profile");
	assert.equal(args.at(-1), opts.url);
});

test("the virtual-time policy reaches Chromium verbatim", () => {
	// The two sides need OPPOSITE policies on a service-worker-backed sandbox.
	// kDeterministicLoading pauses the clock while a load is outstanding, and a
	// sandbox's loads are served by a worker whose transport needs timers to
	// progress -- so neither side ever moves. Measured: the run never finished
	// within 240 s and the guest iframe sat on Express's 404 body, meaning the
	// service worker never intercepted the navigation at all. A policy that
	// silently fell back to the default would reintroduce that hang, and it
	// would look like a sandbox bug rather than a harness one.
	for (const policy of ["deterministic", "advance", "pause"] as const) {
		const args = baseArgs(
			{
				...opts,
				initialTimeMs: 1789254313000,
				virtualTimePolicy: policy,
			} as never,
			"/tmp/sbxdiff-profile"
		);
		assert.ok(
			args.includes(`--sbxdiff-virtual-time-policy=${policy}`),
			`${policy} did not reach the command line: ${args.join(" ")}`
		);
	}
});

test("virtual-time switches appear only when virtual time is on", () => {
	// --sbxdiff-initial-time is what ENABLES virtual time. Passing a policy or a
	// budget without it is a silent no-op, and the run reads as "virtual time
	// did nothing" rather than "virtual time was never on".
	const off = baseArgs(
		{ ...opts, timeOriginMs: 1789254313000 } as never,
		"/tmp/sbxdiff-profile"
	);
	assert.ok(
		!off.some((a) => a.startsWith("--sbxdiff-initial-time")),
		off.join(" ")
	);
	assert.ok(
		!off.some((a) => a.startsWith("--sbxdiff-virtual-time-policy")),
		off.join(" ")
	);
	// ...but the side without virtual time still gets the same clock ORIGIN.
	assert.ok(off.includes("--sbxdiff-time-offset=1789254313000"), off.join(" "));
});

test("the viewport strip is off unless a directory was asked for", () => {
	// The switch has been in the binary since patch 0011 and nothing passed it,
	// so "off by default" is the state this is pinning against a regression in
	// the other direction: a capture every second over a 276-second run is 276
	// PNGs a side, and it is diagnostic rather than part of the gate.
	const off = baseArgs(opts as never, "/tmp/sbxdiff-profile");
	assert.ok(!off.some((a) => a.startsWith("--sbxdiff-shots")), off.join(" "));

	const on = baseArgs(
		{ ...opts, shotsDir: "/tmp/shots", shotsIntervalMs: 1000 } as never,
		"/tmp/sbxdiff-profile"
	);
	assert.ok(on.includes("--sbxdiff-shots=/tmp/shots,1000"), on.join(" "));

	// The interval is the binary's own default when unstated, spelled out
	// rather than left off: `--sbxdiff-shots=<dir>` alone is legal and means
	// 2000, and a reader of the command line should not have to know that.
	const dflt = baseArgs(
		{ ...opts, shotsDir: "/tmp/shots" } as never,
		"/tmp/sbxdiff-profile"
	);
	assert.ok(dflt.includes("--sbxdiff-shots=/tmp/shots,2000"), dflt.join(" "));
});
