/**
 * The request-body noise floor.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/bodynoise.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { bodyLength, bodySpread, withinBodyNoise } from "./bodynoise.ts";

test("a hash carries its body's length", () => {
	assert.equal(bodyLength("87746:1nnqc3i"), 87746);
	assert.equal(bodyLength(undefined), undefined);
	assert.equal(bodyLength("nonsense"), undefined);
});

test("the spread is the difference in bytes", () => {
	assert.equal(bodySpread("87746:a", "87767:b"), 21);
	assert.equal(bodySpread("90914:a", "90903:b"), 11);
	assert.equal(bodySpread("100:a", undefined), undefined);
});

test("identical bodies are always fine, floor or no floor", () => {
	assert.equal(withinBodyNoise("4556:x", "4556:x", undefined), true);
	assert.equal(withinBodyNoise("4556:x", "4556:x", 0), true);
});

test("differing bytes at the same length are noise once the oracle has shown it", () => {
	// Two oracle runs post the same number of bytes and different ones: the
	// payload carries a per-request nonce.
	assert.equal(withinBodyNoise("4556:a", "4556:b", 0), true);
});

test("with no floor recorded, any difference still fails", () => {
	assert.equal(withinBodyNoise("4556:a", "4556:b", undefined), false);
});

test("the oracle's own spread is tolerated and the sandbox's excess is not", () => {
	// Measured on rateyourmusic: 21 bytes between two oracle runs, 1205 between
	// the oracle and the sandbox. A floor that cannot tell those apart is not a
	// floor.
	assert.equal(withinBodyNoise("87746:a", "87767:b", 21), true);
	assert.equal(withinBodyNoise("87746:a", "88951:b", 21), false);
});

test("a body only one side sent is never noise", () => {
	// A request one run made and the other did not is the strongest divergence
	// this tool has; tolerating it would hide it entirely.
	assert.equal(withinBodyNoise("4556:a", undefined, 10000), false);
	assert.equal(withinBodyNoise(undefined, "4556:a", 10000), false);
});

test("a recorded spread of zero still allows a byte of drift", () => {
	// One self-check samples the noise; it does not bound it.
	assert.equal(withinBodyNoise("100:a", "104:b", 0), true);
	assert.equal(withinBodyNoise("100:a", "200:b", 0), false);
});
