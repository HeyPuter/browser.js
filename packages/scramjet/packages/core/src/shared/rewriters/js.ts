import { flagEnabled, ScramjetContext } from "@/shared";
import { URLMeta } from "@rewriters/url";

import { getRewriter, JsRewriterOutput } from "@rewriters/wasm";
import {
	TextDecoder_decode,
	Crypto_getRandomValues,
	_Uint8Array,
	Object_keys,
	Performance_now,
} from "../snapshot";
import { incumbencyMode } from "@/shared/incumbency";
import type { ScramjetClient } from "@client/index";
import { registerRewrites } from "@client/shared/sourcemaps";

// eslint-disable-next-line scramjet-core/no-globals
Error.stackTraceLimit = 50;

/** the longest source {@link rewriteJs} remembers the rewrite of */
const CACHE_SOURCE_MAX = 65536;
/** how much, in characters, a client's cache holds before it starts over */
const CACHE_TOTAL_MAX = 2 * 1024 * 1024;

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

type RewriterResult = {
	js: string | Uint8Array;
	map: Uint8Array | null;
	tag: string;
	errors: string[];
	/** the PST registration ID the rewrite carries */
	scriptId: string;
};
function rewriteJsWasm(
	input: string | Uint8Array,
	source: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule: boolean,
	inlineSourcemap: boolean,
	handlerPrelude = ""
): RewriterResult {
	const [rewriter, ret] = getRewriter(context, meta);

	const flagsobj = {};
	for (const flag of Object_keys(context.config.flags)) {
		flagsobj[flag] = flagEnabled(flag as any, context);
	}
	// the one flag that is not a boolean, and the rewriter wants the mode this
	// engine can actually do rather than the one that was configured
	flagsobj["incumbency"] = incumbencyMode(context);
	flagsobj["inlineSourcemap"] = inlineSourcemap;
	const scriptId = genScriptId();
	flagsobj["scriptId"] = scriptId;
	// the module's imports are the document's or worker's requests: its own
	// origin, not that of a <base> it may have, nor of the module itself
	flagsobj["initiatorOrigin"] = meta.initiatorOrigin ?? meta.origin.origin;
	flagsobj["handlerPrelude"] = handlerPrelude;

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
		if (flagEnabled("rewriterLogs", context)) {
			dbg.time(meta, before, `oxc rewrite for "${source || "(unknown)"}"`);
		}

		const { js, map, scramtag, errors } = out;

		return {
			js: typeof input === "string" ? TextDecoder_decode(js) : js,
			tag: scramtag,
			map,
			errors,
			scriptId,
		};
	} finally {
		ret();
	}
}

export function rewriteJsInner(
	js: string | Uint8Array,
	url: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule = false
) {
	return rewriteJsWasm(js, url, context, meta, isModule, true);
}

export function rewriteJs(
	js: string | Uint8Array,
	url: string | null,
	context: ScramjetContext,
	meta: URLMeta,
	isModule = false,
	/**
	 * The client rewriting the script, when a client is. It is handed the
	 * sourcemap directly. Without one - the service worker, or code shared
	 * with it - the map goes in the script's prelude, and the script hands it
	 * to its client itself when it runs.
	 */
	client?: ScramjetClient,
	/** see {@link eventHandlerPrelude} */
	handlerPrelude = ""
): string | Uint8Array {
	// a page evaluating the same string again (`Function("return this")`, a
	// timer's string, a template compiled per render) gets the same rewrite:
	// it depends on nothing else here. Per client, since the script's
	// registration and sourcemap are its realm's
	let key: string | undefined;
	if (client && typeof js === "string" && js.length <= CACHE_SOURCE_MAX) {
		key =
			(isModule ? "m\0" : "s\0") +
			(url ?? "") +
			"\0" +
			handlerPrelude +
			"\0" +
			meta.base.href +
			"\0" +
			(meta.initiatorOrigin ?? meta.origin.origin) +
			"\0" +
			js;
		const hit = client.rewriteCache.get(key);
		if (hit !== undefined) return hit;
	}

	try {
		const res = rewriteJsWasm(
			js,
			url,
			context,
			meta,
			isModule,
			!client,
			handlerPrelude
		);

		if (client && flagEnabled("sourcemaps", context)) {
			registerRewrites(client, res.map, res.tag);
		}

		if (flagEnabled("rewriterLogs", context)) {
			for (const error of res.errors) {
				dbg.error("oxc parse error", error);
			}
		}

		if (key !== undefined && typeof res.js === "string") {
			const cache = client!.rewriteCache;
			client!.rewriteCacheSize += key.length + res.js.length;
			if (client!.rewriteCacheSize > CACHE_TOTAL_MAX) {
				cache.clear();
				client!.rewriteCacheSize = key.length + res.js.length;
			}
			cache.set(key, res.js);
		}

		return res.js;
	} catch (err) {
		dbg.warn(
			"failed rewriting js for",
			url || "(unknown)",
			err.message,
			typeof js !== "string" ? TextDecoder_decode(js) : js
		);
		if (flagEnabled("allowInvalidJs", context)) {
			return js;
		} else {
			throw err;
		}
	}
}

/**
 * A script's rewrite as the fetch handler keeps it, to hand out again for the
 * same bytes: the output, and where in it the PST registration ID is (-1
 * when the mode puts none there), so each copy can be given its own. Null
 * when the script does not rewrite, which goes the uncached way and its
 * error handling.
 */
export function rewriteScriptForReuse(
	js: Uint8Array,
	url: string,
	context: ScramjetContext,
	meta: URLMeta,
	isModule: boolean
): { js: Uint8Array; idAt: number } | null {
	let res: RewriterResult;
	try {
		res = rewriteJsWasm(js, url, context, meta, isModule, true);
	} catch {
		return null;
	}
	if (typeof res.js === "string" || res.errors.length) return null;

	return { js: res.js, idAt: indexOfAscii(res.js, res.scriptId) };
}

/** A fresh PST registration ID, written over the one at `at`. */
export function giveNewScriptId(js: Uint8Array, at: number) {
	const id = genScriptId();
	for (let i = 0; i < id.length; i++) js[at + i] = id.charCodeAt(i);
}

function indexOfAscii(bytes: Uint8Array, needle: string): number {
	const first = needle.charCodeAt(0);
	outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
		if (bytes[i] !== first) continue;
		for (let j = 1; j < needle.length; j++)
			if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
		return i;
	}

	return -1;
}

/**
 * Every occurrence of `from` in `bytes` made `to`, in place. The two are the
 * same length: the sourcemap's offsets are into the output, and anything
 * else would move them.
 */
export function replaceAsciiAll(bytes: Uint8Array, from: string, to: string) {
	if (from === to || from.length !== to.length) return;
	for (let at = indexOfAscii(bytes, from); at !== -1;) {
		for (let i = 0; i < to.length; i++) bytes[at + i] = to.charCodeAt(i);
		const next = indexOfAscii(bytes.subarray(at + to.length), from);
		at = next === -1 ? -1 : at + to.length + next;
	}
}
