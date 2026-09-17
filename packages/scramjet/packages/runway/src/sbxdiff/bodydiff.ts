/**
 * The request body: what the page TELLS the server about itself.
 *
 * This is the most live-predictive signal the harness has, and for a long time
 * it was the only one that was printed rather than judged.
 *
 * A store answers by URL and ordinal. It cannot grade a request, so Cloudflare's
 * `fo/` endpoint returns the recorded "you passed" whatever was posted to it.
 * Measured on rateyourmusic, the sandbox posts 1899 and 1909 bytes less than the
 * oracle on the two large `fo/` payloads -- and is handed the recorded success
 * anyway. That is the precise point where replay stops representing live, and a
 * gate that ignores it can be green while the live run loops forever.
 *
 * ## Scored against the ORACLE, never against the recording
 *
 * The recording is the wrong reference and that is not a subtlety. Cloudflare's
 * payload is built from the clock and from entropy drawn during the run, so
 * nobody reproduces it: unmodified Chromium replaying this store posts 2263
 * bytes where the recording held 2274, and disagrees with the recording on all
 * five of the endpoints the sandbox does. Scoring the sandbox against the
 * recording scores it against noise. `--strict-bodies` does exactly that and is
 * a debugging aid, not a gate.
 *
 * The comparison that means something is the two runs of THIS execution against
 * each other, minus the spread the oracle shows against itself -- two oracle
 * runs post 87746 bytes against 87767, because the payload carries one entry per
 * pointer event and no two runs see the same number. A gate that fails for that
 * fails for a second oracle, which makes it a gate on nothing.
 */

import { bodySpread, withinBodyNoise } from "./bodynoise.ts";
import type { Divergence } from "./diff.ts";

export type BodyPair = { key: string; o?: string; s?: string };

export type BodyReport = {
	/** Beyond the oracle's own spread: real. */
	divergences: BodyPair[];
	/** Different, but inside the floor the oracle set against itself. */
	noise: number;
	/** How many bodies were compared at all. */
	total: number;
	/**
	 * One side reported nothing. That is the instrument failing, not the page
	 * sending nothing, and it must not be reported as N divergences.
	 */
	oneSided: "oracle" | "sandbox" | null;
};

/**
 * Endpoints whose body Cloudflare actually grades.
 *
 * A divergence here is T1: it is the difference between passing and not, and it
 * survives replay only because the store cannot grade. Everything else -- an
 * analytics beacon with a timestamp in it -- is T2, real but not the thing.
 */
