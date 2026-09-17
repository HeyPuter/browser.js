/**
 * The three request-body hashes have to agree, or the comparison they exist for
 * silently stops meaning anything.
 *
 * sbxdiff's strongest check is oracle-vs-sandbox on the bytes a page POSTs
 * about itself -- Cloudflare's challenge payload is a fingerprint of the whole
 * environment, so it catches divergences no API-call trace reaches. But the
 * oracle builds its bodies in C++ inside the network service and the sandbox
 * builds its own in the guest's JavaScript. There is no object the two can
 * share, only a string both derive independently, so the same FNV-1a lives in
 * three places:
 *
 *   - `base::sbxdiff::BodyHash`  -- base/sbxdiff_body_hash.h   (the oracle)
 *   - `SbxdiffTransport.hash`    -- sbxdiff-transport.js       (the sandbox)
 *   - `bodyHash`                 -- sbxdiff/store.ts           (the harness)
 *
 * Drift in any one of them makes every request look divergent, or none --
 * both of which read as a result rather than as a broken instrument. So this
 * runs all three against one set of golden vectors, including the REAL C++,
 * compiled here: the header has no dependencies beyond the standard library
 * precisely so that costs a second rather than a Chromium build.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/bodyhash.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { bodyHash, reqBodyKey } from "./store.ts";

const HERE = import.meta.dirname;
const CHROMIUM_SRC = path.resolve(HERE, "../../../../../../../src");
const HEADER = path.join(CHROMIUM_SRC, "base", "sbxdiff_body_hash.h");
const TRANSPORT = path.resolve(
	HERE,
	"../harness/scramjet/public/sbxdiff-transport.js"
);

/**
 * The C++ half needs a Chromium checkout beside this repo and a compiler.
 * Neither exists in CI, and a cross-language check that fails when it cannot
 * RUN says nothing about whether the two implementations agree -- it just goes
 * red for everyone who has not built the browser. Skipped, with the reason, so
 * the JS-only assertions below still gate.
 */
const NO_CXX = existsSync(HEADER)
	? undefined
	: `no Chromium checkout at ${CHROMIUM_SRC}`;

/**
 * Chosen to pin the parts that are easy to get subtly wrong in one language and
 * not another: the empty body (does the length prefix survive?), a byte above
 * 0x7f (sign extension in C++, UTF-8 re-encoding in JS), NUL (string
 * termination), and a payload shaped like the real thing.
 */
const VECTORS: [string, number[]][] = [
	["empty", []],
	["one zero byte", [0]],
	["ascii", [...Buffer.from("hello")]],
	["high bit set", [0x80, 0xff, 0x7f]],
	["embedded NUL", [...Buffer.from("a\0b")]],
	["cf-shaped", [...Buffer.from("RiE6FK+0xMKj-dIZm-YjsmXSUeMxJbVc$oo")]],
	["long", Array.from({ length: 4096 }, (_, i) => (i * 31) % 256)],
];

/** The transport is a plain browser script; run it and take what it exports. */
function loadTransport() {
	const ctx: { window?: { SbxdiffTransport?: unknown } } = {};
	ctx.window = ctx as never;
	createContext(ctx);
	runInContext(readFileSync(TRANSPORT, "utf8"), ctx);
	const T = ctx.window!.SbxdiffTransport as {
		hash(b: Uint8Array): string;
	};
	assert.ok(T, "sbxdiff-transport.js did not define window.SbxdiffTransport");

	return T;
}

/** Compiles the real header and hashes each vector with it. */
function cppHashes(vectors: number[][]): string[] {
	const dir = mkdtempSync(path.join(tmpdir(), "sbxdiff-bodyhash-"));
	const src = path.join(dir, "main.cc");
	const bin = path.join(dir, "main");
	const literals = vectors
		.map(
			(v) =>
				`std::string({${v.map((b) => `static_cast<char>(${b})`).join(",")}})`
		)
		.join(",\n    ");
	writeFileSync(
		src,
		`#include "base/sbxdiff_body_hash.h"\n` +
			`#include <cstdio>\n#include <vector>\n` +
			`int main() {\n  std::vector<std::string> v = {\n    ${literals}\n  };\n` +
			`  for (const auto& b : v) printf("%s\\n", base::sbxdiff::BodyHash(b).c_str());\n` +
			`  return 0;\n}\n`
	);
	execFileSync("c++", ["-std=c++20", "-I", CHROMIUM_SRC, "-o", bin, src]);

	return execFileSync(bin, { encoding: "utf8" }).trim().split("\n");
}

test("all three implementations agree", { skip: NO_CXX }, () => {
	assert.ok(
		readFileSync(HEADER, "utf8").includes("BodyHash"),
		`expected the C++ implementation at ${HEADER}`
	);
	const transport = loadTransport();
	const cpp = cppHashes(VECTORS.map(([, bytes]) => bytes));

	VECTORS.forEach(([name, bytes], i) => {
		const buf = Uint8Array.from(bytes);
		const expected = bodyHash(buf);
		assert.equal(transport.hash(buf), expected, `${name}: transport (js)`);
		assert.equal(cpp[i], expected, `${name}: oracle (c++)`);
	});
});

test("the hash separates length from content", () => {
	// The format is load-bearing: the run summary prints these, and reading
	// "88642 vs 90007" is how a divergence gets sized before it gets diagnosed.
	assert.match(bodyHash(Uint8Array.from([1, 2, 3])), /^3:[0-9a-z]+$/);
	assert.equal(bodyHash(new Uint8Array()).split(":")[0], "0");
	// Same length, different bytes, must not collide.
	assert.notEqual(
		bodyHash(Uint8Array.from([1, 2, 3])),
		bodyHash(Uint8Array.from([3, 2, 1]))
	);
});

test("reqBodyKey distinguishes repeat posts to one URL", () => {
	// The challenge POSTs to the SAME /fo/ endpoint three times with a
	// different payload each time. Keying on URL alone collapses the three
	// rounds onto one and compares round 1 against round 3.
	const url =
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/fo/x";
	assert.notEqual(reqBodyKey(url, 0), reqBodyKey(url, 1));
	// The harness splits the key back apart with /#(\d+)$/; a URL that itself
	// contains a fragment-looking tail must still round-trip.
	const tricky = `${url}#notanordinal`;
	const [parsedUrl, ord] = reqBodyKey(tricky, 2).split(/#(\d+)$/);
	assert.equal(parsedUrl, tricky);
	assert.equal(ord, "2");
});
