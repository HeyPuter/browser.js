/**
 * The errors each side THREW, compared by their text.
 *
 * Error messages are a first-class fingerprinting surface and the challenge
 * reads them on purpose. Measured on rateyourmusic, the oracle throws four
 * distinct errors and every one of them is Cloudflare provoking it deliberately:
 * three invalid selectors handed to `querySelector` (ten times each, once per
 * realm) and a cross-origin `history.pushState` to `https://example.org/` --
 * calls made for no reason except to be refused, so that the wording of the
 * refusal can be read. The blob workers then do
 *
 *     try { fetch("https://brunhild.challenges.cloudflare.com/...") }
 *     catch (e) { postMessage({ gQTuX1: String(e) }) }
 *
 * against a host that resolves nowhere for anybody -- the request exists to
 * fail, and what is graded is the shape of the failure. A message that names
 * the proxy loses the run outright; a message that merely differs is a signal.
 *
 * None of this was compared. `diff.ts` has declared an `exception-divergence`
 * kind since the beginning and nothing has ever produced one; the only reader
 * of `Kind.Exception` was `cfdiverge.ts`, which discards the text
 * (`detail: ""`). The gate was blind to the entire class.
 *
 * Two streams, because an error reaches the guest by two roads and each side
 * favours a different one:
 *
 *   - `kException`, from the C++ tracer, is what a BLINK BINDING threw. The
 *     oracle's errors are nearly all of these.
 *   - a guest op with op `throw`, from `NativeErrors.stamp`, is what SCRAMJET
 *     built. An API scramjet handles in JS never reaches the binding, so the
 *     sandbox throws there instead and the tracer sees nothing: 3 exception
 *     records against the oracle's 31, most of the gap being interception
 *     rather than behaviour.
 *
 * Comparing one stream against the other would report every intercepted throw
 * as missing, so both are read on both sides and merged.
 */

import { Kind, type Record_ } from "./trace.ts";
import { THROW_OP, type GuestOp } from "./guestop.ts";
import {
	bucketize,
	type Divergence,
	type LeakMarkers,
	type Report,
} from "./diff.ts";

export type ThrownError = {
	/** `binding` -- Blink threw it. `shim` -- scramjet built it. */
	source: "binding" | "shim";
	/** DOMException name where one is known, else "". */
	name: string;
	message: string;
};

/** Every error one side threw, from both roads. */
export function thrownErrors(
	records: Record_[],
	ops: GuestOp[]
): ThrownError[] {
	const out: ThrownError[] = [];
	for (const r of records) {
		if (r.kind !== Kind.Exception) continue;
		out.push({ source: "binding", name: "", message: r.message });
	}
	for (const o of ops) {
		if (o.op !== THROW_OP) continue;
		// `Error.<name>`, and the message is the single recorded argument.
		const name = o.member.startsWith("Error.")
			? o.member.slice("Error.".length)
			: o.member;
		const a = o.args[0];
		out.push({
			source: "shim",
			name,
			message: a && a.t === "string" ? a.s : "",
		});
	}

	return out;
}

/**
 * Blink's context decoration, which only ONE of the two streams carries.
 *
 * `ExceptionState::SetExceptionInfo` is where the C++ tracer takes its copy,
 * and it runs BEFORE `DOMException::AddContextToMessages` --
 * `v8_binding_for_core.cc` decorates the exception on its way out of the
 * binding. So a `kException` record holds
 *
 *     A history state object with URL '...' cannot be created in a ...
 *
 * where the page catches
 *
 *     Failed to execute 'pushState' on 'History': A history state object ...
 *
 * scramjet builds the finished message, prefix and all, so its guest-op record
 * has the decoration the oracle's record does not. Comparing them unstripped
 * pairs nothing and reports every intercepted throw as a divergence -- the two
 * instruments recording at different layers, which is the error ARCHITECTURE.md
 * exists to warn about, and it is what this differ did on its first run.
 *
 * So the prefix comes off for PAIRING only. It is still in the text that gets
 * reported and still in the text the leak scan reads; it simply cannot be
 * compared across the two layers, because the oracle never recorded its own.
 */
export function stripBindingContext(message: string): string {
	return message.replace(
		/^Failed to (?:execute '[^']*' on '[^']*'|construct '[^']*'|read the '[^']*' property from '[^']*'|set the '[^']*' property on '[^']*'|enumerate the '[^']*' properties|get(?: indexed)? property '[^']*' from '[^']*'|set(?: indexed)? property '[^']*' on '[^']*'): /,
		""
	);
}

/**
 * The part of a message that identifies WHICH error this is.
 *
 * Messages embed the values they are about, and those legitimately differ
 * between two runs of the same site -- a ray id, a nonce, a URL the two sides
 * spell differently on purpose. Pairing on the literal text would leave every
 * message unpaired on both sides and report the union as divergent.
 *
 * So pairing is on the shape and the literal text is compared WITHIN the pair.
 * That ordering matters: the proxy's origin appears exactly where the site's
 * origin appears on the oracle, so a normaliser aggressive enough to pair the
 * two is aggressive enough to hide the leak it exists to find. Quoted runs and
 * digits are replaced for pairing only; nothing is dropped from what is
 * reported.
 */
export function shapeOf(message: string): string {
	return stripBindingContext(message)
		.replace(/'[^']*'/g, "'~'")
		.replace(/"[^"]*"/g, '"~"')
		.replace(/\d+/g, "#")
		.replace(/\s+/g, " ")
		.trim();
}

