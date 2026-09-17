/**
 * Read the payload plaintext back out of two traces, and diff it.
 *
 *   pnpm sbxplaintext                      # .traces/oracle vs .traces/sandbox
 *   pnpm sbxplaintext --oracle <dir> --sandbox <dir>
 *   pnpm sbxplaintext --kind json          # only the JSON.stringify results
 *   pnpm sbxplaintext --show o27            # print one chunk in full (o|s + id)
 *
 * The probe is `probes/payload-plaintext.js`, planted in a copy of the store by
 * `rym.sh plaintext`. Read that file first: it says which seam gives the
 * plaintext (`charCodeAt`, because LZW reads its input character by character)
 * and which two do not.
 *
 * ## Pairing is by CONTENT, never by index
 *
 * Both sides perform a different number of encodings -- scramjet does its own,
 * and the two runs do not reach the same point at the same time -- so the
 * sequences offset. Chunks are matched on their hash first, then on a
 * similarity score over the unmatched remainder, so "the same chunk, three
 * bytes different" is reported as one differing chunk rather than as one
 * missing and one extra.
 *
 * ## A sandbox-only chunk is suspect, not a finding
 *
 * The oracle has no scramjet, so every oracle chunk belongs to the challenge.
 * A chunk only the sandbox produced may be scramjet's: wasm-bindgen passes
 * strings to the rewriter by reading them character by character, which is the
 * same seam. The one sandbox-only chunk in the run that established this was a
 * 2168-byte `<style>` block -- the challenge setting `innerHTML`, and scramjet
 * handing it to the rewriter (FINDINGS #150). They are listed apart for that
 * reason.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadTraces, mergeTraces } from "./run.ts";
import { Kind, type Trace } from "./trace.ts";

const MARK = "sbxpt";

export type Chunk = {
	id: number;
	kind: string;
	/** True length of the original string, before slicing. */
	len: number;
	/** FNV-1a of the original, from the probe. Survives a truncated tail. */
	hash: string;
	/** How many data parts the probe said it would send. */
	parts: number;
	/** What was actually reassembled. */
	text: string;
	complete: boolean;
	realm: number;
};

function unescape_(s: string): string {
	return s.replace(/\\(\\|p|u[0-9a-f]{4})/g, (_, g: string) =>
		g === "\\"
			? "\\"
			: g === "p"
				? "|"
				: String.fromCharCode(parseInt(g.slice(1), 16))
	);
}

/**
 * Every chunk the probe emitted, from both sinks.
 *
 * `Document.createComment` in a document and `URL.constructor` in a worker --
 * both are traced bindings that record their string ARGUMENT, which is what
 * makes them usable as sinks at all.
 */
export function readChunks(trace: Trace): Chunk[] {
	const heads = new Map<number, Omit<Chunk, "text" | "complete">>();
	const parts = new Map<number, Map<number, string>>();

	for (const r of trace.records) {
		if (r.kind !== Kind.BindingCall) continue;
		if (r.name !== "Document.createComment" && r.name !== "URL.constructor") {
			continue;
		}
		const a = r.args[0];
		if (!a || a.t !== 4) continue;
		const at = a.s.indexOf(MARK);
		if (at < 0) continue;
		const body = a.s.slice(at + MARK.length);
		if (body.startsWith("h|")) {
			const [, id, kind, len, hash, n] = body.split("|");
			heads.set(Number(id), {
				id: Number(id),
				kind,
				len: Number(len),
				hash,
				parts: Number(n),
				realm: r.realm,
			});
		} else if (body.startsWith("d|")) {
			// Split into exactly three, because the payload itself may contain
			// an escaped `|` and must not be split on it.
			const first = body.indexOf("|", 2);
			const second = body.indexOf("|", first + 1);
			const id = Number(body.slice(2, first));
			const idx = Number(body.slice(first + 1, second));
			const data = body.slice(second + 1);
			let m = parts.get(id);
			if (!m) parts.set(id, (m = new Map()));
			m.set(idx, data);
		}
	}

	const out: Chunk[] = [];
	for (const [id, h] of heads) {
		const m = parts.get(id) ?? new Map<number, string>();
		let text = "";
		let complete = true;
		for (let i = 0; i < h.parts; i++) {
			const p = m.get(i);
			if (p === undefined) {
				complete = false;
				break;
			}
			text += p;
		}
		out.push({ ...h, text: unescape_(text), complete });
	}
	out.sort((a, b) => a.id - b.id);

	return out;
}

