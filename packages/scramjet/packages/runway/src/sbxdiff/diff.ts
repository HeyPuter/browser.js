/**
 * The differ: two traces in, tiered and bucketed divergences out.
 *
 * Two things it is deliberately NOT:
 *
 * - It never normalizes before comparing. Comparison is literal; `diffClass`
 *   runs strictly *after* a comparison has already failed and only chooses a
 *   bucket name. That is enforced by types here -- `classify` takes a
 *   `Divergence`, never two `Value`s (RULES.md #5, #6).
 * - It never compares whole trace files. A run contains realms the page does
 *   not own (browser UI, extensions) which are nondeterministic by nature;
 *   only the guest realm is comparable. See `selectGuestRealm`.
 */

import { Kind, Tag, type Record_, type Trace, type Value } from "./trace.ts";
import { toTraceValue, type GuestOp } from "./guestop.ts";

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";

export type DiffKind =
	| "leak"
	| "value-divergence"
	| "type-change"
	| "threw-divergence"
	| "novelty-divergence"
	| "identity-divergence"
	| "missing-call"
	| "extra-call"
	// Same values on both sides, different order. Not a divergence: one side
	// read some of them earlier, so pairing by position compares unrelated
	// calls. Reported once per API rather than once per pairing.
	| "order-divergence"
	| "exception-divergence"
	| "net-divergence"
	// A realm one side ran and the other did not, or ran to a wildly different
	// size. Not produced by comparing two record streams -- it is produced by
	// failing to find two streams to compare, which used to be a footnote.
	| "realm-divergence";

export type DiffClass =
	| "proxy-url-leak"
	| "chrome-origin-leak"
	| "shim-identity-leak"
	| "absolute-vs-relative"
	| "empty-vs-value"
	| "numeric-delta"
	| "type-change"
	| "identity"
	| "novelty"
	| "count"
	| "other";

export type Divergence = {
	tier: Tier;
	kind: DiffKind;
	/** Interned API name, e.g. `Document.title.get`. */
	api: string;
	/** Ordinal of this call within its API's sequence. */
	at: number;
	oracle?: string;
	sandbox?: string;
	detail?: string;
	class: DiffClass;
	/** `(tier, kind, api, class)` -- what a baseline suppresses on. */
	bucket: string;
};

/**
 * Strings that must never be visible to guest code. A hit is T0: the sandbox
 * has leaked its own existence, which is a failure of the sandbox's entire
 * purpose and is not a difference of opinion about an API's value.
 */
export type LeakMarkers = {
	/** Origin the sandbox itself is served from, e.g. `http://localhost:4500`. */
	chromeOrigin: string;
	/** Proxy path prefix, e.g. `/~/sj/`. */
	proxyPrefix: string;
	/** Identifiers that only exist inside the shim. */
	shimIdentifiers: string[];
};

export const DEFAULT_SHIM_IDENTIFIERS = [
	"$scramjet",
	"ScramjetClient",
	"scramjet client global",
	"__scramjet",
	"$scramjetController",
];

function fmt(v: Value): string {
	switch (v.t) {
		case Tag.Undefined:
			return "undefined";
		case Tag.Null:
			return "null";
		case Tag.Bool:
			return String(v.v);
		case Tag.Number:
			return Object.is(v.v, -0) ? "-0" : String(v.v);
		case Tag.String:
			return `string(${v.len})${JSON.stringify(v.s)}${v.truncated ? "…" : ""}`;
		case Tag.BigInt:
			return "bigint";
		case Tag.Symbol:
			return "symbol";
		case Tag.Object:
			return `object#${v.id}`;
		case Tag.DomWrapper:
			return `${v.iface}#${v.id}`;
		case Tag.Function:
			return `function#${v.id}`;
		case Tag.Proxy:
			return `proxy#${v.id}`;
		case Tag.Opaque:
			return "opaque";
	}
}

/** Strings a value carries, for leak scanning. Never enumerates contents. */
function stringOf(v: Value): string | null {
	return v.t === Tag.String ? v.s : null;
}

/**
 * Pick the realm the guest page owns.
 *
 * The URL differs between runs by construction -- the sandbox serves the page
 * from a proxied URL -- so this matches on the caller's hint and falls back to
 * "the realm with the most records", which is the page rather than an
 * `about:blank` shell in every run measured.
 */
export function selectGuestRealm(
	trace: Trace,
	hint: (url: string) => boolean
): { realm: number; url: string } | null {
	const counts = new Map<number, number>();
	const firstSeq = new Map<number, number>();
	for (const r of trace.records) {
		if (r.kind !== Kind.BindingCall && r.kind !== Kind.Interceptor) continue;
		counts.set(r.realm, (counts.get(r.realm) ?? 0) + 1);
		if (!firstSeq.has(r.realm)) firstSeq.set(r.realm, r.seq);
	}

	// The document the run ENDED on, not the busiest one.
	//
	// One URL can host several documents in sequence, and "most records" then
	// resolves differently on the two sides. Measured on rateyourmusic, where
	// Cloudflare's challenge and the real page are both served at
	// `https://rateyourmusic.com/`: the oracle's busiest realm was the
	// CHALLENGE (records 1..8991, a fifth of the run) and the sandbox's was the
	// real page, so the entire API comparison held a challenge page up against
	// a real one. That is not a divergence, it is two different documents, and
	// it produces divergences without limit -- `document.scripts` read 20
	// against 23 when the recorded page has 23 script tags and the SANDBOX was
	// the side telling the truth.
	//
	// Latest commit is the same question on both sides, and it is the one the
	// run is about: a replay that has to pass a challenge to reach the page is
	// asking about the page.
	// "Latest" needs a clock that is comparable across trace FILES, and `seq` is
	// not one: it counts records within a single file, so two realms in two
	// files both begin at 1. Measured on rateyourmusic, the oracle's two realms
	// at https://rateyourmusic.com/ live in file 1 and file 16 and both report
	// firstSeq=1 -- so the comparison below fell through to its tie-break and
	// picked the BUSIEST, which is the rule the comment above says is wrong. It
	// happened to land on the real page; it was not deciding anything.
	//
	// Realm records carry a creation time from the unoverridden clock (trace
	// format v4), which is comparable across files and processes. seq is kept
	// only as the fallback for a v3 trace.
	const created = trace.realmCreatedUs;
	const usable = [...trace.realms.keys()].every((r) => created.has(r));
	let best: { realm: number; url: string; at: number; n: number } | null = null;
	for (const [realm, url] of trace.realms) {
		if (!hint(url)) continue;
		const n = counts.get(realm) ?? 0;
		// A realm with nothing in it is a document that never ran; picking it
		// would trade one wrong answer for an empty one.
		if (n === 0) continue;
		const at = usable ? created.get(realm)! : (firstSeq.get(realm) ?? 0);
		if (!best || at > best.at || (at === best.at && n > best.n)) {
			best = { realm, url, at, n };
		}
	}

	return best ? { realm: best.realm, url: best.url } : null;
}