const GRADED = [/\/cdn-cgi\/challenge-platform\/.*\/fo\//, /\/jsd\//, /SecChk/];

export function isGraded(url: string): boolean {
	return GRADED.some((re) => re.test(url));
}

export function compareBodies(
	oracleBodies: Map<string, string>,
	sandboxBodies: Map<string, string>,
	noiseSpreads: Record<string, number> = {}
): BodyReport {
	if (sandboxBodies.size && !oracleBodies.size) {
		return { divergences: [], noise: 0, total: 0, oneSided: "oracle" };
	}
	if (oracleBodies.size && !sandboxBodies.size) {
		return { divergences: [], noise: 0, total: 0, oneSided: "sandbox" };
	}
	const keys = [
		...new Set([...oracleBodies.keys(), ...sandboxBodies.keys()]),
	].sort();
	const all = keys
		.map((key) => ({
			key,
			o: oracleBodies.get(key),
			s: sandboxBodies.get(key),
		}))
		.filter(({ o, s }) => o !== s);
	const divergences = all.filter(
		({ key, o, s }) => !withinBodyNoise(o, s, noiseSpreads[key])
	);

	return {
		divergences,
		noise: all.length - divergences.length,
		total: keys.length,
		oneSided: null,
	};
}

/** Split a `reqBodyKey` back into its URL and ordinal. */
export function splitKey(key: string): { url: string; ordinal: number } {
	const m = /^(.*)#(\d+)$/.exec(key);

	return m ? { url: m[1], ordinal: Number(m[2]) } : { url: key, ordinal: 0 };
}

/**
 * Body divergences as first-class `Divergence`s, so they are counted, bucketed
 * and baselined like everything else.
 *
 * They were previously printed and then fed straight into the exit code, which
 * meant the summary line could say "0 T0 leaks" and exit 1 for a reason that
 * appeared nowhere in the tiers. A reader had to know to scroll up.
 *
 * The bucket key carries the endpoint SHAPE rather than the URL: a challenge URL
 * has a per-run token in it, so keying on the URL would mint a fresh bucket
 * every run and a baseline could never hold one.
 */
export function bodyDivergences(report: BodyReport): Divergence[] {
	return report.divergences.map(({ key, o, s }) => {
		const { url, ordinal } = splitKey(key);
		const graded = isGraded(url);
		const spread = bodySpread(o, s);
		const shape = endpointShape(url);

		return {
			tier: graded ? ("T1" as const) : ("T2" as const),
			kind: "value-divergence" as const,
			api: `body:${shape}`,
			at: ordinal,
			oracle: o ?? "(none sent)",
			sandbox: s ?? "(none sent)",
			class: "numeric-delta" as const,
			detail: graded
				? `the server grades this body; replay answers it regardless` +
					(spread === undefined ? `` : ` (${spread} bytes apart)`)
				: url,
			bucket: `${graded ? "T1" : "T2"}|value-divergence|body:${shape}|numeric-delta`,
		};
	});
}

/**
 * An endpoint's stable shape: path with per-run tokens replaced.
 *
 * `/cdn-cgi/challenge-platform/h/g/fo/<token>:<ts>:<nonce>/<id>/<blob>` differs
 * on every run in three places. Keeping the first four segments keeps what
 * identifies the endpoint and drops what identifies the run.
 */
export function endpointShape(url: string): string {
	let u = url;
	try {
		const parsed = new URL(url);
		const seg = parsed.pathname.split("/").filter(Boolean);
		// A path segment that is long, or carries a separator a name would not,
		// is a token rather than a route.
		const route = seg.filter(
			(p) => p.length < 24 && !/[:.]/.test(p) && !/^[0-9a-f]{16,}$/.test(p)
		);
		u = `${parsed.host}/${route.join("/")}`;
	} catch {
		/* not a URL; use it as-is */
	}

	return u;
}

/**
 * The bodies both sides actually sent, read off disk.
 *
 * A run dumps every request body it posts, per side, with a `.url` sidecar
 * carrying the `reqBodyKey` it belongs to. That is strictly better than the
 * hashes the two sides print to stderr and to the store server: it is the
 * BYTES, so lengths are exact, a shared prefix is measurable, and none of it
 * depends on log lines surviving.
 *
 * It is also the only source an offline re-diff can use. The oracle's hashes
 * are printed by the network service and the sandbox's are reported to the
 * store server, and neither reliably lands in the file a trace directory keeps
 * -- measured, `chromium.stderr.log` for a run that reported five body
 * divergences contains not one `REQBODY` line. The dumps were there the whole
 * time.
 *
 * Layout, which is not symmetric and has a reason:
 *
 *   <root>/<label>/<stem>.oracle    a side that replays in C++ (any oracle)
 *   <root>/<stem>.sandbox           a real sandbox, posted through the store
 *   <root>/<stem>.recorded          what the recording held, for reference
 */
export async function loadDumpedBodies(
	root: string,
	label: string,
	kind: "oracle" | "sandbox",
	/**
	 * Ignore dumps older than this.
	 *
	 * The flat `.sandbox` files are written by the store server and, before
	 * this, were never cleared -- so a directory held bodies from every run the
	 * tool had ever done. `index.ts` clears them per run now; this is what
	 * protects an OFFLINE re-diff of a directory that predates that, where the
	 * stale files are already on disk and read as 44 bodies the oracle never
	 * posted.
	 */
	notBefore?: number
): Promise<Map<string, string>> {
	const { readdir, readFile, stat } = await import("node:fs/promises");
	const path = await import("node:path");
	const { bodyHash } = await import("./store.ts");
	const dir = kind === "oracle" ? path.join(root, label) : root;
	const ext = kind === "oracle" ? ".oracle" : ".sandbox";
	const out = new Map<string, string>();
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		if (!name.endsWith(ext)) continue;
		if (notBefore !== undefined) {
			const { mtimeMs } = await stat(path.join(dir, name));
			if (mtimeMs < notBefore) continue;
		}
		const stem = name.slice(0, -ext.length);
		let key: string;
		try {
			key = (await readFile(path.join(dir, `${stem}.url`), "utf8")).trim();
		} catch {
			// No sidecar: the stem is a sanitized, truncated key and cannot be
			// turned back into one. Skipped rather than guessed at -- a wrong
			// key pairs two unrelated bodies, which reports a divergence that
			// is the reader's own.
			continue;
		}
		out.set(key, bodyHash(await readFile(path.join(dir, name))));
	}

	return out;
}