/** Longest common prefix and suffix, in characters. */
export function affixes(a: string, b: string): { pre: number; suf: number } {
	const n = Math.min(a.length, b.length);
	let pre = 0;
	while (pre < n && a[pre] === b[pre]) pre++;
	let suf = 0;
	while (suf < n - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf])
		suf++;

	return { pre, suf };
}

export type Pairing = {
	same: Chunk[];
	differing: { o: Chunk; s: Chunk; pre: number; suf: number }[];
	oracleOnly: Chunk[];
	sandboxOnly: Chunk[];
};

/**
 * Pair by hash, then by similarity over what is left.
 *
 * Index pairing is wrong here and quietly so: it reports a run where the
 * sandbox encoded one extra thing early as dozens of differing chunks.
 */
export function pair(oracle: Chunk[], sandbox: Chunk[]): Pairing {
	const same: Chunk[] = [];
	const byHash = new Map<string, Chunk[]>();
	for (const s of sandbox) {
		const k = `${s.kind}:${s.hash}`;
		const list = byHash.get(k) ?? [];
		list.push(s);
		byHash.set(k, list);
	}
	const usedS = new Set<Chunk>();
	const restO: Chunk[] = [];
	for (const o of oracle) {
		const list = byHash.get(`${o.kind}:${o.hash}`);
		const hit = list?.find((c) => !usedS.has(c));
		if (hit) {
			usedS.add(hit);
			same.push(o);
		} else {
			restO.push(o);
		}
	}
	const restS = sandbox.filter((s) => !usedS.has(s));

	// Greedy nearest-match on the remainder: the best common prefix wins, and
	// only when the two are recognisably the same thing.
	const differing: Pairing["differing"] = [];
	const takenS = new Set<Chunk>();
	const oracleOnly: Chunk[] = [];
	for (const o of restO) {
		let best: Chunk | null = null;
		let bestPre = -1;
		for (const s of restS) {
			if (takenS.has(s) || s.kind !== o.kind) continue;
			const { pre } = affixes(o.text, s.text);
			if (pre > bestPre) {
				bestPre = pre;
				best = s;
			}
		}
		// A shared prefix of at least 32 characters, or a quarter of the
		// shorter one. Below that they are two different strings that happen to
		// start alike.
		const floor = Math.min(32, Math.floor(Math.min(o.text.length, 1e9) / 4));
		if (best && bestPre >= floor) {
			takenS.add(best);
			const { pre, suf } = affixes(o.text, best.text);
			differing.push({ o, s: best, pre, suf });
		} else {
			oracleOnly.push(o);
		}
	}

	return {
		same,
		differing,
		oracleOnly,
		sandboxOnly: restS.filter((s) => !takenS.has(s)),
	};
}

/**
 * Does this pair differ ONLY in things the oracle does not reproduce either?
 *
 * Returns the reason, or null when the difference is the sandbox's.
 *
 * Only one entry so far, and it is measured rather than argued. The WebRTC
 * SDP offer carries a DTLS certificate fingerprint, and two ORACLE runs of
 * `rym.sh plaintext` against the same store with the same key gave
 *
 *     run A   oracle 74:3C:82:FE:03:AB:FB:F3:...
 *     run B   oracle D8:5D:B3:24:E7:13:A1:79:...
 *
 * so the oracle does not reproduce its own certificate and the two sides
 * cannot be expected to agree on it (FINDINGS #222). Everything else in that
 * offer -- session id, `ice-ufrag`, `ice-pwd`, all 213 lines -- does agree.
 *
 * Deliberately narrow: it compares the two texts with only the fingerprint
 * VALUES blanked, so a chunk that also differs anywhere else is still
 * reported. This is not a suppression list and must not become one -- an
 * entry belongs here only once two oracle runs have been shown to disagree.
 */
export function oracleNoise(o: string, sb: string): string | null {
	const FINGERPRINT = /(a=fingerprint:sha-256 )[0-9A-Fa-f:]+/g;
	const blank = (t: string) => t.replace(FINGERPRINT, "$1<fp>");
	if (!FINGERPRINT.test(o) || blank(o) !== blank(sb)) return null;

	return "a WebRTC DTLS certificate fingerprint, which two oracle runs also disagree on (FINDINGS #222)";
}