export type Side = {
	trace: Trace;
	realm: number;
	url: string;
	/**
	 * `reqBodyKey(url, ordinal)` -> FNV-1a of the body this side posted there.
	 *
	 * A request body is guest-observable output in the strongest sense: it is
	 * what the page TELLS the server about itself. Two runs that agree on every
	 * API call but post different bytes have diverged somewhere the API trace
	 * did not reach.
	 */
	reqBodies: Map<string, string>;
	/**
	 * URLs this side asked the store for and did not get.
	 *
	 * The sandbox's come from the store server; the oracle's from its stderr,
	 * because it replays inside the network service. Both are needed: a URL
	 * NEITHER side can find is a gap in the recording, and reporting it as
	 * "the sandbox asked for bytes the oracle never fetched" states a
	 * divergence that was never checked for.
	 */
	misses?: Set<string>;
};

type Call = {
	seq: number;
	recv: Value;
	result: Value;
	args: Value[];
	threw: boolean;
	/** True when the guest itself made this call, with no shim frame on top. */
	guestDirect: boolean;
	/**
	 * From the in-page guest-op recorder rather than the binding tracer.
	 *
	 * The two layers agree on primitives exactly and cannot agree on object
	 * TAGS: the tracer reads a `WrapperTypeInfo` and says `CSSStyleDeclaration`,
	 * while the recorder is forbidden from reading a constructor name off a
	 * value the page may have proxied, so it says only "an object". Comparing
	 * those two spellings reports a type change on every object a trap returns.
	 * Their IDs are two different namespaces as well, so they pair through a
	 * bijection of their own.
	 */
	guestOp?: boolean;
};

/** Ordered per-API call sequences for one realm. */
function apiSequences(
	side: Side,
	attribution?: Attribution
): Map<string, Call[]> {
	const out = new Map<string, Call[]>();
	for (const r of side.trace.records) {
		if (r.kind !== Kind.BindingCall) continue;
		if (r.realm !== side.realm) continue;
		let list = out.get(r.name);
		if (!list) out.set(r.name, (list = []));
		list.push({
			seq: r.seq,
			recv: r.recv,
			result: r.result,
			args: r.args,
			threw: r.threw,
			guestDirect: isGuestDirect(r, attribution),
		});
	}
	return out;
}

/**
 * Guest ops as per-API call sequences, in the shape `apiSequences` produces.
 *
 * These are what the GUEST asked scramjet for and what scramjet answered. For
 * an intercepted API that is the only record of the guest's view: the binding
 * call underneath belongs to scramjet and is correctly filtered out, and for
 * `location` there is no binding call at all.
 *
 * `guestDirect` is true by construction. The recorder only fires at depth
 * zero, which IS the definition the attribution was reaching for -- an
 * outermost interception is one the guest entered.
 */
function guestOpSequences(ops: GuestOp[], realm: number): Map<string, Call[]> {
	const out = new Map<string, Call[]>();
	for (const o of ops) {
		if (o.realm !== realm) continue;
		if (!o.api) continue;
		// The oracle structurally cannot have a counterpart. See isUntracedApi.
		if (o.untraced) continue;
		let list = out.get(o.api);
		if (!list) out.set(o.api, (list = []));
		list.push({
			seq: o.n,
			// The receiver is not recorded. It would cost an identity per call
			// for a value the comparison does not use: `compare` treats object
			// tags as equal and the bijection runs on results and arguments.
			recv: { t: Tag.Opaque },
			result: toTraceValue(o.result),
			args: o.args.map(toTraceValue),
			threw: o.threw,
			guestDirect: true,
			guestOp: true,
		});
	}

	return out;
}

/**
 * T0 from the recorder's own leak check.
 *
 * The recorder tests the WHOLE value, in the page, before anything truncates
 * it -- so a proxy URL 4 KB into a 40 KB string is caught, which no scan of a
 * 512-byte trace field could do. That is the only reason this is a separate
 * pass rather than `scanLeaks` over the synthesized values.
 */
export function scanGuestOpLeaks(ops: GuestOp[], realm: number): Divergence[] {
	const out: Divergence[] = [];
	const seen = new Set<string>();
	for (const o of ops) {
		if (o.realm !== realm || !o.leak) continue;
		const cls: DiffClass =
			o.leak === "proxy"
				? "proxy-url-leak"
				: o.leak === "chrome-origin"
					? "chrome-origin-leak"
					: "shim-identity-leak";
		const api = o.api ?? o.member;
		const bucket = `T0|leak|${api}|${cls}`;
		if (seen.has(bucket)) continue;
		seen.add(bucket);
		out.push({
			tier: "T0",
			kind: "leak",
			api,
			at: 0,
			sandbox: fmt(toTraceValue(o.result)),
			class: cls,
			detail: "the guest received this value from scramjet",
			bucket,
		});
	}

	return out;
}

function objectId(v: Value): number | null {
	switch (v.t) {
		case Tag.Object:
		case Tag.DomWrapper:
		case Tag.Function:
		case Tag.Proxy:
			// 0 means "unidentified" (non-wrapper), not "object zero".
			return v.id === 0 ? null : v.id;
		default:
			return null;
	}
}

/**
 * Cross-run object bijection with a novelty bit.
 *
 * Ids are run-local and assigned in first-sighting order, so they can only be
 * paired positionally as the streams align. A bijection alone cannot see "the
 * sandbox minted a fresh object where the oracle returned a cached one" when
 * the fresh object is never seen again -- hence `novel`, which is the highest
 * yield addition to it.
 */
class Bijection {
	private readonly fwd = new Map<number, number>();
	private readonly inv = new Map<number, number>();
	private readonly seenO = new Set<number>();
	private readonly seenS = new Set<number>();
	/** Where a binding was first established, for provenance in the report. */
	private readonly witness = new Map<number, string>();

