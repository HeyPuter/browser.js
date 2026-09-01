import { flagEnabled, ScramjetContext } from "@/shared";
import { URLMeta } from "@rewriters/url";

import { getRewriter, JsRewriterOutput } from "@rewriters/wasm";
import {
	TextDecoder_decode,
	TextEncoder_encode,
	RegExp_exec,
	Crypto_getRandomValues,
	String_charCodeAt,
	_RegExp,
	_TextDecoder,
	_Uint8Array,
	Object_keys,
	Performance_now,
	String_substring,
	String_endsWith,
	JSON_stringify,
} from "../snapshot";
import { bytesToBase64 } from "@/shared/util";
import { incumbencyMode } from "@/shared/incumbency";
import { rewriteUrl } from "@rewriters/url";

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
	/** the `//# sourceURL` the original source carried, if any */
	pageSourceUrl: string | null;
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

		const { js, map, scramtag, sourceurl, errors } = out;

		return {
			js: typeof input === "string" ? TextDecoder_decode(js) : js,
			tag: scramtag,
			pageSourceUrl: sourceurl ?? null,
			map,
			errors,
		};
	} finally {
		ret();
	}
}

/**
 * 128 bits of hex. Hex rather than base64url because the value has to survive
 * two places that do not escape: a query string, and the `//# sourceURL` line
 * comment, which ends at the first whitespace or line terminator.
 *
 * `getRandomValues` is taken from the snapshot, not off the live global. A
 * page that replaced `crypto.getRandomValues` would otherwise get to pick
 * every nonce the rewriter generates, which is the whole ballgame.
 */
const NONCE_BYTES = 16;
const HEX = "0123456789abcdef";

function genRealmNonce(): string {
	const bytes = Crypto_getRandomValues(new _Uint8Array(NONCE_BYTES));

	let nonce = "";
	for (let i = 0; i < NONCE_BYTES; i++) {
		nonce += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0xf];
	}

	return nonce;
}

