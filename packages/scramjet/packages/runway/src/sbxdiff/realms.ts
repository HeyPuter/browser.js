/**
 * The realm sweep: every realm both sides have, not only the page's.
 *
 * Its own module because `index.ts` runs `main()` on import, so anything left
 * there can only be used by a live run. The realm sweep is what the gate FAILS
 * on -- 13 findings on rateyourmusic against 3 in the page realm -- so an
 * offline re-diff that could not do it was blind to most of the gate. You would
 * fix something, re-diff in a second, and not know whether it had moved.
 */

import { Kind } from "./trace.ts";
import {
	bucketize,
	diff,
	visibleRealmUrl,
	type DiffOptions,
	type Divergence,
	type Report,
	type Side,
} from "./diff.ts";

export type RealmFinding = { url: string; report: Report };

/**
 * When each side reached each realm, and how far apart that is.
 *
 * The gate had no notion of time at all -- a `.sbxd` record carries a `seq` and
 * no clock -- so "the sandbox takes 92 seconds longer" was a per-side total
 * measured by the harness, which compresses the interesting part: both sides
 * then sit out the same ~150 s grace. A viewport strip showed the real shape
 * (FINDINGS #234): the oracle reaches the page at t≈8 s and the sandbox at
 * t≈124 s.
 *
 * `realmCreatedUs` is already in the trace -- v4 appended it to every `kRealm`
 * record, in microseconds on a clock comparable across processes -- so the same
 * timeline can be had from bytes already on disk, per realm, without recording
 * anything new. A realm's creation is when its document or worker started, so
 * this says WHEN the widget appeared, when each blob worker started, and which
 * of them the sandbox is late for.
 *
 * Relative to each side's own earliest realm, because the two runs start at
 * different wall-clock instants and only the shape is comparable.
 */
export function realmTimeline(
	oracle: Side,
	sandbox: Side
): { url: string; oracleMs?: number; sandboxMs?: number }[] {
	const side = (s: Side) => {
		const created = s.trace.realmCreatedUs;
		let base = Infinity;
		for (const us of created.values()) base = Math.min(base, us);
		// First sighting per URL. A URL can host several realms in sequence --
		// rateyourmusic serves the challenge and the real page both at `/` --
		// and the question here is when that URL was first reached.
		const first = new Map<string, number>();
		for (const [realm, url] of s.trace.realms) {
			const us = created.get(realm);
			if (us === undefined) continue;
			const key = visibleRealmUrl(url);
			const ms = (us - base) / 1000;
			const prev = first.get(key);
			if (prev === undefined || ms < prev) first.set(key, ms);
		}

		return first;
	};
	const o = side(oracle);
	const s = side(sandbox);
	const urls = new Set([...o.keys(), ...s.keys()]);
	const rows = [...urls].map((url) => ({
		url,
		oracleMs: o.get(url),
		sandboxMs: s.get(url),
	}));
	// By whichever side reached it first, so the list reads as the journey.
	rows.sort(
		(a, b) =>
			Math.min(a.oracleMs ?? Infinity, a.sandboxMs ?? Infinity) -
			Math.min(b.oracleMs ?? Infinity, b.sandboxMs ?? Infinity)
	);

	return rows;
}

/** `realmTimeline` as lines, widest drift last so the tail is the answer. */
export function formatTimeline(
	rows: ReturnType<typeof realmTimeline>
): string[] {
	const ms = (v?: number) =>
		v === undefined ? "        --" : v.toFixed(0).padStart(8) + "ms";

	return rows.map((r) => {
		const drift =
			r.oracleMs !== undefined && r.sandboxMs !== undefined
				? `  ${r.sandboxMs - r.oracleMs >= 0 ? "+" : ""}${(r.sandboxMs - r.oracleMs).toFixed(0)}ms`
				: r.oracleMs === undefined
					? "  sandbox only"
					: "  ORACLE ONLY -- the sandbox never reached this realm";

		return `${ms(r.oracleMs)} ${ms(r.sandboxMs)}${drift}   ${r.url}`;
	});
}