	/** Returns a divergence kind, or null if consistent. */
	relate(
		o: Value,
		s: Value,
		where: string
	): {
		kind: "identity-divergence" | "novelty-divergence";
		detail: string;
	} | null {
		const oi = objectId(o);
		const si = objectId(s);
		if (oi === null || si === null) return null;

		const oNovel = !this.seenO.has(oi);
		const sNovel = !this.seenS.has(si);
		this.seenO.add(oi);
		this.seenS.add(si);

		if (oNovel !== sNovel) {
			return {
				kind: "novelty-divergence",
				detail: oNovel
					? "oracle returned a fresh object where the sandbox reused one"
					: "sandbox minted a fresh object where the oracle reused one",
			};
		}

		const bound = this.fwd.get(oi);
		if (bound === undefined) {
			const takenBy = this.inv.get(si);
			if (takenBy !== undefined && takenBy !== oi) {
				return {
					kind: "identity-divergence",
					detail: `sandbox #${si} is already bound to oracle #${takenBy} (at ${this.witness.get(takenBy)}); used here where oracle #${oi} is expected`,
				};
			}
			this.fwd.set(oi, si);
			this.inv.set(si, oi);
			this.witness.set(oi, where);
			return null;
		}
		if (bound !== si) {
			return {
				kind: "identity-divergence",
				detail: `oracle #${oi} was bound to sandbox #${bound} (at ${this.witness.get(oi)}); here it is sandbox #${si}`,
			};
		}
		return null;
	}
}

/** Object-ish: an identity, not a value. */
function isRef(t: Value["t"]): boolean {
	return (
		t === Tag.Object ||
		t === Tag.DomWrapper ||
		t === Tag.Function ||
		t === Tag.Proxy
	);
}

/**
 * Literal comparison. Returns null when equal; never normalizes.
 *
 * `crossLayer` means one side is a guest op and the other a binding call. The
 * two layers agree on every primitive and cannot agree on how an object is
 * SPELLED: the tracer reads a `WrapperTypeInfo` and answers
 * `CSSStyleDeclaration`, the in-page recorder is forbidden from reading a
 * constructor name off a value the page may have proxied and answers only
 * "an object". So across layers the tags of two references are not compared --
 * their identity is, through the guest-op bijection.
 *
 * Nothing else is relaxed. A string is still compared character for character,
 * a number bit for bit, and an object against a primitive is still a type
 * change -- which is the case that actually matters here, a trap returning
 * `undefined` where the native returned a node.
 */
function compare(o: Value, s: Value, crossLayer = false): DiffKind | null {
	if (o.t !== s.t) {
		if (crossLayer && isRef(o.t) && isRef(s.t)) return null;

		return "type-change";
	}
	switch (o.t) {
		case Tag.Bool:
			return o.v === (s as typeof o).v ? null : "value-divergence";
		case Tag.Number: {
			const b = (s as typeof o).v;
			return Object.is(o.v, b) ? null : "value-divergence";
		}
		case Tag.String: {
			const b = s as typeof o;
			if (o.len !== b.len) return "value-divergence";
			// Both sides carry a PREFIX of a long string, and not necessarily
			// the same length of one: the tracer keeps 512 bytes, the guest-op
			// recorder keeps 48 plus a hash. Comparing past the shorter of the
			// two compares the instruments rather than the run.
			//
			// Not a normalization (RULES #5): nothing is rewritten, and when
			// neither side truncated -- which is every binding-to-binding
			// comparison of a short string -- the prefix IS the whole string and
			// this is the literal test it always was.
			if (o.truncated || b.truncated) {
				const k = Math.min(o.s.length, b.s.length);

				return o.s.slice(0, k) === b.s.slice(0, k) ? null : "value-divergence";
			}

			return o.s === b.s ? null : "value-divergence";
		}
		// Identity is handled by the bijection, not here; two object values of
		// the same tag are "equal" at this layer by construction.
		default:
			return null;
	}
}

/**
 * scramjet fetching its own bundle through its own prefix.
 *
 * A proxied URL is a leak when the GUEST can see it. `/~/sj/<ctx>/scramjet
 * .wasm.js` is not that: it is the shim's bootstrap loading the shim, and the
 * guest never produced it or received it.
 *
 * It had to be excluded explicitly because attribution cannot separate them.
 * scramjet injects its bootstrap into a worker by prepending it to the worker's
 * source, so the bootstrap and the guest's own code compile as ONE script with
 * one id -- and that script's URL is the worker's blob, which is the guest's.
 * So `importScripts("/~/sj/<ctx>/scramjet.wasm.js")` arrives as guest-direct,
 * and a T0 the gate can never be rid of. Measured in every blob worker on
 * rateyourmusic, which is eight of them.
 *
 * Narrow on purpose: only a path under the prefix whose ONLY remaining segment
 * names a scramjet asset. A proxied URL that carries a guest URL -- which is
 * every URL the guest could actually observe -- still classifies as a leak,
 * and so does a bare prefix with anything else after it.
 */
function isShimAsset(s: string, markers: LeakMarkers): boolean {
	const at = s.indexOf(markers.proxyPrefix);
	if (at < 0) return false;
	const rest = s.slice(at + markers.proxyPrefix.length);
	// `<config>/<context>/<asset>` and nothing more.
	const seg = rest.replace(/^"|"$/g, "").split("/");

	return seg.length === 3 && /^scramjet[\w.-]*$/.test(seg[2]);
}

function classify(d: {
	kind: DiffKind;
	oracle?: string;
	sandbox?: string;
	markers: LeakMarkers;
}): DiffClass {
	const s = d.sandbox ?? "";
	const o = d.oracle ?? "";
	if (s.includes(d.markers.proxyPrefix) && !isShimAsset(s, d.markers))
		return "proxy-url-leak";
	if (d.markers.chromeOrigin && s.includes(d.markers.chromeOrigin))
		return "chrome-origin-leak";
	if (d.markers.shimIdentifiers.some((i) => s.includes(i)))
		return "shim-identity-leak";
	switch (d.kind) {
		case "type-change":
			return "type-change";
		case "identity-divergence":
			return "identity";
		case "novelty-divergence":
			return "novelty";
		case "missing-call":
		case "extra-call":
			return "count";
	}
	const oEmpty = o === "undefined" || o === "null" || /^string\(0\)/.test(o);
	const sEmpty = s === "undefined" || s === "null" || /^string\(0\)/.test(s);
	if (oEmpty !== sEmpty) return "empty-vs-value";
	if (/^string/.test(o) && /^string/.test(s)) {
		const oAbs = /"https?:\/\//.test(o);
		const sAbs = /"https?:\/\//.test(s);
		if (oAbs !== sAbs) return "absolute-vs-relative";
	}
	if (/^-?[\d.]+$/.test(o) && /^-?[\d.]+$/.test(s)) return "numeric-delta";
	return "other";
}