/** what `rewriteUrl` can actually rewrite; anything else names the document */
const absoluteHttp = new _RegExp(/^https?:\/\//i);

/**
 * The name the script answers to in a stack trace, carrying the nonce.
 *
 * Most callers hand the rewriter a real URL, but an inline script or a
 * `javascript:` URL gets a "(inline script element)" style label instead.
 * Those are named by the document that carried them - resolving the label as
 * a relative URL would invent a path that never existed.
 */
function scriptSourceUrl(
	url: string | null,
	nonce: string,
	context: ScramjetContext,
	meta: URLMeta
): string {
	const real = url && RegExp_exec(absoluteHttp, url) ? url : meta.base.href;

	return rewriteUrl(real, context, meta, { nonce });
}

/**
 * V8 takes the *last* `//# sourceURL` in a file and ignores every earlier one,
 * the legacy `//@` spelling included, so appending ours discards whatever the
 * page wrote without scanning the source for it - a scan could not tell a real
 * comment from the same text sitting inside a string literal, and rewriting
 * one of those would change what the script does.
 *
 * Two ways the comment silently does nothing and the frame falls back to the
 * resource URL, which for us means a frame no longer carries its nonce: it has
 * to start its own line, and the value may not contain whitespace.
 */
function sourceUrlComment(url: string): string {
	let safe = "";
	for (let i = 0; i < url.length; i++) {
		const c = String_charCodeAt(url, i);
		// a URL out of `rewriteUrl` is already percent-encoded and should never
		// reach either branch, but the codec is the embedder's to write
		if (c <= 0x20) {
			safe += `%${HEX[c >> 4]}${HEX[c & 0xf]}`;
		} else if (c === 0x2028 || c === 0x2029 || c === 0xfeff) {
			// no single-byte escape for these; a name is worth less than a name
			// the engine throws away
			continue;
		} else {
			safe += url[i];
		}
	}

	return `\n//# sourceURL=${safe}`;
}

/**
 * What gets wrapped around the rewritten script: statements that have to run
 * before it does, and the `//# sourceURL` that names it. Both empty in the
 * common case.
 */
type Wrapping = { prelude: string; epilogue: string };

function buildWrapping(
	res: RewriterResult,
	url: string | null,
	context: ScramjetContext,
	meta: URLMeta
): Wrapping {
	let prelude = "";
	let epilogue = "";

	if (flagEnabled("sourcemaps", context, meta.base)) {
		const pushmap = globalThis[context.config.globals.pushsourcemapfn];
		if (pushmap) {
			// same realm as the consumer: hand over the buffer itself, no
			// serialization round trip at all
			pushmap(res.map, res.tag);
		} else {
			prelude += `${context.config.globals.pushsourcemapfn}("${bytesToBase64(res.map)}","${res.tag}");`;
		}
	}

	const incumbency = incumbencyMode(context, meta.base);
	if (incumbency === "pst" || incumbency === "nonce") {
		const nonce = genRealmNonce();

		// `pageSourceUrl` is a run of non-whitespace out of the page's own
		// source and reaches here verbatim, quotes and backslashes included, so
		// it is emitted as a literal rather than interpolated into one
		prelude += `${context.config.globals.registerrealmfn}("${nonce}","${res.tag}",${JSON_stringify(res.pageSourceUrl)});`;

		// only `nonce` puts the identity somewhere the page can read, and so
		// only `nonce` has anything to emulate back. `pst` reads the script
		// hash that is already on every frame and leaves the source alone
		if (incumbency === "nonce") {
			epilogue = sourceUrlComment(scriptSourceUrl(url, nonce, context, meta));
		}
	}

	return { prelude, epilogue };
}

/** the prologue keeps its own semicolon, or borrows one so the prelude parses */
function afterPrologue(directive: string, prelude: string): string {
	return String_endsWith(directive, ";") ? prelude : `;${prelude}`;
}

function spliceString(js: string, { prelude, epilogue }: Wrapping): string {
	if (!prelude) return js + epilogue;

	const match = RegExp_exec(strictPrologue, js);
	if (!match) return `${prelude}${js}${epilogue}`;

	const at = match[0].length;

	return `${String_substring(js, 0, at)}${afterPrologue(match[0], prelude)}${String_substring(js, at)}${epilogue}`;
}

/**
 * Splicing as bytes keeps a script that arrived as bytes from making a round
 * trip through a UTF-16 string it would only be encoded back out of, and gets
 * both ends done in one allocation.
 */
function spliceBytes(js: Uint8Array, { prelude, epilogue }: Wrapping) {
	const head = prelude
		? headDecoder.decode(js.subarray(0, PROLOGUE_SCAN_BYTES))
		: "";
	const match = prelude ? RegExp_exec(strictPrologue, head) : null;

	const insert = TextEncoder_encode(
		prelude ? (match ? afterPrologue(match[0], prelude) : prelude) : ""
	);
	// the directive is ASCII, but the whitespace before it need not be, so the
	// split point has to be measured in bytes rather than in characters
	const at = match ? TextEncoder_encode(match[0]).length : 0;
	const tail = TextEncoder_encode(epilogue);

	const out = new _Uint8Array(js.length + insert.length + tail.length);
	out.set(js.subarray(0, at));
	out.set(insert, at);
	out.set(js.subarray(at), at + insert.length);
	out.set(tail, js.length + insert.length);

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
		const wrapping = buildWrapping(res, url, context, meta);

		if (flagEnabled("rewriterLogs", context, meta.base)) {
			for (const error of res.errors) {
				dbg.error("oxc parse error", error);
			}
		}

		if (!wrapping.prelude && !wrapping.epilogue) return res.js;

		return typeof res.js === "string"
			? spliceString(res.js, wrapping)
			: spliceBytes(res.js, wrapping);
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
