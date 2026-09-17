/**
 * `bodyShape` is the only thing that says HOW two request bodies differ, and
 * its answer is the diagnosis.
 *
 * "Agree on the first 171 bytes and the last 0" is what established that
 * Cloudflare's RSA-wrapped XTEA key now reproduces between runs and only the
 * plaintext does not -- which is a completely different bug from "the key
 * itself is still random". An off-by-one in either scan flips that reading, and
 * it flips it silently, because the output is prose rather than a pass/fail.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/bodyshape.test.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bodyShape } from "./bodyshape.ts";
import { bodyFileStem } from "./store.ts";

const URL_ = "https://challenges.cloudflare.com/cdn-cgi/x/fo/abc";
const ORD = 2;

/** A fixture root with one body per side, written where bodyShape looks. */
function fixture(a: string | Buffer, b: string | Buffer, farAsSandbox = false) {
	const root = mkdtempSync(path.join(tmpdir(), "sbxdiff-shape-"));
	const stem = bodyFileStem(URL_, ORD);
	mkdirSync(path.join(root, "oracle"), { recursive: true });
	writeFileSync(path.join(root, "oracle", `${stem}.oracle`), a);
	if (farAsSandbox) {
		// A real sandbox posts through the store, which writes flat.
		writeFileSync(path.join(root, `${stem}.sandbox`), b);
	} else {
		mkdirSync(path.join(root, "oracle#2"), { recursive: true });
		writeFileSync(path.join(root, "oracle#2", `${stem}.oracle`), b);
	}
	return root;
}

const shapeOf = (a: string | Buffer, b: string | Buffer, sandbox = false) =>
	bodyShape(
		"oracle",
		sandbox ? "sandbox" : "oracle#2",
		URL_,
		ORD,
		fixture(a, b, sandbox)
	);

test("reports the shared prefix, shared suffix and signed length delta", () => {
	assert.equal(
		shapeOf("HEADERaaaTAIL", "HEADERbbbbbTAIL"),
		"bytes: 13 vs 15 (+2), agree on the first 6 and the last 4"
	);
	// Negative deltas are signed, so a shrink cannot read as a growth.
	assert.match(shapeOf("HEADERaaaaaTAIL", "HEADERaTAIL")!, /\(-4\)/);
});

test("the prefix and suffix scans do not overlap", () => {
	// One body a strict prefix of the other: every byte of the shorter matches,
	// and the suffix scan must not then re-count those same bytes. 3 + 3 would
	// claim six matching bytes in a three-byte body.
	assert.equal(
		shapeOf("abc", "abcdef"),
		"bytes: 3 vs 6 (+3), agree on the first 3 and the last 0"
	);
	assert.equal(
		shapeOf("def", "abcdef"),
		"bytes: 3 vs 6 (+3), agree on the first 0 and the last 3"
	);
	// Identical bodies: all prefix, no double count.
	assert.equal(
		shapeOf("abcdef", "abcdef"),
		"bytes: 6 vs 6 (+0), agree on the first 6 and the last 0"
	);
});

test("the real shape: a shared key block, then ciphertext that differs at once", () => {
	// What a Cloudflare payload actually looks like once the RSA-wrapped XTEA
	// key reproduces: 171 identical bytes, then nothing in common. LZW makes a
	// single early plaintext difference smear over the whole remainder, so the
	// suffix is 0 rather than merely short.
	const key = "K".repeat(171);
	assert.equal(
		shapeOf(key + "ZZZZ", key + "QQQQQ"),
		"bytes: 175 vs 176 (+1), agree on the first 171 and the last 0"
	);
});

test("compares bytes, not text", () => {
	// Bodies are binary: a multipart POST carries CRLFs and arbitrary file
	// content, and a payload is base64 over a custom alphabet. Reading either
	// as UTF-8 would mangle the offsets this reports.
	const a = Buffer.from([0x00, 0xff, 0x80, 0x41, 0x00]);
	const b = Buffer.from([0x00, 0xff, 0x81, 0x41, 0x00]);
	assert.equal(
		shapeOf(a, b),
		"bytes: 5 vs 5 (+0), agree on the first 2 and the last 2"
	);
});

test("a missing dump is silence, never a wrong answer", () => {
	const root = mkdtempSync(path.join(tmpdir(), "sbxdiff-shape-"));
	assert.equal(bodyShape("oracle", "oracle#2", URL_, ORD, root), undefined);
	// Present on one side only is still silence: there is nothing to compare.
	const stem = bodyFileStem(URL_, ORD);
	mkdirSync(path.join(root, "oracle"), { recursive: true });
	writeFileSync(path.join(root, "oracle", `${stem}.oracle`), "abc");
	assert.equal(bodyShape("oracle", "oracle#2", URL_, ORD, root), undefined);
});

test("finds a real sandbox's body, which the store writes flat", () => {
	assert.equal(
		shapeOf("abcXdef", "abcYdef", true),
		"bytes: 7 vs 7 (+0), agree on the first 3 and the last 3"
	);
});
