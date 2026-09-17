/**
 * What the differ can and cannot see, per API.
 *
 * The differ pairs GUEST calls against GUEST calls -- a call whose topmost JS
 * frame is the page's own script. That is right for an API scramjet leaves
 * alone: the guest's call IS the binding call, and both sides record it.
 *
 * It is exactly wrong for an API scramjet intercepts. There the guest calls a
 * trap, the trap calls the native, and the native's record has scramjet's
 * script on top -- so the sandbox has ZERO guest calls to it and the oracle has
 * many. The differ reports that as `missing-call`, at T2, and a baseline
 * swallows it. Measured on rateyourmusic: `Element.getAttribute` is 217 guest
 * calls on the oracle against 0 in the sandbox, and 663 buckets of the
 * baseline are that same shape.
 *
 * So "the sandbox agrees with the oracle everywhere the differ looked" has been
 * true and uninformative at the same time: the differ looked only at the APIs
 * scramjet does not touch, which are the ones it cannot be wrong about.
 *
 * This file names that set. It does not fix it -- `guestop.ts` does -- it makes
 * the size of the hole a number that a run prints, so it cannot quietly grow.
 */

import { Kind } from "./trace.ts";
import { isGuestDirect, type Attribution, type Side } from "./diff.ts";
import type { GuestOp } from "./guestop.ts";

export type ApiCoverage = {
	api: string;
	/** Guest-direct calls on the oracle, in the compared realm. */
	oracleGuest: number;
	/** Guest-direct calls in the sandbox. Zero means the differ is blind. */
	sandboxGuest: number;
	/** Calls the sandbox made with a scramjet frame on top. */
	sandboxShim: number;
	verdict: Verdict;
};

export type Verdict =
	/** Both sides have guest calls: the differ compares them. */
	| "compared"
	/**
	 * The oracle's guest called it; the sandbox's did not, but scramjet did.
	 * scramjet intercepts this API and the guest's view of it is unmeasured.
	 */
	| "intercepted"
	/**
	 * The oracle's guest called it and NOBODY in the sandbox did -- not even
	 * scramjet.
	 *
	 * Usually not "the sandbox skipped the work": it is scramjet answering out
	 * of state it already holds, which is most of `location` (the proxy keeps
	 * the un-rewritten URL as a string and derives `hostname` from it without
	 * consulting the native). Measured on rateyourmusic: `Location.hostname.get`
	 * 35 calls to 0, `Document.referrer.get` 8 to 0.
	 *
	 * Either way the guest's view is unmeasured, and this is the case where it
	 * is unmeasurable from the binding layer even in principle -- no native was
	 * involved to record.
	 */
	| "elided"
	/** Only scramjet ever calls it. Its own plumbing; nothing to compare. */
	| "shim-only"
	/** Only the sandbox's guest calls it. Rewritten code doing extra work. */
	| "sandbox-only"
	/**
	 * Blink installing an interface object, not the guest reading one.
	 *
	 * `window.Node` and the other ~900 interface objects are installed lazily:
	 * the first access in a realm runs a binding callback that replaces itself
	 * with a data property, so every read after it is untraced on BOTH sides.
	 * Measured: `Window.Node` is 8 records across 6 oracle realms and 15 across
	 * 6 sandbox ones -- one or two per realm, by whoever touched it first.
	 *
	 * They looked like the largest remaining blind spot by a wide margin --
	 * 933 APIs and 2833 calls -- and they are not a blind spot at all. Nothing
	 * can cover them, because after the install there is nothing to cover.
	 */
	| "interface-object"
	/**
	 * The guest's calls are recorded at the scramjet layer instead.
	 *
	 * The binding layer still shows zero guest calls -- it always will, the
	 * trap is what the guest talks to -- but the guest-op recorder caught them,
	 * so the differ compares scramjet's answer against the oracle's native. The
	 * API is covered.
	 */
	| "guest-op";

export type CoverageReport = {
	rows: ApiCoverage[];
	/** Guest-observable calls the differ compared, and the ones it could not. */
	comparedCalls: number;
	/** Of `comparedCalls`, how many are covered by the guest-op recorder. */
	guestOpCalls: number;
	/** Lazily-installed interface objects. Nothing to cover; see the verdict. */
	interfaceObjects: number;
	interceptedCalls: number;
	elidedCalls: number;
	shimOnlyCalls: number;
};

/**
 * `Window.Node`, `Window.URL` -- an interface object on the global.
 *
 * Capitalized, one segment, no accessor suffix. `Window.location.get` has the
 * suffix; `Window.origin.get` is lowercase; `Window.atob` is a method and stays
 * comparable. The test is narrow because getting it wrong drops a real API.
 */
function isInterfaceObject(api: string): boolean {
	return /^Window\.[A-Z][A-Za-z0-9_$]*$/.test(api);
}

function countByApi(
	side: Side,
	attribution: Attribution | undefined,
	realm: number | null
): { guest: Map<string, number>; shim: Map<string, number> } {
	const guest = new Map<string, number>();
	const shim = new Map<string, number>();
	for (const r of side.trace.records) {
		if (r.kind !== Kind.BindingCall) continue;
		if (realm !== null && r.realm !== realm) continue;
		const m = isGuestDirect(r, attribution) ? guest : shim;
		m.set(r.name, (m.get(r.name) ?? 0) + 1);
	}

	return { guest, shim };
}

/**
 * `realm: null` asks about the whole run rather than the compared realm.
 *
 * Worth having both. Scoped to the realm answers "what did this diff miss";
 * whole-run answers "what does scramjet intercept on this site", which is the
 * same question asked of a page whose interesting realm is a blob worker.
 */