function bucketOf(d: Omit<Divergence, "bucket">): string {
	return `${d.tier}|${d.kind}|${d.api}|${d.class}`;
}

/**
 * Leak scan: absolute, not differential.
 *
 * This needs only the sandbox trace. A guest-observable string containing the
 * chrome origin, the proxy prefix or a shim identifier is a failure on its own
 * terms -- there is no "but the oracle does it too" defence -- so it is checked
 * before any alignment and can never be suppressed by a baseline.
 */
export function scanLeaks(side: Side, markers: LeakMarkers): Divergence[] {
	const out: Divergence[] = [];
	const seen = new Set<string>();

	const check = (api: string, what: string, v: Value) => {
		const s = stringOf(v);
		if (!s) return;
		let cls: DiffClass | null = null;
		if (s.includes(markers.proxyPrefix)) cls = "proxy-url-leak";
		else if (markers.chromeOrigin && s.includes(markers.chromeOrigin))
			cls = "chrome-origin-leak";
		else if (markers.shimIdentifiers.some((i) => s.includes(i)))
			cls = "shim-identity-leak";
		if (!cls) return;
		const bucket = `T0|leak|${api}|${cls}`;
		if (seen.has(bucket + s)) return;
		seen.add(bucket + s);
		out.push({
			tier: "T0",
			kind: "leak",
			api,
			at: 0,
			sandbox: `${what}=${JSON.stringify(s.slice(0, 200))}`,
			class: cls,
			detail: "guest-observable string reveals the sandbox",
			bucket,
		});
	};

	for (const r of side.trace.records) {
		if (r.kind === Kind.BindingCall) {
			if (r.realm !== side.realm) continue;
			check(r.name, "result", r.result);
			r.args.forEach((a, i) => check(r.name, `arg${i}`, a));
		} else if (r.kind === Kind.Interceptor) {
			if (r.realm !== side.realm) continue;
			if (r.written) check(r.name, "written", r.written);
		}
	}
	return out;
}

/**
 * The guest-observation layer.
 *
 * This is the distinction that makes the sandbox comparable at all. In the
 * sandbox the shim and the guest share one realm and one binding stream, so a
 * *binding-layer* value is not a guest-observable value: scramjet's traps
 * return a rewritten answer to the guest while the native underneath
 * legitimately reports the proxied URL. Treating the binding layer as
 * guest-observable reports every one of those as a leak, which is wrong.
 *
 * So the probe pages funnel each fact they observe through a sink -- by default
 * `document.title = "<key>=<value>"`. Whatever reaches the sink is by
 * construction what the *guest* computed, whatever the shim did underneath.
 * Those are compared by key, not by position, so an extra or missing
 * observation cannot shift everything after it.
 *
 * Attributing raw binding calls to guest vs. shim needs guest-op brackets from
 * the shim (plan P6); until that exists the binding layer is reported, but at a
 * lower tier and never as T0.
 */
export const GUEST_SINK = "Document.title.set";

export type Observation = { key: string; value: string };

export function guestObservations(
	side: Side,
	sink = GUEST_SINK
): Observation[] {
	const out: Observation[] = [];
	for (const r of side.trace.records) {
		if (r.kind !== Kind.BindingCall || r.realm !== side.realm) continue;
		if (r.name !== sink) continue;
		const a = r.args[0];
		if (!a || a.t !== Tag.String) continue;
		// Split on the FIRST separator: values routinely contain "=" (query
		// strings, base64), keys never may. A page that writes a key
		// containing "=" gets a wrong split, so keys are checked by the
		// probe pages, not sanitized here.
		const eq = a.s.indexOf("=");
		if (eq < 0) continue;
		out.push({ key: a.s.slice(0, eq), value: a.s.slice(eq + 1) });
	}
	return out;
}

function leakClassOf(s: string, markers: LeakMarkers): DiffClass | null {
	if (s.includes(markers.proxyPrefix)) return "proxy-url-leak";
	if (markers.chromeOrigin && s.includes(markers.chromeOrigin))
		return "chrome-origin-leak";
	if (markers.shimIdentifiers.some((i) => s.includes(i)))
		return "shim-identity-leak";
	return null;
}

/**
 * Compare what the guest actually observed. Keyed, so order is not load-bearing
 * and a missing observation is reported as itself rather than as a cascade.
 */
export function diffObservations(
	oracle: Observation[],
	sandbox: Observation[],
	markers: LeakMarkers
): Divergence[] {
	const out: Divergence[] = [];
	const push = (d: Omit<Divergence, "bucket">) =>
		out.push({ ...d, bucket: bucketOf(d) });
	const sMap = new Map(sandbox.map((o) => [o.key, o.value]));
	const oMap = new Map(oracle.map((o) => [o.key, o.value]));

	for (const { key, value: ov } of oracle) {
		const sv = sMap.get(key);
		if (sv === undefined) {
			push({
				tier: "T1",
				kind: "missing-call",
				api: `guest:${key}`,
				at: 0,
				oracle: ov,
				sandbox: "(never observed)",
				class: "count",
			});
			continue;
		}
		if (sv === ov) continue;
		// A leak in a value the guest itself read is T0 -- the sandbox has
		// revealed its own existence to the code it is supposed to contain.
		const leak = leakClassOf(sv, markers);
		push({
			tier: leak ? "T0" : "T1",
			kind: leak ? "leak" : "value-divergence",
			api: `guest:${key}`,
			at: 0,
			oracle: ov,
			sandbox: sv,
			class:
				leak ??
				classify({
					kind: "value-divergence",
					oracle: ov,
					sandbox: sv,
					markers,
				}),
			detail: leak ? "the guest itself observed this string" : undefined,
		});
	}
	for (const { key, value: sv } of sandbox) {
		if (oMap.has(key)) continue;
		push({
			tier: "T1",
			kind: "extra-call",
			api: `guest:${key}`,
			at: 0,
			oracle: "(never observed)",
			sandbox: sv,
			class: "count",
		});
	}
	return out;
}

