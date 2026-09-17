/**
 * The exception differ.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/exceptions.test.ts
 *
 * The property that matters most is the one in `shapeOf`'s comment: pairing
 * normalises the quoted parts of a message, and the leak it exists to catch
 * lives in exactly those quoted parts. So the pairing must be loose enough to
 * put the oracle's message and the sandbox's on the same key, and the reporting
 * must still be strict enough to show that they differ. Those pull in opposite
 * directions and a test is the only thing that keeps both.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	diffExceptions,
	leakInMessage,
	shapeOf,
	stripBindingContext,
	thrownErrors,
	type ThrownError,
} from "./exceptions.ts";
import { Kind, type Record_ } from "./trace.ts";
import { DEFAULT_SHIM_IDENTIFIERS, type LeakMarkers } from "./diff.ts";

const markers: LeakMarkers = {
	chromeOrigin: "localhost:4500",
	proxyPrefix: "/~/sj/",
	shimIdentifiers: DEFAULT_SHIM_IDENTIFIERS,
};

const threw = (message: string, source: "binding" | "shim" = "binding") =>
	({ source, name: "SecurityError", message }) as ThrownError;

test("a message differing only inside its quotes still pairs", () => {
	// Chrome's wording for a cross-origin pushState, as the two sides produce
	// it. Same error, same sentence, different values -- which is the case the
	// whole design turns on.
	const o =
		"A history state object with URL 'https://example.org/' cannot be created" +
		" in a document with origin 'https://challenges.cloudflare.com'.";
	const s =
		"A history state object with URL 'https://example.org/' cannot be created" +
		" in a document with origin 'http://localhost:4500'.";
	assert.equal(shapeOf(o), shapeOf(s), "must land on one pairing key");

	const report = diffExceptions([threw(o)], [threw(s)], markers);
	// Paired, so this is NOT reported as one side throwing and the other not.
	const kinds = report.divergences.map((d) => d.kind);
	assert.ok(
		!kinds.includes("exception-divergence") ||
			!report.divergences.some((d) => d.sandbox === "never threw"),
		"a paired message must not be reported as absent"
	);
	// But the difference inside the quotes is still reported, as a leak.
	const leak = report.divergences.find((d) => d.tier === "T0");
	assert.ok(leak, "the proxy origin in the text is a T0 leak");
	assert.equal(leak.class, "chrome-origin-leak");
});

test("an error the oracle throws and the sandbox does not is reported", () => {
	const report = diffExceptions(
		[threw("'x' is not a valid selector.")],
		[],
		markers
	);
	const d = report.divergences.find((x) => x.kind === "exception-divergence");
	assert.ok(d);
	assert.equal(d.sandbox, "never threw");
	assert.equal(d.tier, "T1");
	// The literal text goes in the report: a shape with its quotes blanked does
	// not say which selector, and there are three of them in a real run.
	assert.match(d.oracle ?? "", /is not a valid selector/);
});

test("counts are compared once the messages pair", () => {
	const m = "'x' is not a valid selector.";
	const report = diffExceptions(
		[threw(m), threw(m), threw(m)],
		[threw(m)],
		markers
	);
	const d = report.divergences.find((x) => x.bucket.endsWith("|count"));
	assert.ok(d, "3 against 1 is a divergence");
	assert.equal(d.oracle, "threw 3x");
	assert.equal(d.sandbox, "threw 1x");
});

test("identical errors on both sides report nothing", () => {
	const m = "'x' is not a valid selector.";
	const report = diffExceptions([threw(m)], [threw(m)], markers);
	assert.deepEqual(report.divergences, []);
});

test("a shim identifier in the text is a leak wherever it appears", () => {
	assert.equal(
		leakInMessage("Failed to read the '$scramjet__eval' property", markers),
		"$scramjet"
	);
	assert.equal(
		leakInMessage("Failed to read the 'eval' property", markers),
		null
	);
	// The proxy path prefix counts too: a rewritten URL in an error names the
	// sandbox just as surely as an identifier does.
	assert.equal(
		leakInMessage("cannot load /~/sj/abc/https%3A%2F%2Fx", markers),
		"/~/sj/"
	);
});

test("both roads are read, and a shim throw is tagged as one", () => {
	const records: Record_[] = [
		{ kind: Kind.Exception, seq: 1, task: 0, code: 12, message: "from blink" },
	];
	const ops = [
		{
			n: 1,
			realm: 1,
			op: "throw",
			member: "Error.SecurityError",
			api: null,
			result: { t: "undefined" as const },
			threw: true,
			args: [
				{ t: "string" as const, s: "from scramjet", len: 13, truncated: false },
			],
			leak: null,
			overlong: false,
			untraced: false,
		},
	];
	const out = thrownErrors(records, ops);
	assert.equal(out.length, 2);
	assert.deepEqual(
		out.map((e) => [e.source, e.message]),
		[
			["binding", "from blink"],
			["shim", "from scramjet"],
		]
	);
	// The name is carried so a report can say which error it was.
	assert.equal(out[1].name, "SecurityError");
});

test("the two layers record at different points and must still pair", () => {
	// The oracle's `kException` is taken in `ExceptionState::SetExceptionInfo`,
	// before `DOMException::AddContextToMessages` decorates it. scramjet builds
	// the finished message. Unstripped, these two pair with nothing and the
	// differ reports a scramjet bug that does not exist -- which is what it did
	// on its first real run.
	const detail =
		"A history state object with URL 'https://example.org/' cannot be created" +
		" in a document with origin 'https://challenges.cloudflare.com'.";
	const fromBinding = detail;
	const fromShim = `Failed to execute 'pushState' on 'History': ${detail}`;

	assert.equal(stripBindingContext(fromShim), detail);
	assert.equal(shapeOf(fromBinding), shapeOf(fromShim));

	const report = diffExceptions(
		[{ source: "binding", name: "", message: fromBinding }],
		[{ source: "shim", name: "SecurityError", message: fromShim }],
		markers
	);
	assert.deepEqual(
		report.divergences,
		[],
		"same error, recorded either side of Blink's decoration, is not a divergence"
	);
});

test("stripping the prefix does not hide a difference in the detail", () => {
	const shim =
		"Failed to execute 'pushState' on 'History': A history state object with" +
		" URL 'https://example.org/' cannot be created in a document with origin" +
		" 'http://localhost:4500'.";
	const binding =
		"A history state object with URL 'https://example.org/' cannot be created" +
		" in a document with origin 'https://challenges.cloudflare.com'.";
	const report = diffExceptions(
		[{ source: "binding", name: "", message: binding }],
		[{ source: "shim", name: "SecurityError", message: shim }],
		markers
	);
	const leak = report.divergences.find((d) => d.tier === "T0");
	assert.ok(
		leak,
		"the proxy origin is still found in the stripped-for-pairing text"
	);
	assert.equal(leak.class, "chrome-origin-leak");
});
