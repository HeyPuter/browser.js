/**
 * Divergences the two sides cannot agree on, with the reason written down.
 *
 * This is NOT a baseline and must never become one. The difference is the whole
 * point:
 *
 * | | baseline | structural |
 * |---|---|---|
 * | what it holds | T2 and below | a T0/T1 that is provably unreachable |
 * | why | shim overhead that will always be there | a written, checkable cause |
 * | magnitude | not recorded -- RULES #127's exact failure | required, and enforced |
 * | visibility | a count | every entry printed, every run |
 * | how it is made | `rym.sh baseline`, automatically | by hand, one at a time |
 *
 * A baseline is recorded by a machine from whatever it saw. An entry here is an
 * argument a person made, and the file refuses one that does not make it: a
 * cause shorter than `MIN_CAUSE` characters, or one that is a placeholder, is a
 * hard error rather than a silent acceptance.
 *
 * **The magnitude bound is what keeps this honest.** "The heap differs" is not
 * a licence for the heap to differ by anything: an entry pins how far apart the
 * two sides were when the argument was made, and a run that exceeds it fails
 * exactly as it did before. That is the mechanism the noise floor already uses
 * and a baseline does not.
 *
 * And it is conditional. A divergence being structural does not make it
 * harmless -- if rateyourmusic breaks live ON one of these, it is the finding,
 * not an exception. Each entry says what would falsify it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { numericSpread, type Divergence } from "./diff.ts";

const HERE = import.meta.dirname;

/** Below this, a "cause" is an assertion rather than an argument. */
const MIN_CAUSE = 80;

const PLACEHOLDER = /^(todo|tbd|n\/?a|unknown|structural|see above|wontfix)\b/i;

export type StructuralEntry = {
	/**
	 * `<bucket>` for the compared realm, or `<realm-url>||<bucket>` for one the
	 * realm sweep found -- the same spelling the sweep reports.
	 */
	key: string;
	/** Why the two sides cannot agree. Required, and checked for substance. */
	cause: string;
	/**
	 * What would prove this wrong. Required, so an entry is falsifiable rather
	 * than merely asserted.
	 */
	falsifiedBy: string;
	/**
	 * Largest divergence accepted, in the bucket's own units. Required for a
	 * numeric bucket: without it "they differ" licenses any difference at all.
	 */
	maxSpread?: number;
};

export type Structural = {
	entries: Map<string, StructuralEntry>;
	/** Problems with the file itself. Non-empty means the run should fail. */
	errors: string[];
};

export function targetKey(target: string): string {
	const u = new URL(target);
	const rest = u.pathname.replace(/^\/+/, "").replace(/[^a-zA-Z0-9.]+/g, "-");

	return rest ? `${u.hostname}.${rest}` : u.hostname;
}

export async function loadStructural(target: string): Promise<Structural> {
	const file = path.join(HERE, `structural.${targetKey(target)}.json`);
	const entries = new Map<string, StructuralEntry>();
	const errors: string[] = [];
	let raw: { entries?: StructuralEntry[] };
	try {
		raw = JSON.parse(await readFile(file, "utf8"));
	} catch {
		return { entries, errors };
	}
	for (const e of raw.entries ?? []) {
		if (!e || typeof e.key !== "string" || !e.key) {
			errors.push(`an entry with no key`);
			continue;
		}
		const cause = typeof e.cause === "string" ? e.cause.trim() : "";
		if (cause.length < MIN_CAUSE || PLACEHOLDER.test(cause)) {
			errors.push(
				`${e.key}: the cause is ${cause.length} characters and has to be a real ` +
					`argument (>= ${MIN_CAUSE}, not a placeholder)`
			);
			continue;
		}
		// `null` is not "no bound": it compares as 0 and would reject everything.
		if (e.maxSpread === null) delete (e as { maxSpread?: number }).maxSpread;
		if (typeof e.falsifiedBy !== "string" || e.falsifiedBy.trim().length < 20) {
			errors.push(
				`${e.key}: needs a "falsifiedBy" saying what would disprove it`
			);
			continue;
		}
		// A numeric bucket without a bound accepts any magnitude, which is the
		// failure this file exists to avoid.
		if (/numeric-delta$/.test(e.key) && typeof e.maxSpread !== "number") {
			errors.push(`${e.key}: a numeric bucket needs a maxSpread`);
			continue;
		}
		entries.set(e.key, { ...e, cause });
	}

	return { entries, errors };
}

/**
 * Split divergences into those an entry covers and those it does not.
 *
 * A divergence is covered only when the key matches AND, for a numeric bucket,
 * this run stayed inside the recorded bound. Exceeding it is a finding again.
 */
export type StructuralVerdict =
	/** An entry covers this bucket, and the run is inside its recorded bound. */
	| { covered: true }
	/** No entry, or an entry whose magnitude bound this run exceeded. */
	| { covered: false; exceeded?: { spread: number; bound: number } };

/**
 * Does an entry cover this bucket, and is the run still inside its bound?
 *
 * Keyed by bucket, optionally scoped by realm -- the same API diverging in the
 * page and in an embedded widget are two findings with two causes, so an entry
 * may name either. A realm-scoped entry wins over a bare one.
 *
 * Returns rather than prints. This used to exist twice: once here, taking
 * `Divergence[]`, imported by nobody; and once inline in `index.ts`, taking a
 * bucket key, doing the real work and logging from inside a predicate. Two
 * implementations of one rule is how the gate and the offline re-differ came to
 * disagree about which findings were accepted.
 */
export function structuralVerdict(
	s: Structural,
	key: string,
	sample: { oracle?: unknown; sandbox?: unknown } | undefined,
	realm?: string
): StructuralVerdict {
	const entry =
		(realm ? s.entries.get(`${realm}||${key}`) : undefined) ??
		s.entries.get(key);
	if (!entry) return { covered: false };
	// Without the magnitude check "the heap differs" would license the heap
	// differing by anything, which is the failure this file exists to avoid.
	if (entry.maxSpread !== undefined && sample) {
		const spread = numericSpread({
			oracle: sample.oracle,
			sandbox: sample.sandbox,
		} as Divergence);
		if (spread !== undefined && spread > entry.maxSpread) {
			return { covered: false, exceeded: { spread, bound: entry.maxSpread } };
		}
	}

	return { covered: true };
}

/** Printed in full on every run: an exception nobody reads is a baseline. */
export function formatStructural(
	s: Structural,
	/** Keys accepted this run, `<realm>||<bucket>` or `<bucket>`. */
	active: Set<string>
): string {
	const out: string[] = [];
	if (s.errors.length) {
		out.push(`  structural.json is INVALID and nothing in it was applied:`);
		for (const e of s.errors) out.push(`      ${e}`);

		return out.join("\n");
	}
	if (!s.entries.size) return "";
	const hit = active;
	out.push(
		`  ${s.entries.size} structural exception(s), ${hit.size} accepted this run:`
	);
	for (const [key, e] of s.entries) {
		const on = [...hit].some((k) => k === key || k.endsWith(`||${key}`));
		out.push(`      ${on ? "*" : " "} ${key}`);
		out.push(
			`          ${e.cause.replace(/\s+/g, " ").slice(0, 150)}` +
				(e.maxSpread !== undefined ? `  (<= ${e.maxSpread})` : ``)
		);
	}

	return out.join("\n");
}