/**
 * Script attribution: whose code is this?
 *
 * In a sandbox the shim and the guest share a realm, so "which realm" answers
 * nothing. "Which script" does. Every compared record carries two ids: the
 * script on top of the stack, and the script that entered the task.
 *
 * The pair is what matters, not either alone:
 *
 * | entry | top   | meaning                                              |
 * |-------|-------|------------------------------------------------------|
 * | guest | guest | the guest called a native directly -- **comparable**  |
 * | guest | shim  | the shim acting for the guest (a trap) -- the guest's |
 * |       |       | answer is the trap's return, not this native's        |
 * | shim  | shim  | the shim's own work (its startup platform snapshot)   |
 *
 * Only the first row is guest-observable at the binding layer, and that is the
 * row this promotes. It is what lets a real page be compared without the
 * cooperating `document.title` sink the probe pages use.
 */
export type ScriptClass = "guest" | "shim" | "unknown";

/**
 * Does this proxied URL carry a guest URL, in any of the spellings it can take?
 *
 * The prefix alone is not enough -- scramjet serves some of its OWN assets
 * through it -- so the test is that an absolute URL follows. It used to be
 * `%3A%2F%2F` alone, and that missed every blob: realm: the proxy rewrites a
 * Blob URL to `/~/sj/<ctx>/blob:https://host/uuid`, with the inner URL NOT
 * encoded.
 *
 * Cloudflare runs its detections in those realms -- 35021 records a side on
 * rateyourmusic, including the 5000-iteration SubtleCrypto benchmark -- so
 * every one of them was classified as the shim's and dropped. The differ
 * reported "sandbox: 0 calls" against the oracle's 5000 and that read like a
 * missing call rather than like a blind spot.
 *
 * Same shape as the bug the comment below records: a predicate that is wrong
 * about what a guest URL looks like does not report anything, it reports
 * nothing (RULES.md #117).
 */
export function carriesAnAbsoluteUrl(u: string): boolean {
	return (
		u.includes("%3A%2F%2F") ||
		/\/(?:blob|filesystem):|:\/\//.test(u.split("/~/sj/")[1] ?? "")
	);
}

/**
 * A worker's own script URL, under a proxy, carries no guest identity at all.
 *
 * Cloudflare runs its detections in a Blob worker. The oracle's script URL is
 * `blob:https://challenges.cloudflare.com/<uuid>` and says whose it is; the
 * sandbox's is `blob:http://localhost:4500/<uuid>`, a bare blob on the proxy's
 * OWN origin, and says nothing. 35013 records -- more than the page -- classified
 * as the shim's because there was nothing in the URL to classify them by.
 *
 * The identity is one level up, in the REALM: that one is
 * `/~/sj/<ctx>/blob:https://challenges.cloudflare.com/<uuid>`. So a bare blob on
 * the proxy's origin is resolved against the realms it actually ran in.
 *
 * Narrow on purpose. It applies only to `blob:` URLs, and only when every realm
 * the script ran in agrees; a script that ran in both a guest realm and a shim
 * one keeps whatever its own URL said, which for a proxy blob is the shim. An
 * upgrade needs evidence, and realms that disagree are not evidence.
 */
function resolveProxyBlobScripts(
	trace: Trace,
	isGuestUrl: (url: string) => boolean,
	out: Map<number, ScriptClass>
): void {
	const realmsOf = new Map<number, Set<number>>();
	for (const r of trace.records) {
		const id = "topScript" in r ? r.topScript : 0;
		if (!id) continue;
		const url = trace.scripts.get(id) ?? "";
		if (!/^blob:/.test(url)) continue;
		let realms = realmsOf.get(id);
		if (!realms) realmsOf.set(id, (realms = new Set()));
		realms.add(r.realm);
	}
	for (const [id, realms] of realmsOf) {
		const verdicts = new Set(
			[...realms].map((realm) => isGuestUrl(trace.realms.get(realm) ?? ""))
		);
		if (verdicts.size === 1) {
			out.set(id, verdicts.has(true) ? "guest" : "shim");
		}
	}
}

/**
 * The URL a realm would have WITHOUT the proxy, for pairing the two sides.
 *
 * The oracle names a realm `https://challenges.cloudflare.com/...` and the
 * sandbox names the same one
 * `http://localhost:4500/~/sj/<ctx>/https%3A%2F%2Fchallenges...?$rfp=...`.
 * Collapsing both to origin + pathname is what lets them be recognised as the
 * same document.
 *
 * A blob realm keeps only its origin: the UUID in
 * `blob:https://host/<uuid>` is minted per run and differs between the sides
 * by construction, so pairing on it would pair nothing.
 */
export function visibleRealmUrl(url: string): string {
	let u = url;
	// Everything behind the prefix, which is two segments in: `/~/sj/<config>/
	// <context>/<target>`. Taking one left `cm0euskr/blob:https://...` and
	// keyed the sandbox's blob realms under a name the oracle's could never
	// have.
	const pre = u.indexOf("/~/sj/");
	if (pre >= 0) {
		const rest = u.slice(pre + "/~/sj/".length).split("/");
		if (rest.length > 2) u = rest.slice(2).join("/");
	}
	// The FIRST encoded URL, not the last. scramjet appends its own
	// `$io=https%3A%2F%2F<site>` to the query, so `lastIndexOf` found the
	// INITIATOR -- and keyed the Turnstile widget's realm as
	// `https://rateyourmusic.com/`, which is the page that opened it.
	const enc = (() => {
		const a = u.indexOf("https%3A%2F%2F");
		const b = u.indexOf("http%3A%2F%2F");
		if (a < 0) return b;
		if (b < 0) return a;

		return Math.min(a, b);
	})();
	if (enc >= 0) {
		try {
			u = decodeURIComponent(u.slice(enc));
		} catch {
			u = u.slice(enc);
		}
	}
	// scramjet's own query parameters, which the oracle's URL does not carry.
	u = u.replace(/[?&](\$|%24)(rfp|io|iframe)=[^&]*/g, "");
	const blob = /^blob:(https?:\/\/[^/]+)\//.exec(u);
	if (blob) return `blob:${blob[1]}`;
	// `about:blank` and `about:srcdoc` have no origin, and `new URL` renders
	// them as "nullblank" -- unreadable, and every one of them collides.
	if (u.startsWith("about:")) return u;
	try {
		const parsed = new URL(u);

		return parsed.origin + parsed.pathname;
	} catch {
		return u;
	}
}

