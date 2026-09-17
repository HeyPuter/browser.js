/**
 * What each side ASKED FOR, in order.
 *
 * The store answers by URL and ordinal and cannot grade a request, so the one
 * thing replay can still adjudicate is the SEQUENCE: whatever the store then
 * says, the two sides either asked for the same things in the same order or
 * they did not. On rateyourmusic they did not, and nothing noticed --
 * FINDINGS #232 found it by grepping `XMLHttpRequest.open` out of two traces by
 * hand and writing the two lists under each other:
 *
 *     oracle   rym#1  cf#1  rym#2  jsd    cf#2  cf#3
 *     sandbox  rym#1  cf#1  cf#2   rym#2  rym#3 jsd
 *
 * That is a first-class divergence and it was a paragraph in a lab notebook.
 *
 * Scoped per REALM, which is the only scope in which "in order" means anything.
 * `seq` is a per-tracer counter and a run writes one trace file per renderer
 * thread, so two requests from different processes have no defined order
 * between them -- but a realm lives in one process, and the challenge's whole
 * request sequence happens in two realms (the interstitial's and the widget's).
 *
 * Taken from the guest's own calls rather than from `kNetRequest`, for two
 * reasons: `kNetRequest` carries a task id but deliberately NO realm id
 * (ARCHITECTURE.md -- resource loads are not necessarily inside a v8 context),
 * and a `kNetRequest` is the LOAD, which for the sandbox is scramjet's fetch
 * rather than the guest's. What the guest asked for is the question.
 */

import { Kind, Tag, type Record_ } from "./trace.ts";
import type { GuestOp, GuestValue } from "./guestop.ts";
import {
	isGuestDirect,
	visibleRealmUrl,
	type Attribution,
	type Side,
} from "./diff.ts";

/** The APIs a page reaches the network through, by name in the tracer. */
const REQUEST_APIS = new Set([
	"XMLHttpRequest.open",
	"Window.fetch",
	"WorkerGlobalScope.fetch",
	"Navigator.sendBeacon",
	"EventSource.constructor",
]);

export type Request = {
	/** `GET`, `POST`, or the API's name where there is no method argument. */
	method: string;
	/** Unproxied, so the two sides' spellings are comparable. */
	url: string;
	realm: string;
};

/**
 * A short, comparable name for a request: host + the endpoint it is for.
 *
 * Two things force this to be lossy, and both are properties of the data
 * rather than choices.
 *
 * Cloudflare mints a fresh path per attempt -- `/fo/<ray>:<ts>:<token>/...` --
 * so the full path pairs nothing even between two runs of the SAME side. The
 * endpoint is what repeats and what the sequence is about.
 *
 * And the sandbox's URL arrives through the guest-op recorder, which keeps 48
 * characters plus a hash for a value over 200 (GUEST-OPS.md). A real `/fo/`
 * URL is 277. Comparing a 277-character oracle URL against a 48-character
 * sandbox prefix compares the instruments, not the runs -- so the comparison
 * has to happen on something both sides can spell in full, which the endpoint
 * is and the path is not.
 *
 * `base` is the realm's URL, because a page calls `xhr.open("POST", "/fo/...")`
 * with a relative path and the host is the realm's.
 */
