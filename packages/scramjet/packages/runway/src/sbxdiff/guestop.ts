/**
 * Reading guest ops back out of a trace.
 *
 * The recorder (`harness/scramjet/public/sbxdiff-guestop.js`) writes chunks of
 * events through `document.createComment`, so they arrive as ordinary
 * `Document.createComment` binding records with a marked string argument. This
 * decodes them, and maps scramjet's spelling of a member onto the tracer's, so
 * a sandbox guest op can be held up against the oracle's binding call for the
 * same API.
 *
 * ## Why the two spellings differ
 *
 * scramjet names a member the way the call site registered it --
 * `Element.prototype.setAttribute`, `get Location.href`, `HTMLElement.style`.
 * The tracer names it the way `bind_gen` does -- `Element.setAttribute`,
 * `Location.href.get`, `HTMLElement.style.get`. Neither is wrong; they are
 * different vocabularies for the same member, and something has to translate.
 * It happens here rather than in the recorder so that fixing a mapping is a
 * one-second offline re-diff rather than a browser run.
 *
 * A member that does not map is NOT silently dropped -- it is reported as
 * unmapped, with its count. An unmapped member reads as "the sandbox never did
 * this", which is the exact failure this whole layer exists to remove.
 */

import { Kind, Tag, type Trace, type Value } from "./trace.ts";

/** The worker sink's scheme. See the recorder for why a URL. */
const URL_SINK = "sbxgop:";

/** Marker the recorder prefixes each chunk with. */
const MARK = "sbxgop";
const SEP = "";

export type GuestValue =
	| { t: "undefined" }
	| { t: "null" }
	| { t: "bool"; v: boolean }
	| { t: "number"; v: number }
	| { t: "bigint"; v: string }
	| { t: "symbol" }
	| { t: "string"; s: string; len: number; hash?: string; truncated: boolean }
	| { t: "object"; id: number }
	| { t: "function"; id: number };

export type GuestOp = {
	/** Monotonic per realm, from the recorder. Global order within a realm. */
	n: number;
	realm: number;
	/** `get` | `set` | `call` | `construct`. */
	op: string;
	/** scramjet's own name for the member. */
	member: string;
	/** The tracer's name for the same member, or null when unmapped. */
	api: string | null;
	result: GuestValue;
	threw: boolean;
	args: GuestValue[];
	/** Set when the recorder saw the sandbox in a value the guest received. */
	leak: "proxy" | "chrome-origin" | "shim-identity" | null;
	/** True when the line itself overran a chunk and was cut. */
	overlong: boolean;
	/** The binding tracer cannot record this API, so it has no counterpart. */
	untraced: boolean;
};

/** UTF-8 byte length, the unit the tracer reports a string's size in. */
function utf8Length(s: string): number {
	// eslint-disable-next-line no-control-regex
	if (!/[^\x00-\x7f]/.test(s)) return s.length;

	return Buffer.byteLength(s, "utf8");
}

function decodeValue(raw: string): { v: GuestValue; leak: GuestOp["leak"] } {
	let leak: GuestOp["leak"] = null;
	let s = raw;
	if (s.startsWith("!")) {
		leak =
			s[1] === "p" ? "proxy" : s[1] === "c" ? "chrome-origin" : "shim-identity";
		s = s.slice(2);
	}
	const unesc = (x: string) =>
		x.replace(/\\(\\|p|x[0-9a-f]+)/g, (_, g: string) =>
			g === "\\"
				? "\\"
				: g === "p"
					? "|"
					: String.fromCharCode(parseInt(g.slice(1), 16))
		);

	if (s === "N") return { v: { t: "null" }, leak };
	if (s === "U") return { v: { t: "undefined" }, leak };
	if (s === "B1") return { v: { t: "bool", v: true }, leak };
	if (s === "B0") return { v: { t: "bool", v: false }, leak };
	if (s === "Y") return { v: { t: "symbol" }, leak };
	if (s[0] === "#") return { v: { t: "number", v: Number(s.slice(1)) }, leak };
	if (s[0] === "G") return { v: { t: "bigint", v: s.slice(1) }, leak };
	if (s[0] === '"') {
		const body = unesc(s.slice(1));

		// The tracer measures a string in UTF-8 BYTES, so an untruncated value
		// has to be measured the same way or every non-ASCII string reads as a
		// length divergence. The recorder does this itself for a truncated one,
		// where it is the only side that still has the whole string.
		return {
			v: { t: "string", s: body, len: utf8Length(body), truncated: false },
			leak,
		};
	}
	if (s[0] === "~") {
		// `~<len>,<hash>,"<prefix>`
		const c1 = s.indexOf(",");
		const c2 = s.indexOf(',"', c1 + 1);

		return {
			v: {
				t: "string",
				s: unesc(s.slice(c2 + 2)),
				len: Number(s.slice(1, c1)),
				hash: s.slice(c1 + 1, c2),
				truncated: true,
			},
			leak,
		};
	}
	if (s[0] === "O") return { v: { t: "object", id: Number(s.slice(1)) }, leak };
	if (s[0] === "F")
		return { v: { t: "function", id: Number(s.slice(1)) }, leak };

	return { v: { t: "symbol" }, leak };
}