export function classifyScripts(
	trace: Trace,
	isGuestUrl: (url: string) => boolean
): Map<number, ScriptClass> {
	const out = new Map<number, ScriptClass>();
	for (const [id, url] of trace.scripts) {
		// An empty script URL is an inline or eval'd script with no sourceURL.
		// It is deliberately "unknown" rather than guessed: in the sandbox
		// scramjet rewrites guest inline scripts, so guessing by realm would
		// attribute shim-rewritten code to the guest.
		out.set(id, url === "" ? "unknown" : isGuestUrl(url) ? "guest" : "shim");
	}
	resolveProxyBlobScripts(trace, isGuestUrl, out);

	return out;
}

export type Attribution = {
	/** script id -> who owns it. */
	classes: Map<number, ScriptClass>;
};

function classOf(a: Attribution | undefined, id: number): ScriptClass {
	if (!a) return "unknown";
	// 0 means no JS was on the stack: the binding was reached from C++
	// (parser-driven work, a platform callback). Not the shim's doing and not
	// the guest's either.
	if (id === 0) return "unknown";
	return a.classes.get(id) ?? "unknown";
}

/**
 * True when the guest called this native itself, with no shim frame on top.
 *
 * Only `top` is tested, and that is deliberate. `entry_script` was designed to
 * mean "whose work is this task", but measurement showed it does not: in the
 * sandbox scramjet's controller enters essentially every task, so `entry` is
 * shim for guest code too. Requiring `entry == guest` classified *zero* sandbox
 * records as guest.
 *
 * `top == guest` is the criterion that actually carries the meaning. At a
 * native call the topmost JS frame is guest code, which means no shim trap
 * intervened -- if scramjet had trapped this API, its trap would be the frame
 * making the native call. Shim frames *below* the guest are fine and expected;
 * they are the shim having invoked guest code (an event handler, a timer).
 *
 * `entry_script` is still recorded: it is free (captured once per task) and it
 * is what tells you which side started a task.
 */
export function isGuestDirect(
	rec: { topScript: number; entryScript: number },
	a: Attribution | undefined
): boolean {
	return classOf(a, rec.topScript) === "guest";
}

export type DiffOptions = {
	markers: LeakMarkers;
	/** API carrying guest observations; see GUEST_SINK. */
	sink?: string;
	/** Per-side script attribution. Without it everything stays at T2. */
	oracleAttribution?: Attribution;
	sandboxAttribution?: Attribution;
	/**
	 * What the guest asked scramjet for, from the in-page recorder.
	 *
	 * Supplied for the sandbox only -- the oracle has no scramjet, so its
	 * counterpart for an intercepted API is the binding call the guest made
	 * directly. Where a guest op exists for an API it REPLACES the sandbox's
	 * binding sequence: the binding calls under an interception are scramjet's,
	 * and the guest's view is the trap's answer.
	 */
	sandboxGuestOps?: GuestOp[];
};

