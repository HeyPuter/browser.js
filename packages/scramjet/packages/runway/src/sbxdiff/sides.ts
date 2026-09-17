/**
 * Building a `Side` from a trace directory.
 *
 * A run leaves everything the differ needs on disk: the `.sbxd` files and
 * Chromium's stderr, which is where the replay's request-body hashes and store
 * misses are printed. So a `Side` is a pure function of a directory, and the
 * differ never needs a browser.
 *
 * That is the point of this file. `capture()` in index.ts used to build a Side
 * inline, which meant every change to the differ cost two headed Chromium runs
 * (~110 s on rateyourmusic) before it could be read. Offline re-diffing turns
 * that into under a second against the SAME bytes, which is also the only way
 * two differ versions can be compared at all -- two live runs differ from each
 * other as well as from the change.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadTraces, mergeTraces } from "./run.ts";
import { reqBodyKey } from "./store.ts";
import { selectGuestRealm, type Side } from "./diff.ts";
import type { Trace } from "./trace.ts";

/** What a side's stderr says about the bytes it sent and could not get. */
export function parseReplayLog(stderr: string): {
	reqBodies: Map<string, string>;
	misses: Set<string>;
} {
	const reqBodies = new Map<string, string>();
	const misses = new Set<string>();
	for (const line of stderr.split("\n")) {
		const m = /sbxdiff: replay REQBODY #(\d+) (\S+) (\S+)$/.exec(line.trim());
		if (m) reqBodies.set(reqBodyKey(m[3], Number(m[1])), m[2]);
		const miss = /sbxdiff: replay MISS #\d+ (\S+)$/.exec(line.trim());
		if (miss) misses.add(miss[1]);
	}

	return { reqBodies, misses };
}

export type LoadedSide = Side & {
	/** How many records are outside the realm that was selected. */
	outside: number;
	/** Every realm with records, for a report that wants to name them. */
	trace: Trace;
};

/**
 * Load one side.
 *
 * `guest` picks the realm to compare. It is a predicate rather than a URL
 * because the sandbox's realm URL is the proxied spelling and never equals the
 * oracle's; see `selectGuestRealm`.
 */
export async function loadSide(
	dir: string,
	guest: (url: string) => boolean
): Promise<LoadedSide> {
	const traces = await loadTraces(dir);
	if (!traces.length) throw new Error(`${dir}: no .sbxd trace files`);
	const trace = mergeTraces(traces);
	const found = selectGuestRealm(trace, guest);
	if (!found) {
		throw new Error(
			`${dir}: no realm matched. Realms seen:\n    ` +
				[...trace.realms.values()].join("\n    ")
		);
	}
	// Absent only if the run was killed before it could be written; an offline
	// diff of such a directory is still worth doing, minus the body checks.
	let stderr = "";
	try {
		stderr = await readFile(path.join(dir, "chromium.stderr.log"), "utf8");
	} catch {
		/* no stderr kept for this run */
	}
	const { reqBodies, misses } = parseReplayLog(stderr);

	let outside = 0;
	for (const r of trace.records) {
		// `kNetRequest` and `kException` carry no realm -- neither writer has an
		// isolate -- so they are outside no realm rather than outside this one.
		if (!("realm" in r)) continue;
		if (r.realm !== found.realm) outside++;
	}

	return {
		trace,
		realm: found.realm,
		url: found.url,
		reqBodies,
		misses,
		outside,
	};
}

/** How many trace files a directory holds, without decoding them. */
export async function traceFileCount(dir: string): Promise<number> {
	return (await loadTraces(dir)).length;
}