/** The op `sbxdiff-guestop.js` records a scramjet-built error under. */
export const THROW_OP = "throw";

/**
 * scramjet member + op -> the tracer's API name.
 *
 * Mechanical, in this order:
 *
 *   `get Foo.bar` / `set Foo.bar`   the `Intercept` spelling, op in front
 *   `Foo.prototype.bar`             the `Trap`/`Proxy` spelling
 *   `window.foo` / `foo`            a global
 *
 * then `.get` / `.set` appended for an accessor, nothing for a method. The
 * tracer spells the global scope `Window`, and an interface's members without
 * `prototype`.
 */
export function apiNameFor(member: string, op: string): string | null {
	// A throw is not a call and has no binding to pair with: it is recorded
	// where scramjet BUILDS the error, at a point the oracle reaches by having
	// Blink throw instead. `exceptions.ts` compares the two streams by text.
	// Returning a name here would pair `Error.SecurityError.throw` against
	// nothing and report the sandbox making a call the oracle never made.
	if (op === THROW_OP) return null;
	let m = member.trim();
	// `Intercept` puts the op in front for an accessor half.
	const lead = /^(get|set) (.+)$/.exec(m);
	if (lead) m = lead[2];
	m = m.replace(".prototype.", ".");
	// A bare global: scramjet writes `window.foo` or just `foo`.
	if (!m.includes(".")) m = `Window.${m}`;
	else if (m.startsWith("window.")) m = `Window.${m.slice("window.".length)}`;
	else if (m.startsWith("self.")) m = `Window.${m.slice("self.".length)}`;
	if (!/^[A-Za-z_$][\w$]*\.[\w$]+$/.test(m)) return null;
	// A construction. The tracer spells every one of them `<Interface>
	// .constructor`, whatever the call site called the member: scramjet
	// registers `Window.FormData` (the global), `Function.constructor` (the
	// prototype slot) and `Request.constructor` (the class replacement) for what
	// the oracle records identically.
	if (op === "construct") {
		const iface = m
			.replace(/\.constructor$/, "")
			.split(".")
			.pop();

		return iface ? `${iface}.constructor` : null;
	}
	if (op !== "call") return `${m}.${op}`;
	// Calling a global whose name is an interface is construction, and that is
	// how the tracer spells it: the guest op reads `Window.URL`, the oracle's
	// binding record reads `URL.constructor`. Without this the two never pair
	// and the sandbox's `new URL(...)` is reported as a call the oracle never
	// made -- which is the opposite of true, the oracle made it constantly.
	const global = /^Window\.([A-Z][\w$]*)$/.exec(m);
	if (global) return `${global[1]}.constructor`;

	return m;
}

/**
 * Namespaces the binding tracer cannot see, by construction.
 *
 * `bind_gen` instruments Web IDL. `Function.prototype.toString`, `eval`,
 * `console.*` and the rest of the ECMAScript surface are V8 builtins with no
 * Blink binding behind them, so the ORACLE has no record of them at any tier --
 * not "did not call", but "cannot record".
 *
 * scramjet traps several of them (`shared/function.ts`,
 * `shared/sourcemaps.ts`, `shared/antiantidebugger.ts`), so the guest-op
 * recorder does see them. Compared against an oracle that structurally cannot,
 * they read as calls the oracle never made: measured on rateyourmusic,
 * `Function.toString` at 1121 sandbox calls against 0, reported as the largest
 * `extra-call` in the run and meaning nothing at all.
 *
 * Counted, never silently dropped -- see `guestOpStats().untraced`.
 */
const UNTRACED_NAMESPACES = [
	"Function.",
	"console.",
	"Object.",
	"Array.",
	"JSON.",
	"Reflect.",
	"Promise.",
	"Window.eval",
	"Window.Function",
];

export function isUntracedApi(api: string): boolean {
	return UNTRACED_NAMESPACES.some((p) => api.startsWith(p));
}

/**
 * Every guest op in a trace, in order, with the realm it happened in.
 *
 * Realm comes from the `createComment` record that carried it, which is the
 * realm the recorder ran in -- one recorder per document, so this is exact.
 */
export function guestOps(trace: Trace): GuestOp[] {
	const out: GuestOp[] = [];
	for (const r of trace.records) {
		if (r.kind !== Kind.BindingCall) continue;
		// Two sinks, because a worker has no document: `createComment` in a
		// document, `new URL("sbxgop:...")` everywhere else. Both are traced
		// bindings that record their string ARGUMENT, which is what makes them
		// usable -- the URL parser normalizes its result and the trace never
		// sees it.
		if (r.name !== "Document.createComment" && r.name !== "URL.constructor") {
			continue;
		}
		const a = r.args[0];
		if (!a || a.t !== 4 /* Tag.String */) continue;
		if (r.name === "URL.constructor") {
			if (!a.s.startsWith(URL_SINK)) continue;
			for (const line of a.s.slice(URL_SINK.length + MARK.length).split(SEP)) {
				const op = decodeLine(line, r.realm);
				if (op) out.push(op);
			}
			continue;
		}
		if (!a.s.startsWith(MARK)) continue;
		// A chunk the tracer truncated is a chunk whose last event is a lie.
		// The recorder keeps chunks under the tracer's 512-byte cap so this
		// should never fire; if it does, the cap moved and the count says so.
		const body = a.s.slice(MARK.length);
		for (const line of body.split(SEP)) {
			const op = decodeLine(line, r.realm);
			if (op) out.push(op);
		}
	}

	return out;
}