/** The first leak marker `message` carries, or null. */
export function leakInMessage(
	message: string,
	markers: LeakMarkers
): string | null {
	if (markers.chromeOrigin && message.includes(markers.chromeOrigin)) {
		return markers.chromeOrigin;
	}
	if (markers.proxyPrefix && message.includes(markers.proxyPrefix)) {
		return markers.proxyPrefix;
	}
	for (const id of markers.shimIdentifiers) {
		if (id && message.includes(id)) return id;
	}

	return null;
}

type Group = {
	n: number;
	/**
	 * Keyed by the message with Blink's context prefix removed.
	 *
	 * The decoration is present on one stream and absent on the other by
	 * construction, so comparing texts that still carry it reports the LAYER
	 * rather than the behaviour -- the same trap `stripBindingContext` exists
	 * for, one step further in.
	 */
	texts: Map<string, number>;
	/** The messages as recorded, for a report that should show what was seen. */
	raw: string[];
};

/** A literal message from a group, so a report names the error it is about. */
const sampleOf = (g: Group) => g.raw[0] ?? "";

function group(errors: ThrownError[]): Map<string, Group> {
	const by = new Map<string, Group>();
	for (const e of errors) {
		const key = shapeOf(e.message);
		let g = by.get(key);
		if (!g) {
			g = { n: 0, texts: new Map(), raw: [] };
			by.set(key, g);
		}
		g.n++;
		g.raw.push(e.message);
		const text = stripBindingContext(e.message);
		g.texts.set(text, (g.texts.get(text) ?? 0) + 1);
	}

	return by;
}

const preview = (s: string, n = 120) =>
	s.length <= n ? s : `${s.slice(0, n)}~`;

export function diffExceptions(
	oracle: ThrownError[],
	sandbox: ThrownError[],
	markers: LeakMarkers
): Report {
	const out: Divergence[] = [];
	const o = group(oracle);
	const s = group(sandbox);

	// A message that names the proxy is a leak whatever the oracle did, so this
	// runs over the sandbox's own errors and does not need a pair.
	for (const e of sandbox) {
		const marker = leakInMessage(e.message, markers);
		if (!marker) continue;
		const api = `Error.${e.name || "thrown"}`;
		out.push({
			tier: "T0",
			kind: "leak",
			api,
			at: 0,
			oracle: "(no such string)",
			sandbox: preview(e.message, 200),
			detail: `error text carries ${JSON.stringify(marker)}`,
			class:
				marker === markers.chromeOrigin
					? "chrome-origin-leak"
					: marker === markers.proxyPrefix
						? "proxy-url-leak"
						: "shim-identity-leak",
			bucket: `T0|leak|${api}|${marker}`,
		});
	}

	for (const [shape, og] of o) {
		const key = preview(shape, 80);
		const sg = s.get(shape);
		if (!sg) {
			// A browser refused something the sandbox allowed. This is the shape
			// a missing boundary makes: the call succeeds, so there is no error
			// to compare and nothing else notices either.
			out.push({
				tier: "T1",
				kind: "exception-divergence",
				api: key,
				at: 0,
				oracle: `threw ${og.n}x -- ${preview(sampleOf(og), 150)}`,
				sandbox: "never threw",
				class: "count",
				bucket: `T1|exception-divergence|${key}|absent`,
			});
			continue;
		}
		if (og.n !== sg.n) {
			out.push({
				tier: "T1",
				kind: "exception-divergence",
				api: key,
				at: 0,
				oracle: `threw ${og.n}x`,
				sandbox: `threw ${sg.n}x`,
				class: "count",
				bucket: `T1|exception-divergence|${key}|count`,
			});
		}
		// Same error, different words. Pairing is by shape, so the two texts
		// here are the same error about different values -- which is exactly
		// where an origin or a URL the sandbox spells differently shows up.
		const otexts = [...og.texts.keys()].sort();
		const stexts = [...sg.texts.keys()].sort();
		if (JSON.stringify(otexts) !== JSON.stringify(stexts)) {
			out.push({
				tier: "T1",
				kind: "exception-divergence",
				api: key,
				at: 0,
				oracle: preview(sampleOf(og)),
				sandbox: preview(sampleOf(sg)),
				class: "other",
				bucket: `T1|exception-divergence|${key}|text`,
			});
		}
	}

	for (const [shape, sg] of s) {
		if (o.has(shape)) continue;
		const key = preview(shape, 80);
		out.push({
			tier: "T1",
			kind: "exception-divergence",
			api: key,
			at: 0,
			oracle: "never threw",
			sandbox: `threw ${sg.n}x -- ${preview(sampleOf(sg), 150)}`,
			class: "novelty",
			bucket: `T1|exception-divergence|${key}|extra`,
		});
	}

	return bucketize(out);
}

export function formatExceptions(
	oracle: ThrownError[],
	sandbox: ThrownError[],
	report: Report
): string[] {
	const lines: string[] = [];
	const count = (e: ThrownError[], src: string) =>
		e.filter((x) => x.source === src).length;
	lines.push(
		`  thrown errors: oracle ${oracle.length} ` +
			`(${count(oracle, "binding")} binding, ${count(oracle, "shim")} shim), ` +
			`sandbox ${sandbox.length} ` +
			`(${count(sandbox, "binding")} binding, ${count(sandbox, "shim")} shim)`
	);
	if (!report.divergences.length) {
		lines.push(`    the two sides threw the same errors`);

		return lines;
	}
	for (const [, b] of [...report.buckets].sort(
		(a, c) => c[1].count - a[1].count
	)) {
		const d = b.sample;
		lines.push(
			`    ${b.tier} ${d.kind}${b.count > 1 ? ` x${b.count}` : ""}  ${d.api}`
		);
		lines.push(`         oracle : ${d.oracle}`);
		lines.push(`         sandbox: ${d.sandbox}`);
		if (d.detail) lines.push(`         ${d.detail}`);
	}

	return lines;
}