/**
 * Every realm the two sides have in common, not just the page.
 *
 * The default comparison scopes to ONE realm per side because that is the only
 * scoping under which two sides are certainly comparable -- and on
 * rateyourmusic that realm is 2% of the run. Cloudflare's fingerprinting runs
 * in the Turnstile widget's realm and in a blob worker, so "0 T0 leak(s)" was a
 * statement about the 2%: diffing the widget's realm turned up six T1
 * divergences at once, every one of them in the payload it posts (RULES.md
 * #132, #133).
 *
 * Reported, not gated. The extra realms have no baseline -- the widget's alone
 * carries over a thousand T2 buckets -- and the proxy's worker bootstrap is
 * served from behind the prefix, so it classifies as guest and its own
 * `importScripts` reads as a T0. Making that fail the run would be a false
 * alarm; leaving the realms unexamined was a silent one.
 */
export function diffExtraRealms(
	oracle: Side,
	sandbox: Side,
	opts: DiffOptions,
	/** Where the per-group pairing notes go. Printed by the caller. */
	notes: string[] = []
): RealmFinding[] {
	const skipped = notes;
	const index = (side: Side) => {
		const counts = new Map<number, number>();
		for (const r of side.trace.records) {
			if (r.kind !== Kind.BindingCall && r.kind !== Kind.Interceptor) continue;
			counts.set(r.realm, (counts.get(r.realm) ?? 0) + 1);
		}
		const byKey = new Map<
			string,
			{ realm: number; url: string; n: number }[]
		>();
		for (const [realm, url] of side.trace.realms) {
			const n = counts.get(realm) ?? 0;
			// A realm with nothing in it never ran, and one with a handful of
			// records is a document that only got as far as being created.
			if (n < 50) continue;
			const key = visibleRealmUrl(url);
			const list = byKey.get(key) ?? [];
			list.push({ realm, url, n });
			byKey.set(key, list);
		}
		// Creation order, so the Nth blob worker on one side pairs with the Nth
		// on the other.
		const created = side.trace.realmCreatedUs;
		for (const list of byKey.values()) {
			list.sort(
				(a, b) => (created.get(a.realm) ?? 0) - (created.get(b.realm) ?? 0)
			);
		}

		return byKey;
	};

	const o = index(oracle);
	const s = index(sandbox);
	const out: RealmFinding[] = [];
	for (const [key, oList] of o) {
		const sList = s.get(key);
		/** Realms this group could not pair, as findings rather than a note. */
		const unpairedFindings: Divergence[] = [];
		// A URL the oracle ran and the sandbox did not run AT ALL.
		//
		// This used to `continue`, which made the gate quietest exactly when the
		// sandbox was worst: a group where it ran FEWER realms was flagged, and
		// a group where it ran NONE disappeared. Measured on rateyourmusic the
		// day it mattered -- a change took the sandbox's Cloudflare blob workers
		// from four to zero, and the extra-realm findings fell from 13 to 6
		// because nine oracle realms stopped being compared to anything
		// (FINDINGS #250). That is RULES #236 in code written for RULES #236.
		if (!sList) {
			const total = oList.reduce((a, r) => a + r.n, 0);
			skipped.push(
				`${key}: ${oList.length} oracle realm(s), NONE in the sandbox ` +
					`(${total} record(s) unmatched)`
			);
			out.push({
				url: key,
				report: bucketize([
					{
						tier: "T1",
						kind: "realm-divergence",
						api: key,
						at: 0,
						oracle: `${oList.length} realm(s), ${total} record(s)`,
						sandbox: "(none)",
						detail:
							"the oracle ran this URL and the sandbox ran it not at all, " +
							"so nothing here was compared",
						class: "count",
						bucket: `T1|realm-divergence|${key}|absent`,
					},
				]),
			});
			continue;
		}
		// Only when the two sides have the SAME number of documents at this
		// URL. One URL can host several in sequence -- rateyourmusic serves the
		// challenge and the real page both at `/`, and Critical-CH makes
		// Chromium restart the navigation on top of that -- so with unequal
		// counts, pairing by creation order silently holds a challenge page up
		// against a real one and reports the difference between two documents
		// as a divergence. `selectGuestRealm` has the same warning for the same
		// reason.
		// Unequal counts no longer throw the whole group away.
		//
		// On rateyourmusic the sandbox has twelve blob realms to the oracle's
		// nine, so `blob:https://challenges.cloudflare.com` was refused entirely
		// -- and with it the EIGHT Cloudflare benchmark workers that pair
		// one-to-one and carry 35000 records each. Refusing nine good pairs
		// because three realms had no partner is the wrong trade: those eight
		// are most of the run.
		//
		// When the counts differ, pair by SIZE RANK rather than creation order
		// and refuse a pair whose record counts are more than 4x apart. That is
		// what the original warning was really about: holding a 35600-record
		// worker up against an 822-record one reports the difference between two
		// unrelated documents. Equal counts still pair by creation order, which
		// is the case where the Nth document really is the Nth.
		let pairsList = oList.map((o, i) => [o, sList[i]] as const);
		if (oList.length !== sList.length) {
			const bySize = (l: typeof oList) => [...l].sort((a, b) => b.n - a.n);
			const o2 = bySize(oList);
			const s2 = bySize(sList);
			pairsList = [];
			const unpaired: string[] = [];
			for (let i = 0; i < Math.max(o2.length, s2.length); i++) {
				const a = o2[i];
				const b = s2[i];
				if (!a || !b) {
					unpaired.push(`${(a ?? b)!.n} record(s)`);
					// A realm ONE side ran. Only the ORACLE's counts: on
					// rateyourmusic the oracle runs nine Cloudflare blob realms
					// and eight have no sandbox counterpart at all, which is the
					// largest single difference in the run and used to be a
					// parenthesis. The other direction is not a finding -- the
					// sandbox legitimately has realms the oracle does not (its
					// own harness page, its service worker, the frames scramjet
					// creates), and flagging those reports the sandbox for
					// existing.
					if (!a) continue;
					unpairedFindings.push({
						tier: "T1",
						kind: "realm-divergence",
						api: key,
						at: i,
						oracle: `${a.n} record(s)`,
						sandbox: "(no realm)",
						detail:
							"the oracle ran this realm and the sandbox has no counterpart",
						class: "count",
						bucket: `T1|realm-divergence|${key}|count`,
					});
					continue;
				}
				const ratio = Math.max(a.n, b.n) / Math.max(1, Math.min(a.n, b.n));
				if (ratio > 4) {
					unpaired.push(`${a.n} vs ${b.n}`);
					// Refusing the pair is right -- two realms this far apart are
					// not the same document and diffing them reports noise -- but
					// the refusal is itself the finding. 35021 records against
					// 813 is a worker that did 2% of its work.
					//
					// Only when the SANDBOX is the smaller side, and that
					// asymmetry is not a hedge. A record count is every binding
					// call in the realm, and in the sandbox the shim runs in the
					// same realm as the guest -- so the sandbox having several
					// times more records is what a working proxy looks like
					// (measured: the rateyourmusic page realm, 7611 against
					// 158150). The sandbox having several times FEWER is a realm
					// that did not do its work.
					if (b.n >= a.n) continue;
					unpairedFindings.push({
						tier: "T1",
						kind: "realm-divergence",
						api: key,
						at: i,
						oracle: `${a.n} record(s)`,
						sandbox: `${b.n} record(s)`,
						detail:
							`the sandbox's realm did ${(100 / ratio).toFixed(0)}% of the ` +
							`oracle's work, too far apart to compare, so nothing in it ` +
							`was diffed`,
						class: "numeric-delta",
						bucket: `T1|realm-divergence|${key}|numeric-delta`,
					});
					continue;
				}
				pairsList.push([a, b]);
			}
			skipped.push(
				`${key}: ${pairsList.length} realm(s) paired by size, ` +
					`${unpaired.length} with no partner (${unpaired.join(", ")})`
			);
		}
		// Reported against the group's URL, which is the only identity an
		// unpaired realm has -- it has no partner to name it by.
		if (unpairedFindings.length) {
			out.push({ url: key, report: bucketize(unpairedFindings) });
		}
		for (const [o, sPair] of pairsList) {
			if (o.realm === oracle.realm && sPair.realm === sandbox.realm) {
				continue;
			}
			const divergences = diff(
				{ ...oracle, realm: o.realm, url: o.url },
				{ ...sandbox, realm: sPair.realm, url: sPair.url },
				opts
			);
			const report = bucketize(divergences);
			const interesting = [...report.buckets.keys()].filter(
				(k) => k.startsWith("T0|") || k.startsWith("T1|")
			);
			if (interesting.length) out.push({ url: key, report });
		}
	}
	return out;
}
