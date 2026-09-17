/**
 * Realm ids are per-isolate, so they collide across trace files, and realm is
 * what the whole comparison is scoped BY.
 *
 * A run writes one trace file per thread that recorded. Each numbers its realms
 * from 1, so realm 1 exists in all of them. `mergeTraces` namespaced SCRIPT ids
 * to avoid exactly this and left realms alone, with the result that realm 1 in
 * the merged trace was every document that happened to be first in its own
 * process. Measured on rateyourmusic: all 17 of the oracle's trace files
 * claimed realm 1 -- the browser toolbar, the page, the Turnstile widget and
 * eight Cloudflare blob workers -- so `selectGuestRealm` matched the page's URL
 * and then swept up 357 195 records from seventeen different documents. The
 * sandbox's guest realm had a large id that collided with nothing and stayed
 * clean, so every diff compared a seventeen-document union against one
 * document. Fixing it dropped rateyourmusic from 3983 divergences to 2512.
 *
 *   node --experimental-strip-types --no-warnings --test src/sbxdiff/merge.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mergeTraces } from "./run.ts";
import { Kind, type Trace } from "./trace.ts";

const call = (realm: number, seq: number, name: string, script: number) =>
	({
		kind: Kind.BindingCall,
		level: 0,
		seq,
		realm,
		task: 0,
		name,
		threw: false,
		topScript: script,
		entryScript: script,
		recv: { t: 0 },
		result: { t: 0 },
		argcTotal: 0,
		args: [],
	}) as never;

const trace = (file: string, realmUrl: string, names: string[]): Trace => ({
	file,
	version: 1,
	pid: 1,
	runKey: 1,
	// Every file numbers its own realms and scripts from 1. That is the point.
	realms: new Map([[1, realmUrl]]),
	// v4: realm creation times, namespaced on merge exactly like realm ids.
	// `seq` cannot order realms across files -- each file counts from 1 -- so
	// this is what "the document the run ended on" actually reads.
	realmCreatedUs: new Map([[1, 1_000]]),
	scripts: new Map([[1, `${realmUrl}#script`]]),
	records: names.map((n, i) => call(1, i + 1, n, 1)),
	truncatedBytes: 0,
});

test("two files that both use realm 1 stay two realms", () => {
	const merged = mergeTraces([
		trace("a.sbxd", "https://site.example/", ["Window.name.get"]),
		trace("b.sbxd", "https://widget.example/", ["Navigator.plugins.get"]),
	]);

	const urls = [...merged.realms.values()].sort();
	assert.deepEqual(urls, ["https://site.example/", "https://widget.example/"]);
	assert.equal(merged.realms.size, 2, "one realm per document, not one total");

	// And the records have to follow, or the ids are distinct while the
	// records still point at whichever mapping survived.
	const realmOf = (name: string) =>
		merged.realms.get(
			merged.records.find((r) => "name" in r && r.name === name)!.realm
		);
	assert.equal(realmOf("Window.name.get"), "https://site.example/");
	assert.equal(realmOf("Navigator.plugins.get"), "https://widget.example/");
});

test("scripts stay namespaced too, and 0 stays 0", () => {
	const merged = mergeTraces([
		trace("a.sbxd", "https://site.example/", ["Window.name.get"]),
		trace("b.sbxd", "https://widget.example/", ["Navigator.plugins.get"]),
	]);
	assert.equal(merged.scripts.size, 2);

	// 0 is "no JS on the stack" / "no realm" and must not become a valid id in
	// some file's namespace.
	const withZero: Trace = {
		...trace("c.sbxd", "https://third.example/", []),
		records: [call(0, 1, "Window.name.get", 0)],
	};
	const m2 = mergeTraces([
		trace("a.sbxd", "https://site.example/", ["X"]),
		withZero,
	]);
	const zero = m2.records.find(
		(r) => "name" in r && r.name === "Window.name.get"
	)!;
	assert.equal(zero.realm, 0);
	assert.equal((zero as { topScript: number }).topScript, 0);
});

test("a single trace is returned unchanged", () => {
	// The fast path: one file has no collisions to resolve, and rewriting its
	// ids would renumber realms the caller may already have reported.
	const one = trace("a.sbxd", "https://site.example/", ["Window.name.get"]);
	assert.equal(mergeTraces([one]), one);
});