export function requestLabel(url: string, base?: string): string {
	const known = ["fo", "jsd", "pat", "ci", "flaregun", "SecChk", "collect"];
	try {
		const u = new URL(url, base || undefined);
		const seg = u.pathname.split("/").filter(Boolean);
		const hit = seg.find((s) => known.includes(s));

		return `${u.host}/${hit ?? seg[seg.length - 1] ?? ""}`;
	} catch {
		// No base and a relative URL. The endpoint is still readable.
		const seg = url.split(/[/?#]/).filter(Boolean);
		const hit = seg.find((s) => known.includes(s));

		return hit ?? url.slice(0, 40);
	}
}

/**
 * Ordered guest requests, per realm, with the sandbox's URLs unproxied.
 *
 * **`ops` is not optional for a sandbox**, and the first version of this
 * function not taking it is worth recording. Read from binding records alone it
 * returned 40 requests for the oracle and **0** for the sandbox -- because
 * `XMLHttpRequest.open` and `fetch` are exactly the APIs scramjet intercepts,
 * so the sandbox's native call carries the shim on top and `isGuestDirect`
 * drops it, correctly. That is the whole reason the guest-op layer exists
 * (GUEST-OPS.md), and a request comparison that did not use it compared the
 * oracle's list against an empty one and reported the two sides as identical.
 */
export function requestSequence(
	side: Side,
	attribution: Attribution | undefined,
	/** The guest-op stream, for a side that has a shim. */
	ops: GuestOp[] = []
): Request[] {
	const out: Request[] = [];
	const realmOf = (realm: number) =>
		visibleRealmUrl(side.trace.realms.get(realm) ?? "");
	for (const r of side.trace.records) {
		if (r.kind !== Kind.BindingCall) continue;
		if (!REQUEST_APIS.has(r.name)) continue;
		if (!isGuestDirect(r, attribution)) continue;
		const [a, b] = argStrings(r);
		// `xhr.open(method, url)` puts the method first; everything else takes
		// the URL first and carries its method elsewhere.
		const isXhr = r.name === "XMLHttpRequest.open";
		const url = isXhr ? b : a;
		if (url === undefined) continue;
		out.push({
			method: isXhr ? (a ?? "?") : r.name.split(".").pop()!,
			url: visibleRealmUrl(url),
			realm: realmOf(r.realm),
		});
	}
	// The same members, as the guest saw them. A side has one source or the
	// other for a given API, never both: if scramjet intercepts it the binding
	// record was attributed to the shim above and dropped, and if it does not
	// there is no guest op.
	for (const o of ops) {
		if (!o.api || !REQUEST_APIS.has(o.api)) continue;
		const str = (v: GuestValue | undefined) =>
			v && v.t === "string" ? v.s : undefined;
		const isXhr = o.api === "XMLHttpRequest.open";
		const url = isXhr ? str(o.args[1]) : str(o.args[0]);
		if (url === undefined) continue;
		out.push({
			method: isXhr ? (str(o.args[0]) ?? "?") : o.api.split(".").pop()!,
			url: visibleRealmUrl(url),
			realm: realmOf(o.realm),
		});
	}

	return out;
}

/** The first two string arguments of a record, if it has them. */
function argStrings(r: Record_ & { args?: unknown }): (string | undefined)[] {
	const args = (r as { args?: { t: number; s?: string }[] }).args ?? [];

	return [0, 1].map((i) => (args[i]?.t === Tag.String ? args[i].s : undefined));
}

export type SequenceDivergence = {
	realm: string;
	/** Index into the two sequences at which they part company. */
	at: number;
	oracle?: string;
	sandbox?: string;
};

/**
 * Where the two sides' request sequences first part company, per shared realm.
 *
 * Reported as the first divergence and the lengths, not as a full edit script:
 * everything after the first difference is consequence, and a page that asks
 * for one extra thing shifts every pairing after it.
 */
export function sequenceDivergences(
	oracle: Request[],
	sandbox: Request[]
): SequenceDivergence[] {
	const byRealm = (rs: Request[]) => {
		const m = new Map<string, Request[]>();
		for (const r of rs) {
			const l = m.get(r.realm) ?? [];
			l.push(r);
			m.set(r.realm, l);
		}

		return m;
	};
	const o = byRealm(oracle);
	const s = byRealm(sandbox);
	const out: SequenceDivergence[] = [];
	// An empty sandbox side is the failure this comparison is most likely to
	// have, and the least likely to notice: every realm misses, every miss is
	// skipped, and the run reports "identical in every shared realm". Measured
	// exactly once, before `ops` was threaded through -- 40 against 0. Say it.
	if (oracle.length && !sandbox.length) {
		return [
			{
				realm: "(every realm)",
				at: 0,
				oracle: `${oracle.length} guest request(s)`,
				sandbox:
					"NONE -- the sandbox contributed no requests at all, which is an " +
					"instrument failure rather than a result. Check that guest ops are on.",
			},
		];
	}
	for (const [realm, oList] of o) {
		const sList = s.get(realm);
		// A realm only one side has is `realms.ts`'s finding, not this one.
		if (!sList) continue;
		const n = Math.max(oList.length, sList.length);
		for (let i = 0; i < n; i++) {
			const a = oList[i];
			const b = sList[i];
			const ak = a && `${a.method} ${requestLabel(a.url, a.realm)}`;
			const bk = b && `${b.method} ${requestLabel(b.url, b.realm)}`;
			if (ak === bk) continue;
			out.push({ realm, at: i, oracle: ak, sandbox: bk });
			break;
		}
	}

	return out;
}

/** The two sequences side by side, for a realm that diverged. */
export function formatSequences(
	realm: string,
	oracle: Request[],
	sandbox: Request[],
	at: number
): string[] {
	const label = (rs: Request[]) =>
		rs
			.filter((r) => r.realm === realm)
			.map((r) => `${r.method} ${requestLabel(r.url, r.realm)}`);
	const o = label(oracle);
	const s = label(sandbox);
	const lines = [`    realm ${realm}`];
	for (let i = 0; i < Math.max(o.length, s.length); i++) {
		lines.push(
			`      ${i === at ? "->" : "  "} ${(o[i] ?? "--").padEnd(38)} ${s[i] ?? "--"}`
		);
	}

	return lines;
}