export function diff(
	oracle: Side,
	sandbox: Side,
	opts: DiffOptions
): Divergence[] {
	const out: Divergence[] = [];
	const push = (d: Omit<Divergence, "bucket">) =>
		out.push({ ...d, bucket: bucketOf(d) });

	// The layer that decides pass/fail: what the guest itself observed.
	out.push(
		...diffObservations(
			guestObservations(oracle, opts.sink),
			guestObservations(sandbox, opts.sink),
			opts.markers
		)
	);

	// The absolute leak scan, over the sandbox's own records.
	//
	// It needs no pair and no alignment, which is exactly why it has to run:
	// everything below this point only classifies a value once literal
	// comparison has already FAILED, so a leak reaches a tier only if it also
	// happens to diverge and to be paired. Two classes fall through that:
	//
	//   - An ARGUMENT. The argument loop below pushes at T2 unconditionally,
	//     even when `classify` answers `proxy-url-leak` -- so a proxy URL the
	//     guest passed INTO a native was reported, at a tier a baseline
	//     swallows, rather than failing the run.
	//   - Anything an interceptor WROTE. `apiSequences` reads `kBindingCall`
	//     only, so `kInterceptor` records -- which carry the value the guest
	//     assigned -- were compared by nothing at all.
	//
	// Realm-scoped like everything else, so the realm sweep runs it again for
	// each paired realm.
	out.push(...scanLeaks(sandbox, opts.markers));

	const oSeq = apiSequences(oracle, opts.oracleAttribution);
	const sSeq = apiSequences(sandbox, opts.sandboxAttribution);
	if (opts.sandboxGuestOps) {
		out.push(...scanGuestOpLeaks(opts.sandboxGuestOps, sandbox.realm));
		// Replace, not merge. See `sandboxGuestOps`.
		for (const [api, calls] of guestOpSequences(
			opts.sandboxGuestOps,
			sandbox.realm
		)) {
			sSeq.set(api, calls);
		}
	}
	const attributed = !!(opts.oracleAttribution && opts.sandboxAttribution);
	const bij = new Bijection();
	// The guest-op recorder mints its own ids, in its own namespace, so its
	// pairings must not share a bijection with the tracer's -- an id that means
	// one object in one namespace and another in the other would report an
	// identity divergence on every call.
	const guestBij = new Bijection();
	const apis = [...new Set([...oSeq.keys(), ...sSeq.keys()])].sort();

	for (const api of apis) {
		const oAll = oSeq.get(api) ?? [];
		const sAll = sSeq.get(api) ?? [];
		// Pair GUEST calls against GUEST calls.
		//
		// Every call in the realm used to take an index, shim ones included, so
		// a shim call in the sandbox shifted every guest call after it and the
		// comparison held one call up against a different call. That is
		// systematic on any API the shim also touches, which is most of them.
		//
		// Measured on `Window.atob` in the Turnstile widget's realm: the oracle
		// made 8 calls, all guest; the sandbox made 11, of which 8 were guest
		// and carried the SAME sizes -- 424->491, 6944->7714, 846072->950544.
		// Paired across everything, the sandbox's first shim call (64->49) was
		// held against the oracle's first guest call and the API read as wildly
		// divergent. Paired guest-to-guest it agrees exactly.
		//
		// Only when both sides are attributed; without attribution there is no
		// guest/shim to tell apart and everything stays as it was. The counts
		// below still come from ALL calls, because "the shim called this 30
		// times" is a real thing to report -- it just must not move the guest's
		// place in the queue.
		const attributedBoth =
			!!opts.oracleAttribution && !!opts.sandboxAttribution;
		const o = attributedBoth ? oAll.filter((c) => c.guestDirect) : oAll;
		const s = attributedBoth ? sAll.filter((c) => c.guestDirect) : sAll;
		const n = Math.min(o.length, s.length);
		// Calls are paired by position within an API, so one extra call on
		// either side shifts every pairing after it and the "divergences" that
		// follow are two unrelated calls held up next to each other. Measured on
		// rateyourmusic: `Element.tagName.get` reported oracle "BODY" against
		// sandbox "SCRIPT" 27 times, which is not a divergence, it is the
		// comparison having lost its place.
		//
		// A count mismatch is already reported on its own (missing-call /
		// extra-call). What it must not do is lend its drift the authority of
		// T1, so a VALUE divergence from an API whose sequences are different
		// lengths stays at T2 and out of the pass/fail tiers.
		//
		// A LEAK is different and keeps its tier. Its classification looks only
		// at the sandbox's own string -- a proxy URL is a proxy URL whoever it
		// was paired against -- so drift cannot invent one.
		//
		// Equal LENGTHS are not enough, and that gap reported fourteen
		// divergences that were one offset. Measured on rateyourmusic, in the
		// Turnstile widget's realm, `DOMRect.width.get` -- 17 calls on each
		// side, so "aligned" by the test above:
		//
		//   oracle   [20, 144, 84.71875, 68, 806.3494873046875, 132.3125, ...]
		//   sandbox  [231.1875 x6, 20, 144, 84.71875, 68, 806.3494873046875, ...]
		//
		// The same numbers, shifted by six, because the shim measured the widget
		// six times before the guest did. Every pairing after that is one call
		// against a different call, and it arrived as T1 -- the tier the run is
		// judged on.
		//
		// So the sequences must agree as MULTISETS too. If they hold the same
		// values in a different order, nothing diverged: the two sides read the
		// same things and one read some of them earlier. That is worth
		// reporting, and it is not a value divergence.
		// `fmt` is what the report prints and what `compare` disagrees on, so it
		// is the right granularity for "the same value" here.
		// An object renders as `CSSStyleDeclaration#9` on one layer and
		// `object#1` on the other, so across layers the multiset test has to
		// compare what the layers can both say: "a reference".
		const crossLayerApi = s.some((c) => c.guestOp);
		const bag = (cs: typeof o) =>
			cs
				.map((c) =>
					c.threw
						? "!threw"
						: crossLayerApi && isRef(c.result.t)
							? "ref"
							: fmt(c.result)
				)
				.sort()
				.join("\u0000");
		const sameLength = o.length === s.length;
		const sameMultiset = sameLength && bag(o) === bag(s);
		const positionsDiffer =
			sameLength &&
			o.some((c, i) => compare(c.result, s[i]!.result, !!s[i]!.guestOp));
		// Same values, different order: the two sides read the same things and
		// one read some of them earlier. Nothing diverged.
		const reordered = sameMultiset && positionsDiffer;
		const aligned = sameLength && !reordered;

		if (reordered) {
			// Said once, not once per pairing: it is a single fact about the
			// sequence, and N copies of it would read as N findings.
			push({
				tier: "T2",
				kind: "order-divergence",
				api,
				at: 0,
				oracle: fmt(o[0]!.result),
				sandbox: fmt(s[0]!.result),
				class: "other",
				detail:
					"same values in a different order -- one side read some of them " +
					"earlier, so pairing by position compares unrelated calls",
			});
		}

		for (let i = 0; i < n; i++) {
			const oc = o[i];
			const sc = s[i];

			if (oc.threw !== sc.threw) {
				push({
					tier: "T2",
					kind: "threw-divergence",
					api,
					at: i,
					oracle: oc.threw ? "threw" : "returned",
					sandbox: sc.threw ? "threw" : "returned",
					class: "other",
				});
			}

			const crossLayer = !!sc.guestOp;
			const vk = compare(oc.result, sc.result, crossLayer);
			if (vk) {
				const oracleS = fmt(oc.result);
				const sandboxS = fmt(sc.result);
				const cls = classify({
					kind: vk,
					oracle: oracleS,
					sandbox: sandboxS,
					markers: opts.markers,
				});
				// With attribution, a call BOTH sides made directly from guest
				// code is guest-observable: there is no trap in between whose
				// return could differ from the native's. Those get judged.
				// Everything else stays T2 -- a binding-layer difference under a
				// shim frame is expected and says nothing on its own.
				const guestObservable = attributed && oc.guestDirect && sc.guestDirect;
				const leak =
					guestObservable &&
					(cls === "proxy-url-leak" ||
						cls === "chrome-origin-leak" ||
						cls === "shim-identity-leak");
				push({
					tier: leak ? "T0" : guestObservable && aligned ? "T1" : "T2",
					kind: leak ? "leak" : vk,
					api,
					at: i,
					oracle: oracleS,
					sandbox: sandboxS,
					class: cls,
					detail: leak
						? "guest code read this native directly; no trap in between"
						: undefined,
				});
			}

			const argN = Math.min(oc.args.length, sc.args.length);
			for (let a = 0; a < argN; a++) {
				const ak = compare(oc.args[a], sc.args[a], crossLayer);
				if (!ak) continue;
				const oracleS = fmt(oc.args[a]);
				const sandboxS = fmt(sc.args[a]);
				push({
					tier: "T2",
					kind: ak,
					api: `${api}#arg${a}`,
					at: i,
					oracle: oracleS,
					sandbox: sandboxS,
					class: classify({
						kind: ak,
						oracle: oracleS,
						sandbox: sandboxS,
						markers: opts.markers,
					}),
				});
			}

			const idk = (sc.guestOp ? guestBij : bij).relate(
				oc.result,
				sc.result,
				`${api}[${i}]`
			);
			if (idk) {
				push({
					tier: "T2",
					kind: idk.kind,
					api,
					at: i,
					oracle: fmt(oc.result),
					sandbox: fmt(sc.result),
					detail: idk.detail,
					class: idk.kind === "identity-divergence" ? "identity" : "novelty",
				});
			}
		}

		// A leak in the calls that were never paired.
		//
		// Only `min(oracle, sandbox)` calls are compared, so anything the
		// sandbox does BEYOND the oracle's count was not looked at by anyone --
		// and "the sandbox made an extra call that returned a proxy URL" is
		// exactly the shape of leak this tool exists to catch. A leak needs no
		// pair: the classification reads the sandbox's own string, which is why
		// it survives misalignment (see `aligned` above) and why it has to be
		// checked here too.
		if (attributed) {
			for (let i = n; i < s.length; i++) {
				const sc = s[i];
				if (!sc.guestDirect) continue;
				for (const [what, value] of [
					["", sc.result] as const,
					...sc.args.map((a, j) => [`#arg${j}`, a] as const),
				]) {
					const sandboxS = fmt(value);
					const cls = classify({
						kind: "value-divergence",
						sandbox: sandboxS,
						markers: opts.markers,
					});
					if (
						cls !== "proxy-url-leak" &&
						cls !== "chrome-origin-leak" &&
						cls !== "shim-identity-leak"
					) {
						continue;
					}
					push({
						tier: "T0",
						kind: "leak",
						api: `${api}${what}`,
						at: i,
						oracle: "(the oracle never made this call)",
						sandbox: sandboxS,
						class: cls,
						detail:
							"guest code read this native directly, in a call the oracle " +
							"never made",
					});
				}
			}
		}

		if (o.length !== s.length) {
			const missing = s.length < o.length;
			// scramjet snapshots the whole platform surface at startup
			// (`nativeStore`), which reads a few hundred `Window.<Interface>`
			// constructor getters the oracle never touches. That is one
			// phenomenon, not 1169 findings, so it gets one bucket.
			const snapshot =
				(!missing && o.length === 0 && /^Window\.[A-Z]/.test(api)) ||
				// With attribution, extra calls none of which the guest made
				// directly are shim work by definition.
				// `sAll`, not `s`: with guest-only pairing `s` holds no shim calls
				// to test. This still matters when only one side is attributed.
				(attributed && !missing && sAll.every((c) => !c.guestDirect));
			push({
				tier: snapshot ? "T4" : "T2",
				kind: missing ? "missing-call" : "extra-call",
				api: snapshot ? "Window.<interface> (platform snapshot)" : api,
				at: n,
				oracle: `${o.length} calls`,
				sandbox: `${s.length} calls`,
				class: "count",
				detail: snapshot
					? "shim reads the platform surface at startup; expected"
					: undefined,
			});
		}
	}

	return out;
}

