/**
 * The probe planter, and the thing that makes it trustworthy: its parser has
 * to agree with the store's own.
 *
 * `probestore.ts` reads the file format a second time, because `store.ts`
 * throws away the raw header block it has to reproduce. Two parsers for one
 * format is how a store quietly starts serving shifted bytes, so the test that
 * matters here is not "does the planter run" but "does `loadStore` see exactly
 * what the planter meant to write".
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/probestore.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadStore } from "./store.ts";
import {
	joinEntry,
	plantProbe,
	splitEntry,
	titleProbe,
	type RawEntry,
} from "./probestore.ts";

function entry(over: Partial<RawEntry> = {}): RawEntry {
	return {
		url: "https://example.test/app.js",
		mime: "application/javascript",
		encoding: "utf-8",
		rawHeaders: Buffer.from(
			"HTTP/1.1 200 OK\0content-type:application/javascript\0content-length:11\0",
			"latin1"
		),
		requestBody: Buffer.alloc(0),
		body: Buffer.from("console.log"),
		...over,
	};
}

/** A store directory with one file per entry, named the way the recorder does. */
function storeOf(entries: RawEntry[]): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "sbxdiff-probestore-"));
	entries.forEach((e, i) => {
		writeFileSync(path.join(dir, `1_2_1789000000000000_${i}`), joinEntry(e));
	});

	return dir;
}

test("split and join are inverses, byte for byte", () => {
	const buf = joinEntry(entry({ requestBody: Buffer.from("q=1") }));
	const parsed = splitEntry(buf);
	assert.ok(parsed);
	assert.deepEqual(joinEntry(parsed), buf);
});

test("a body containing newlines survives the round trip", () => {
	// The header fields are newline-delimited and the body is not: a reader
	// that split the whole file on \n would truncate every script in the store.
	const body = Buffer.from("a\nb\nc\n");
	const parsed = splitEntry(joinEntry(entry({ body })));
	assert.deepEqual(parsed?.body, body);
});

test("anything that is not an SBXD3 file is left alone", () => {
	assert.equal(splitEntry(Buffer.from("SBXD2\nhttps://x/\n")), null);
	assert.equal(splitEntry(Buffer.from("")), null);
});

test("the planted probe is what loadStore serves, ahead of the body", async () => {
	// The point of the whole module. `store.ts` parses independently; if the
	// two disagree about a single length prefix this is what catches it.
	const src = storeOf([entry()]);
	const dst = path.join(src, "..", path.basename(src) + "-probed");
	const patched = plantProbe({
		src,
		dst,
		match: "app.js",
		probe: "document.title='hi'",
	});
	assert.deepEqual(patched, ["https://example.test/app.js"]);
	const store = await loadStore(dst);
	const hit = store.get("https://example.test/app.js")?.[0];
	assert.equal(hit?.body.toString(), "document.title='hi'\nconsole.log");
});

test("the source store is never touched", async () => {
	const src = storeOf([entry()]);
	const before = readFileSync(path.join(src, "1_2_1789000000000000_0"));
	plantProbe({
		src,
		dst: path.join(src, "..", path.basename(src) + "-probed2"),
		match: "app.js",
		probe: "0",
	});
	assert.deepEqual(
		readFileSync(path.join(src, "1_2_1789000000000000_0")),
		before
	);
});

test("only URLs containing the match are patched", async () => {
	const src = storeOf([
		entry(),
		entry({
			url: "https://example.test/other.css",
			body: Buffer.from("body{}"),
		}),
	]);
	const dst = path.join(src, "..", path.basename(src) + "-probed3");
	const patched = plantProbe({ src, dst, match: "app.js", probe: "0" });
	assert.deepEqual(patched, ["https://example.test/app.js"]);
	const store = await loadStore(dst);
	assert.equal(
		store.get("https://example.test/other.css")?.[0]?.body.toString(),
		"body{}"
	);
});

test("a match that hits nothing reports nothing rather than pretending", () => {
	// The failure this guards is a run that looks clean because the probe was
	// never there -- indistinguishable, from the report, from a probe that
	// found the two sides agreeing.
	const src = storeOf([entry()]);
	const dst = path.join(src, "..", path.basename(src) + "-probed4");
	assert.deepEqual(plantProbe({ src, dst, match: "nope", probe: "0" }), []);
});

test("Content-Length goes, the other headers stay in order", async () => {
	const src = storeOf([entry()]);
	const dst = path.join(src, "..", path.basename(src) + "-probed5");
	plantProbe({ src, dst, match: "app.js", probe: "0" });
	const store = await loadStore(dst);
	const hit = store.get("https://example.test/app.js")?.[0];
	assert.deepEqual(hit?.headers, [["content-type", "application/javascript"]]);
	assert.equal(hit?.status, 200);
});