export function format(p: Pairing): string {
	const out: string[] = [];
	const noise = p.differing
		.map((d) => ({ d, why: oracleNoise(d.o.text, d.s.text) }))
		.filter((x) => x.why !== null);
	const real = p.differing.filter(
		(d) => oracleNoise(d.o.text, d.s.text) === null
	);
	out.push(
		`  ${p.same.length} identical, ${real.length} differing, ` +
			`${noise.length} within the oracle's own spread, ` +
			`${p.oracleOnly.length} oracle-only, ${p.sandboxOnly.length} sandbox-only`
	);
	if (noise.length) {
		out.push(`\n  within the oracle's own spread -- measured, not assumed:`);
		for (const { d, why } of noise) {
			out.push(
				`    #${d.o.id}/${d.s.id} ${d.o.kind}  ${d.o.len} chars  ${why}`
			);
		}
	}
	if (real.length) {
		out.push(`\n  differing chunks:`);
		for (const d of real) {
			out.push(
				`    #${d.o.id}/${d.s.id} ${d.o.kind}  ${d.o.len} vs ${d.s.len} chars` +
					`  (agree on the first ${d.pre} and the last ${d.suf})`
			);
			const at = d.pre;
			const o = JSON.stringify(d.o.text.slice(at, at + 72));
			const s = JSON.stringify(d.s.text.slice(at, at + 72));
			out.push(`        oracle : …${o}`);
			out.push(`        sandbox: …${s}`);
		}
	}
	if (p.oracleOnly.length) {
		out.push(
			`\n  oracle-only (the challenge did something the sandbox did not):`
		);
		for (const c of p.oracleOnly.slice(0, 10)) {
			out.push(
				`    #${c.id} ${c.kind} ${c.len} chars  ${JSON.stringify(c.text.slice(0, 64))}`
			);
		}
	}
	if (p.sandboxOnly.length) {
		out.push(
			`\n  sandbox-only -- SUSPECT, not a finding: wasm-bindgen reads strings` +
				` character by character too, so some of these are the rewriter's:`
		);
		for (const c of p.sandboxOnly.slice(0, 10)) {
			out.push(
				`    #${c.id} ${c.kind} ${c.len} chars  ${JSON.stringify(c.text.slice(0, 64))}`
			);
		}
	}

	return out.join("\n");
}

if (import.meta.filename === process.argv[1]) {
	const args = process.argv.slice(2);
	const flag = (n: string, d?: string) => {
		const i = args.indexOf(n);

		return i >= 0 ? args[i + 1] : d;
	};
	const HERE = import.meta.dirname;
	const oDir = path.resolve(
		flag("--oracle", path.join(HERE, ".traces", "oracle"))!
	);
	const sDir = path.resolve(
		flag("--sandbox", path.join(HERE, ".traces", "sandbox"))!
	);
	const kind = flag("--kind");

	const load = async (d: string) =>
		readChunks(mergeTraces(await loadTraces(d)));
	let o = await load(oDir);
	let s = await load(sDir);
	const partial = [...o, ...s].filter((c) => !c.complete).length;
	if (kind) {
		o = o.filter((c) => c.kind === kind);
		s = s.filter((c) => c.kind === kind);
	}

	console.log(
		`\n  oracle : ${o.length} chunk(s)   sandbox: ${s.length} chunk(s)`
	);
	if (!o.length && !s.length) {
		console.log(
			`  none -- the probe did not run. Check for "sbxdiff-plaintext: installed"` +
				` in the stderr log, and that the store was the PROBED copy.`
		);
		process.exit(1);
	}
	if (partial) {
		console.log(`  ${partial} chunk(s) incomplete (run killed mid-flush)`);
	}

	// `--show o27` / `--show s42`. Ids are per-SIDE and collide, so a bare
	// number would print whichever side happened to match first -- and the
	// report names pairs as `#27/42`, one from each.
	const show = flag("--show");
	if (show) {
		const m = /^([os])?(\d+)$/.exec(show);
		if (!m) {
			console.log(`  --show takes o<id> or s<id>, e.g. --show o27`);
			process.exit(2);
		}
		const from = m[1] === "s" ? s : m[1] === "o" ? o : [...o, ...s];
		for (const c of from.filter((c) => String(c.id) === m[2])) {
			console.log(
				`\n--- ${m[1] ?? "?"}#${c.id} ${c.kind} ${c.len} chars, realm ${c.realm} ---`
			);
			console.log(c.text);
		}
		process.exit(0);
	}
	console.log(format(pair(o, s)));
}