export type Report = {
	divergences: Divergence[];
	buckets: Map<string, { tier: Tier; count: number; sample: Divergence }>;
};

/**
 * How far apart a numeric divergence's two values are, or undefined.
 *
 * A bucket key is `tier|kind|api|class` and carries no magnitude, so the
 * oracle disagreeing with ITSELF by 0.7 ms and the sandbox disagreeing by
 * 171 ms land on the same key -- and a noise floor recorded from the first
 * suppresses the second. Measured on Cloudflare's widget:
 *
 *     PerformanceEntry.duration   oracle vs oracle   14.29 vs 13.575
 *     PerformanceEntry.duration   oracle vs sandbox  14.495 vs 185.4
 *
 * A thirteenfold difference, invisible behind sub-millisecond jitter of the
 * same name. So the floor records what the oracle's own spread was, and a run
 * has to stay inside it to be called noise.
 */
export function numericSpread(d: Divergence): number | undefined {
	const o = Number(d.oracle);
	const s = Number(d.sandbox);
	if (!Number.isFinite(o) || !Number.isFinite(s)) return undefined;

	return Math.abs(o - s);
}

/**
 * Is this run's numeric divergence within the spread the oracle showed itself?
 *
 * Scaled, not exact: the oracle's own spread varies run to run, and demanding
 * a run land under a number sampled once would fail on the noise it is meant
 * to tolerate. Plus an absolute floor, because a recorded spread of 0 would
 * otherwise reject every later run for a rounding difference.
 */
export function withinNoiseSpread(
	d: Divergence,
	recorded: number | undefined
): boolean {
	if (recorded === undefined) return true;
	const spread = numericSpread(d);
	if (spread === undefined) return true;

	return spread <= Math.max(recorded * 4, 1);
}

export function bucketize(divergences: Divergence[]): Report {
	const buckets = new Map<
		string,
		{ tier: Tier; count: number; sample: Divergence }
	>();
	for (const d of divergences) {
		const b = buckets.get(d.bucket);
		if (b) b.count++;
		else buckets.set(d.bucket, { tier: d.tier, count: 1, sample: d });
	}
	return { divergences, buckets };
}

const TIER_ORDER: Tier[] = ["T0", "T1", "T2", "T3", "T4"];

export function formatReport(
	report: Report,
	baseline?: Set<string>,
	/**
	 * What the oracle could not reproduce against ITSELF.
	 *
	 * Taken here as well as in the gate because the two were disagreeing in
	 * print: the summary line subtracted noisy buckets and this listing did
	 * not, so a run showed N buckets in full and then said it had fewer. A T0
	 * is never hidden by either -- a guest-observable leak is not something the
	 * oracle can be noisy about.
	 */
	noise?: Set<string>
): string {
	const lines: string[] = [];
	const shown = [...report.buckets.entries()].filter(
		([k, v]) => v.tier === "T0" || (!baseline?.has(k) && !noise?.has(k))
	);
	const suppressed = report.buckets.size - shown.length;

	shown.sort(
		(a, b) =>
			TIER_ORDER.indexOf(a[1].tier) - TIER_ORDER.indexOf(b[1].tier) ||
			b[1].count - a[1].count
	);

	for (const tier of TIER_ORDER) {
		const inTier = shown.filter(([, v]) => v.tier === tier);
		if (!inTier.length) continue;
		lines.push(`\n${tier}  (${inTier.length} buckets)`);
		for (const [key, v] of inTier) {
			const d = v.sample;
			lines.push(`  ${d.kind}  ${d.api}  [${d.class}]  x${v.count}`);
			if (d.oracle !== undefined) lines.push(`      oracle : ${d.oracle}`);
			if (d.sandbox !== undefined) lines.push(`      sandbox: ${d.sandbox}`);
			if (d.detail) lines.push(`      ${d.detail}`);
			lines.push(`      bucket: ${key}`);
		}
	}
	if (suppressed)
		lines.push(
			`\n${suppressed} bucket(s) matched the baseline and were suppressed.`
		);
	if (!shown.length) lines.push("\nNo divergences outside the baseline.");
	return lines.join("\n");
}