test("the store's own metadata files are skipped", async () => {
	const src = storeOf([entry()]);
	mkdirSync(src, { recursive: true });
	writeFileSync(path.join(src, "sbxdiff-manifest"), "not a recording");
	const dst = path.join(src, "..", path.basename(src) + "-probed6");
	assert.deepEqual(plantProbe({ src, dst, match: "app.js", probe: "0" }), [
		"https://example.test/app.js",
	]);
});

test("a document gets a <script> inside <head>, never before the DOCTYPE", async () => {
	// A <script> ahead of the DOCTYPE is what puts a browser in quirks mode,
	// which moves compatMode, clientHeight, scrollHeight and every layout
	// number the page can read. A probe that changed those would be measuring
	// itself.
	const src = storeOf([
		entry({
			url: "https://example.test/doc",
			mime: "text/html",
			body: Buffer.from(
				"<!DOCTYPE html>\n<html><head><title>t</title></head></html>"
			),
		}),
	]);
	const dst = path.join(src, "..", path.basename(src) + "-html");
	plantProbe({ src, dst, match: "/doc", probe: "PROBE" });
	const store = await loadStore(dst);
	const text = store.get("https://example.test/doc")?.[0]?.body.toString();
	assert.ok(text);
	assert.ok(
		text.indexOf("<!DOCTYPE html>") < text.indexOf("<script>PROBE"),
		"the probe must come after the DOCTYPE"
	);
	assert.ok(
		text.indexOf("<head>") < text.indexOf("<script>PROBE"),
		"the probe must be inside <head>"
	);
	assert.ok(
		text.indexOf("<script>PROBE") < text.indexOf("<title>"),
		"and ahead of anything the page can run"
	);
});

test("a document with no head takes the DOCTYPE as the anchor", async () => {
	const src = storeOf([
		entry({
			url: "https://example.test/bare",
			mime: "text/html",
			body: Buffer.from("<!DOCTYPE html>\n<p>hi"),
		}),
	]);
	const dst = path.join(src, "..", path.basename(src) + "-bare");
	plantProbe({ src, dst, match: "/bare", probe: "PROBE" });
	const store = await loadStore(dst);
	const text =
		store.get("https://example.test/bare")?.[0]?.body.toString() ?? "";
	assert.ok(text.startsWith("<!DOCTYPE html><script>PROBE"));
});

test("a script is still prepended at byte 0", async () => {
	// The HTML path must not capture scripts: a <script> wrapper inside a .js
	// body is a syntax error, and the recorded script would stop running.
	const src = storeOf([entry()]);
	const dst = path.join(src, "..", path.basename(src) + "-js");
	plantProbe({ src, dst, match: "app.js", probe: "PROBE" });
	const store = await loadStore(dst);
	assert.equal(
		store.get("https://example.test/app.js")?.[0]?.body.toString(),
		"PROBE\nconsole.log"
	);
});

test("the probe carries the document's own CSP nonce", async () => {
	// Without it the probe runs on one side only: unmodified Chromium refuses
	// an inline script that the nonce does not cover, and a proxy that does not
	// enforce the site's CSP runs it. That reads as "the oracle had no blobs"
	// rather than as "the probe never started".
	const src = storeOf([
		entry({
			url: "https://example.test/csp",
			mime: "text/html",
			rawHeaders: Buffer.from(
				"HTTP/1.1 200 OK\0content-security-policy:default-src 'none'; script-src 'nonce-ABC123' 'unsafe-eval'\0",
				"latin1"
			),
			body: Buffer.from("<!DOCTYPE html><html><head></head></html>"),
		}),
	]);
	const dst = path.join(src, "..", path.basename(src) + "-csp");
	plantProbe({ src, dst, match: "/csp", probe: "PROBE" });
	const store = await loadStore(dst);
	const text =
		store.get("https://example.test/csp")?.[0]?.body.toString() ?? "";
	assert.match(text, /<script nonce="ABC123">PROBE/);
});

test("a document with no CSP gets a bare script tag", async () => {
	const src = storeOf([
		entry({
			url: "https://example.test/nocsp",
			mime: "text/html",
			body: Buffer.from("<!DOCTYPE html><html><head></head></html>"),
		}),
	]);
	const dst = path.join(src, "..", path.basename(src) + "-nocsp");
	plantProbe({ src, dst, match: "/nocsp", probe: "PROBE" });
	const store = await loadStore(dst);
	const text =
		store.get("https://example.test/nocsp")?.[0]?.body.toString() ?? "";
	assert.match(text, /<script>PROBE/);
});

test("titleProbe writes one title per field and cannot throw out of the script", () => {
	const js = titleProbe({ "x.a": "1+1", "x.b": "document.scripts.length" });
	assert.match(js, /^try\{/);
	assert.match(js, /catch\(\$e\)\{document\.title="probe\.err="\+\$e\}$/);
	assert.match(js, /document\.title="x\.a="\+\(1\+1\);/);
	assert.match(js, /document\.title="x\.b="\+\(document\.scripts\.length\);/);
});
