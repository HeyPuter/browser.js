/**
 * The store cannot grade a request, and that is why the live failure never
 * reproduced here.
 *
 * Cloudflare's recorded "you passed" comes back whatever is posted to it, so a
 * sandbox whose payload the real server would REJECT is handed success anyway
 * and the run looks clean. The live behaviour -- post, rejected, retry, loop --
 * cannot happen against a recording that always says yes.
 *
 * --strict-bodies makes replay answer 403 exactly where the real server would.
 * The reference is the ORACLE's body, never the recording's: the recording came
 * from a different run with a different clock and different entropy, and
 * unmodified Chromium does not reproduce it either (RULES.md #61), so grading
 * against it would fail both sides and measure nothing.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/strict.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import {
	mountStoreEndpoint,
	reqBodyKey,
	type StoredResponse,
} from "./store.ts";

const URL_ = "https://challenges.cloudflare.com/cdn-cgi/x/fo/abc";

function hit(body: string): StoredResponse {
	return {
		status: 200,
		rawHeaders: "HTTP/1.1 200 OK content-type: text/plain",
		body: Buffer.from(body),
		requestBody: Buffer.from(""),
		reqHash: null,
	} as unknown as StoredResponse;
}

type Preload = {
	hits: Record<string, { oracleHash: string | null }[]>;
	strictBodies: boolean;
};

async function listen(app: express.Express) {
	const server = app.listen(0);
	await new Promise((r) => server.once("listening", r));
	return { server, port: (server.address() as AddressInfo).port };
}

async function serveOnce(opts: {
	strict: boolean;
	oracle?: Map<string, string>;
}) {
	const app = express();
	const store = new Map<string, StoredResponse[]>([[URL_, [hit("ok")]]]);
	const rejections: string[] = [];
	mountStoreEndpoint(
		app,
		store,
		[],
		[],
		[],
		[],
		new Map(),
		opts.oracle ?? new Map(),
		() => opts.strict,
		rejections
	);
	const { server, port } = await listen(app);
	const payload = (await (
		await fetch(`http://127.0.0.1:${port}/__sbxdiff/fetch?all=1`)
	).json()) as Preload;
	server.close();
	return { payload, rejections };
}

test("the preload carries the oracle's hash and the strict flag", async () => {
	// The transport does the grading, because it serves preloaded hits without
	// ever reaching the server again. It can only do that if the reference
	// travels with the hit.
	const oracle = new Map([[reqBodyKey(URL_, 0), "2263:abc"]]);
	const { payload } = await serveOnce({ strict: true, oracle });
	assert.equal(payload.strictBodies, true);
	assert.equal(payload.hits[URL_]![0]!.oracleHash, "2263:abc");
});

test("off by default, and then there is nothing to grade against", async () => {
	const { payload } = await serveOnce({ strict: false });
	assert.equal(payload.strictBodies, false);
	assert.equal(payload.hits[URL_]![0]!.oracleHash, null);
});

test("a hit with no oracle hash is never refused", async () => {
	// Most requests carry no body at all. Refusing those would turn every
	// request without a recorded body into a 403, and the run would collapse
	// for a reason that has nothing to do with the sandbox.
	const { payload } = await serveOnce({ strict: true, oracle: new Map() });
	assert.equal(payload.strictBodies, true);
	assert.equal(payload.hits[URL_]![0]!.oracleHash, null);
});

test("the strict flag is read per request, not captured at mount", async () => {
	// The store is mounted before the flags are parsed and long before the
	// oracle has produced the hashes. Capturing the value at mount time would
	// pin it to its default and the flag would silently do nothing -- the same
	// shape of failure as a switch that never reaches the renderer.
	const app = express();
	const store = new Map<string, StoredResponse[]>([[URL_, [hit("ok")]]]);
	let on = false;
	mountStoreEndpoint(
		app,
		store,
		[],
		[],
		[],
		[],
		new Map(),
		new Map(),
		() => on,
		[]
	);
	const { server, port } = await listen(app);
	const before = (await (
		await fetch(`http://127.0.0.1:${port}/__sbxdiff/fetch?all=1`)
	).json()) as Preload;
	on = true;
	const after = (await (
		await fetch(`http://127.0.0.1:${port}/__sbxdiff/fetch?all=1`)
	).json()) as Preload;
	server.close();
	assert.equal(before.strictBodies, false);
	assert.equal(after.strictBodies, true);
});

test("a refusal is recorded where the run can report it", async () => {
	const app = express();
	const store = new Map<string, StoredResponse[]>([[URL_, [hit("ok")]]]);
	const rejections: string[] = [];
	mountStoreEndpoint(
		app,
		store,
		[],
		[],
		[],
		[],
		new Map(),
		new Map(),
		() => true,
		rejections
	);
	const { server, port } = await listen(app);
	await fetch(`http://127.0.0.1:${port}/__sbxdiff/reject`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url: URL_, ordinal: 2, sent: "9:x", oracle: "9:y" }),
	});
	server.close();
	assert.equal(rejections.length, 1);
	assert.match(rejections[0]!, /#2 sent 9:x vs oracle 9:y/);
	assert.match(rejections[0]!, /challenges\.cloudflare\.com/);
});