function decodeLine(line: string, realm: number): GuestOp | null {
	const overlong = line.endsWith("");
	const body = overlong ? line.slice(0, -1) : line;
	const parts = body.split(/(?<!\\)\|/);
	if (parts.length < 4) return null;
	const n = Number(parts[0]);
	const op = parts[1];
	const member = parts[2];
	let resultRaw = parts[3];
	const threw =
		resultRaw.startsWith("!") && !/^![pcs]/.test(resultRaw) ? true : false;
	// `!` is both "threw" and the leak prefix. The leak prefix is always
	// followed by one of p/c/s and then a value tag; a throw marker is followed
	// by a value tag directly. Ordered so a thrown value can still carry a leak.
	if (threw) resultRaw = resultRaw.slice(1);
	const { v: result, leak: rLeak } = decodeValue(resultRaw);
	const args: GuestValue[] = [];
	let leak = rLeak;
	for (const raw of parts.slice(4)) {
		if (raw.startsWith("+")) continue; // "+N more arguments"
		const { v, leak: l } = decodeValue(raw);
		args.push(v);
		// An argument leak is the guest HANDING scramjet a proxied value, which
		// is not the sandbox revealing itself. Only a result leak is T0, so the
		// op's leak flag stays with the result.
		void l;
	}

	const api = apiNameFor(member, op);

	return {
		n,
		realm,
		op,
		member,
		api,
		result,
		threw,
		args,
		leak,
		overlong,
		untraced: !!api && isUntracedApi(api),
	};
}

/** `fmt` for a guest value, in the same shape `diff.ts` prints a traced one. */
export function fmtGuest(v: GuestValue): string {
	switch (v.t) {
		case "undefined":
			return "undefined";
		case "null":
			return "null";
		case "bool":
			return String(v.v);
		case "number":
			return Object.is(v.v, -0) ? "-0" : String(v.v);
		case "bigint":
			return "bigint";
		case "symbol":
			return "symbol";
		case "string":
			return v.truncated
				? `string(${v.len})${JSON.stringify(v.s)}…#${v.hash}`
				: `string(${v.len})${JSON.stringify(v.s)}`;
		case "object":
			return `object#${v.id}`;
		case "function":
			return `function#${v.id}`;
	}
}

export type GuestOpStats = {
	total: number;
	byRealm: Map<number, number>;
	unmapped: Map<string, number>;
	overlong: number;
	leaks: GuestOp[];
	/** On APIs the binding tracer cannot record. Excluded from the diff. */
	untraced: Map<string, number>;
};

export function guestOpStats(ops: GuestOp[]): GuestOpStats {
	const byRealm = new Map<number, number>();
	const unmapped = new Map<string, number>();
	const untraced = new Map<string, number>();
	let overlong = 0;
	const leaks: GuestOp[] = [];
	for (const o of ops) {
		byRealm.set(o.realm, (byRealm.get(o.realm) ?? 0) + 1);
		if (!o.api) unmapped.set(o.member, (unmapped.get(o.member) ?? 0) + 1);
		else if (o.untraced) untraced.set(o.api, (untraced.get(o.api) ?? 0) + 1);
		if (o.overlong) overlong++;
		if (o.leak) leaks.push(o);
	}

	return { total: ops.length, byRealm, unmapped, overlong, leaks, untraced };
}

/**
 * A guest value in the trace decoder's vocabulary, so the differ can hold one
 * up against a binding call's without knowing where it came from.
 *
 * A long string is the one lossy case and it is lossy on BOTH sides: the
 * tracer keeps the first 512 bytes with the true length, the recorder keeps
 * the first 48 with the true length and a hash of the whole. So `truncated`
 * is set and the comparison is on length and the common prefix -- comparing
 * past the shorter of two truncations compares the instruments, not the run.
 */
export function toTraceValue(v: GuestValue): Value {
	switch (v.t) {
		case "undefined":
			return { t: Tag.Undefined };
		case "null":
			return { t: Tag.Null };
		case "bool":
			return { t: Tag.Bool, v: v.v };
		case "number":
			return { t: Tag.Number, v: v.v };
		case "bigint":
			return { t: Tag.BigInt };
		case "symbol":
			return { t: Tag.Symbol };
		case "string":
			return { t: Tag.String, s: v.s, len: v.len, truncated: v.truncated };
		case "object":
			// Ids are the recorder's own namespace, not the tracer's. They pair
			// through their own bijection on the guest-op layer; they must never
			// be compared against a tracer id, which is why they are `Object`
			// and not `DomWrapper` -- the differ treats those positionally.
			return { t: Tag.Object, id: v.id };
		case "function":
			return { t: Tag.Function, id: v.id };
	}
}
