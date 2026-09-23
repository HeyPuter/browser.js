import { flagEnabled, ScramjetContext } from "@/shared";
import { URLMeta } from "@rewriters/url";

import { getRewriter, JsRewriterOutput } from "@rewriters/wasm";
import {
	TextDecoder_decode,
	TextEncoder_encode,
	RegExp_exec,
	Crypto_getRandomValues,
	_RegExp,
	_TextDecoder,
	_Uint8Array,
	Object_keys,
	Performance_now,
	String_substring,
	String_endsWith,
} from "../snapshot";
import { bytesToBase64 } from "@/shared/util";
import { incumbencyMode } from "@/shared/incumbency";

// eslint-disable-next-line scramjet-core/no-globals
Error.stackTraceLimit = 50;

/**
 * The prelude has to go after a "use strict" directive, not before it, or the
 * script silently stops being strict. Only whitespace may precede the
 * directive, so matching it never has to scan far into the source.
 *
 * Wherever it lands it goes on the line that was already there, never on a new
 * one. The rewriter itself only ever inserts inline, so every line number in a
 * stack trace survives rewriting - and a prelude on its own line would shift
 * all of them by one and give the proxy away.
 */
const strictPrologue = new _RegExp(/^\s*(['"])use strict\1;?/);
/** enough head to cover any realistic run of leading whitespace */
const PROLOGUE_SCAN_BYTES = 256;
/**
 * The shared decoder drops a leading BOM, which would leave its three bytes
 * unaccounted for when the match is measured back out into a byte offset.
 * Keeping it makes it just another character `\s*` eats.
 */
const headDecoder = new _TextDecoder("utf-8", { ignoreBOM: true });

type RewriterResult = {
	js: string | Uint8Array;
	map: Uint8Array | null;
	tag: string;
	errors: string[];
};
function rewriteJsWasm(
	input: string | Uint8Array,
	source: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule: boolean
): RewriterResult {
	const [rewriter, ret] = getRewriter(context, meta);

	const flagsobj = {};
	for (const flag of Object_keys(context.config.flags)) {
		flagsobj[flag] = flagEnabled(flag as any, context, meta.base);
	}
	// the one flag that is not a boolean, and the rewriter wants the mode this
	// engine can actually do rather than the one that was configured
	flagsobj["incumbency"] = incumbencyMode(context, meta.base);

	try {
		let out: JsRewriterOutput;
		const before = Performance_now();
		const globals = {
			...context.config.globals,
			prefix: context.prefix.pathname,
		};
		if (typeof input === "string") {
			out = rewriter.rewrite_js(
				globals,
				flagsobj,
				context.interface.codecEncode,
				input,
				meta.base.href,
				source || "(unknown)",
				isModule
			);
		} else {
			out = rewriter.rewrite_js_bytes(
				globals,
				flagsobj,
				context.interface.codecEncode,
				input,
				meta.base.href,
				source || "(unknown)",
				isModule
			);
		}
		if (flagEnabled("rewriterLogs", context, meta.base)) {
			dbg.time(meta, before, `oxc rewrite for "${source || "(unknown)"}"`);
		}

		const { js, map, scramtag, errors } = out;

		return {
			js: typeof input === "string" ? TextDecoder_decode(js) : js,
			tag: scramtag,
			map,
			errors,
		};
	} finally {
		ret();
	}
}

/** A private PST registration ID, generated independently for each rewrite. */
const SCRIPT_ID_BYTES = 16;
const HEX = "0123456789abcdef";

function genScriptId(): string {
	const bytes = Crypto_getRandomValues(new _Uint8Array(SCRIPT_ID_BYTES));
	let id = "";
	for (let i = 0; i < SCRIPT_ID_BYTES; i++) {
		id += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0xf];
	}
	return id;
}

function buildPrelude(
	res: RewriterResult,
	context: ScramjetContext,
	meta: URLMeta
): string {
	let prelude = "";

	if (flagEnabled("sourcemaps", context, meta.base)) {
		const pushmap = globalThis[context.config.globals.pushsourcemapfn];
		if (pushmap) {
			// Same realm as the consumer: hand over the buffer directly.
			pushmap(res.map, res.tag);
		} else {
			prelude += `${context.config.globals.pushsourcemapfn}("${bytesToBase64(res.map)}","${res.tag}");`;
		}
	}

	if (incumbencyMode(context, meta.base) === "pst") {
		prelude += `${context.config.globals.registerrealmfn}("${genScriptId()}","${res.tag}");`;
	}

	return prelude;
}

/** the prologue keeps its own semicolon, or borrows one so the prelude parses */
function afterPrologue(directive: string, prelude: string): string {
	return String_endsWith(directive, ";") ? prelude : `;${prelude}`;
}

function spliceString(js: string, prelude: string): string {
	const match = RegExp_exec(strictPrologue, js);
	if (!match) return `${prelude}${js}`;

	const at = match[0].length;

	return `${String_substring(js, 0, at)}${afterPrologue(match[0], prelude)}${String_substring(js, at)}`;
}

/**
 * Splicing as bytes keeps a script that arrived as bytes from making a round
 * trip through a UTF-16 string it would only be encoded back out of, and gets
 * the insertion done in one allocation.
 */
function spliceBytes(js: Uint8Array, prelude: string) {
	const head = headDecoder.decode(js.subarray(0, PROLOGUE_SCAN_BYTES));
	const match = RegExp_exec(strictPrologue, head);

	const insert = TextEncoder_encode(
		match ? afterPrologue(match[0], prelude) : prelude
	);
	// the directive is ASCII, but the whitespace before it need not be, so the
	// split point has to be measured in bytes rather than in characters
	const at = match ? TextEncoder_encode(match[0]).length : 0;

	const out = new _Uint8Array(js.length + insert.length);
	out.set(js.subarray(0, at));
	out.set(insert, at);
	out.set(js.subarray(at), at + insert.length);

	return out;
}

export function rewriteJsInner(
	js: string | Uint8Array,
	url: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule = false
) {
	return rewriteJsWasm(js, url, context, meta, isModule);
}

export function rewriteJs(
	js: string | Uint8Array,
	url: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule = false
): string | Uint8Array {
	try {
		const res = rewriteJsInner(js, url, context, meta, isModule);
		const prelude = buildPrelude(res, context, meta);

		if (flagEnabled("rewriterLogs", context, meta.base)) {
			for (const error of res.errors) {
				dbg.error("oxc parse error", error);
			}
		}

		if (!prelude) return res.js;

		return typeof res.js === "string"
			? spliceString(res.js, prelude)
			: spliceBytes(res.js, prelude);
	} catch (err) {
		dbg.warn(
			"failed rewriting js for",
			url || "(unknown)",
			err.message,
			typeof js !== "string" ? TextDecoder_decode(js) : js
		);
		if (flagEnabled("allowInvalidJs", context, meta.base)) {
			return js;
		} else {
			throw err;
		}
	}
}
