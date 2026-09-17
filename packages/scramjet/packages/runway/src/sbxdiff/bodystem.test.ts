/**
 * The oracle's request bodies and the sandbox's have to land under the SAME
 * filename, or a byte-diff pairs nothing.
 *
 * A hash says two bodies differ. It cannot say how, and "1067 bytes more than
 * the other side" on a Cloudflare payload is not a question a hash can answer
 * -- so both sides also write their bytes out, keyed by url and ordinal. The
 * oracle writes from C++ inside the network service (`BodyFileStem` in
 * `chrome/browser/headless/sbxdiff_net_replay.cc`); the sandbox's come through
 * the store's beacon and are written by `bodyFileStem` here. Two
 * implementations of one derivation, in two languages, that no build checks.
 *
 * Drift between them is silent and it reads as a RESULT: every dump appears
 * one-sided, which looks exactly like "the other side never sent this request".
 * So this compiles the real C++ and runs it against the real TypeScript.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/bodystem.test.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bodyFileStem } from "./store.ts";

const HERE = import.meta.dirname;
const CHROMIUM_SRC = path.resolve(HERE, "../../../../../../../src");
const REPLAY_CC = path.join(
	CHROMIUM_SRC,
	"chrome/browser/headless/sbxdiff_net_replay.cc"
);

/** See bodyhash.test.ts: no Chromium checkout in CI, so this half is skipped. */
const NO_CXX = existsSync(REPLAY_CC)
	? undefined
	: `no Chromium checkout at ${CHROMIUM_SRC}`;

/**
 * The C++ body of `BodyFileStem`, lifted out of the real file.
 *
 * Extracted rather than copied: a copy is a second source of truth and would
 * drift in exactly the way this test exists to catch. Chromium's own build
 * cannot be invoked for one function -- `sbxdiff_net_replay.cc` pulls in mojo,
 * net and //base -- but the function itself is pure string work over
 * std::string, so the body compiles standalone once `base::NumberToString` is
 * replaced by `std::to_string`.
 */
function liftedCxx(): string {
	const src = readFileSync(REPLAY_CC, "utf8");
	const start = src.indexOf("std::string BodyFileStem(");
	assert.notEqual(start, -1, "BodyFileStem not found in sbxdiff_net_replay.cc");
	let depth = 0;
	let end = -1;
	for (let i = src.indexOf("{", start); i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}" && --depth === 0) {
			end = i + 1;
			break;
		}
	}
	assert.notEqual(end, -1, "unbalanced braces in BodyFileStem");
	return src
		.slice(start, end)
		.replace(/base::NumberToString/g, "std::to_string");
}

const VECTORS = [
	// The shapes that actually occur: a Cloudflare challenge endpoint with a
	// query string, repeated with different ordinals.
	[
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/jsd/r/abc",
		0,
	],
	[
		"https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/jsd/r/abc",
		3,
	],
	["https://rateyourmusic.com/", 0],
	["https://example.com/a?b=c&d=%20e#frag", 11],
	// Every character class the replacement has an opinion about, including a
	// run of them (which collapses to ONE underscore, not one each).
	["a.b-c_d/e f??g", 7],
	// Over the 120-char cap: the TAIL is kept, because the distinguishing part
	// of a challenge URL is at the end.
	[`https://x.test/${"p".repeat(200)}/end`, 2],
	// Unicode: the C++ walks bytes and JS's regex walks UTF-16 code units, the
	// one place the two could disagree on how many underscores to emit.
	["https://x.test/é中?q=1", 5],
	["", 0],
] as const;

test("bodyFileStem agrees with the C++ the oracle actually runs", { skip: NO_CXX }, () => {
	const dir = mkdtempSync(path.join(tmpdir(), "sbxdiff-stem-"));
	const cc = path.join(dir, "stem.cc");
	writeFileSync(
		cc,
		`#include <cstdio>
#include <string>
${liftedCxx()}
int main(int argc, char** argv) {
  for (int i = 1; i + 1 < argc; i += 2) {
    std::printf("%s\\n", BodyFileStem(argv[i], std::atoi(argv[i + 1])).c_str());
  }
  return 0;
}
`
	);
	const bin = path.join(dir, "stem");
	execFileSync("c++", ["-std=c++20", "-O0", "-o", bin, cc]);

	const args = VECTORS.flatMap(([url, ord]) => [url, String(ord)]);
	const got = execFileSync(bin, args, { encoding: "utf8" })
		.split("\n")
		.slice(0, VECTORS.length);

	for (const [i, [url, ord]] of VECTORS.entries()) {
		assert.equal(
			got[i],
			bodyFileStem(url, ord),
			`stem disagrees for ${JSON.stringify(url)}#${ord}`
		);
	}
});

test("bodyFileStem keeps the distinguishing tail and stays a safe filename", () => {
	const long = bodyFileStem(`https://x.test/${"p".repeat(300)}/jsd/r/tail`, 4);
	assert.ok(long.length <= 120, `stem is ${long.length} chars`);
	assert.ok(long.endsWith("jsd_r_tail_4"), long);
	assert.match(long, /^[A-Za-z0-9._-]+$/);
	// Two ordinals of one endpoint must not collide: the challenge posts to the
	// same URL three times with a different payload each time.
	assert.notEqual(
		bodyFileStem("https://x.test/a", 0),
		bodyFileStem("https://x.test/a", 1)
	);
});