export function coverage(
	oracle: Side,
	sandbox: Side,
	opts: {
		oracleAttribution?: Attribution;
		sandboxAttribution?: Attribution;
		oracleRealm?: number | null;
		sandboxRealm?: number | null;
		/** Guest ops recorded in the sandbox, for the realm being scoped to. */
		guestOps?: GuestOp[];
	}
): CoverageReport {
	const o = countByApi(
		oracle,
		opts.oracleAttribution,
		opts.oracleRealm === undefined ? oracle.realm : opts.oracleRealm
	);
	const s = countByApi(
		sandbox,
		opts.sandboxAttribution,
		opts.sandboxRealm === undefined ? sandbox.realm : opts.sandboxRealm
	);

	const viaGuestOp = new Map<string, number>();
	for (const op of opts.guestOps ?? []) {
		const realm =
			opts.sandboxRealm === undefined ? sandbox.realm : opts.sandboxRealm;
		if (realm !== null && op.realm !== realm) continue;
		if (!op.api) continue;
		viaGuestOp.set(op.api, (viaGuestOp.get(op.api) ?? 0) + 1);
	}

	const apis = new Set([
		...viaGuestOp.keys(),
		...o.guest.keys(),
		...o.shim.keys(),
		...s.guest.keys(),
		...s.shim.keys(),
	]);
	const rows: ApiCoverage[] = [];
	for (const api of apis) {
		const oracleGuest = o.guest.get(api) ?? 0;
		const sandboxGuest = s.guest.get(api) ?? 0;
		const sandboxShim = s.shim.get(api) ?? 0;
		const guestOpCalls = viaGuestOp.get(api) ?? 0;
		let verdict: Verdict;
		if (isInterfaceObject(api) && guestOpCalls === 0) {
			verdict = "interface-object";
		} else if (oracleGuest > 0 && sandboxGuest > 0) verdict = "compared";
		else if (oracleGuest > 0 && guestOpCalls > 0) verdict = "guest-op";
		else if (oracleGuest > 0 && sandboxShim > 0) verdict = "intercepted";
		else if (oracleGuest > 0) verdict = "elided";
		else if (sandboxGuest > 0) verdict = "sandbox-only";
		else continue; // nobody's guest touched it; scramjet plumbing only
		rows.push({
			api,
			oracleGuest,
			sandboxGuest: sandboxGuest || guestOpCalls,
			sandboxShim,
			verdict,
		});
	}
	// Shim-only APIs are counted but not listed: there are hundreds and none of
	// them is a finding. The COUNT is the thing worth printing, because it is
	// the size of what a raw binding diff would have drowned in.
	let shimOnlyCalls = 0;
	for (const [api, n] of s.shim) {
		if ((o.guest.get(api) ?? 0) === 0 && (s.guest.get(api) ?? 0) === 0) {
			shimOnlyCalls += n;
		}
	}
	rows.sort(
		(a, b) =>
			b.oracleGuest + b.sandboxGuest - (a.oracleGuest + a.sandboxGuest) ||
			a.api.localeCompare(b.api)
	);

	const sum = (v: Verdict, pick: (r: ApiCoverage) => number) =>
		rows.filter((r) => r.verdict === v).reduce((a, r) => a + pick(r), 0);
	const interfaceObjects = rows.filter(
		(r) => r.verdict === "interface-object"
	).length;

	return {
		rows,
		comparedCalls:
			sum("compared", (r) => r.oracleGuest) +
			sum("guest-op", (r) => r.oracleGuest),
		guestOpCalls: sum("guest-op", (r) => r.oracleGuest),
		interceptedCalls: sum("intercepted", (r) => r.oracleGuest),
		elidedCalls: sum("elided", (r) => r.oracleGuest),
		shimOnlyCalls,
		interfaceObjects,
	};
}

export function formatCoverage(c: CoverageReport, top = 25): string {
	const lines: string[] = [];
	const n = (v: Verdict) => c.rows.filter((r) => r.verdict === v).length;
	const observable = c.comparedCalls + c.interceptedCalls + c.elidedCalls || 1;
	lines.push(
		`  guest-observable calls: ${c.comparedCalls} compared ` +
			`(${c.guestOpCalls} of them at the scramjet layer), ` +
			`${c.interceptedCalls} intercepted and unmeasured, ${c.elidedCalls} elided ` +
			`(${Math.round((c.comparedCalls / observable) * 100)}% covered)`
	);
	lines.push(
		`  APIs: ${n("compared")} at the binding layer, ${n("guest-op")} at the ` +
			`scramjet layer, ${n("intercepted")} intercepted and unmeasured, ` +
			`${n("elided")} elided, ${n("sandbox-only")} sandbox-only; ` +
			`${c.shimOnlyCalls} call(s) are scramjet's own plumbing, ` +
			`${c.interfaceObjects} lazily-installed interface object(s)`
	);
	const blind = c.rows
		.filter((r) => r.verdict === "intercepted" || r.verdict === "elided")
		.slice(0, top);
	if (blind.length) {
		lines.push(`\n  the differ cannot see these (top ${blind.length}):`);
		for (const r of blind) {
			lines.push(
				`      ${String(r.oracleGuest).padStart(6)} oracle-guest  ` +
					`${String(r.sandboxShim).padStart(6)} sandbox-shim  ` +
					`${r.verdict === "elided" ? "elided     " : "intercepted"}  ${r.api}`
			);
		}
	}

	return lines.join("\n");
}
