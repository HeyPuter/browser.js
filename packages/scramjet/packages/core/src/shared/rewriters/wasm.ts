// i am a cat. i like to be petted. i like to be fed. i like to be
import { initSync, Rewriter } from "../../../rewriter/wasm/out/wasm.js";
import type { JsRewriterOutput } from "../../../rewriter/wasm/out/wasm.js";
import { flagEnabled, flagsUrl, ScramjetContext } from "@/shared";

export type { JsRewriterOutput, Rewriter };

import { URLMeta } from "@rewriters/url";
import {
	ArrayBuffer_isView,
	Error,
	TextDecoder_decode,
	WebAssembly_Module,
	_Uint8Array,
} from "@/shared/snapshot";

let wasm_u8: Uint8Array | undefined;
export function setWasm(u8: Uint8Array | ArrayBuffer) {
	wasm_u8 = ArrayBuffer_isView(u8) ? u8 : new _Uint8Array(u8);
}

/**
 * Rewrite with another realm's rewriter rather than instantiating one here. A
 * copy of the bundle evaluated into a popup (see `bundleSource`) takes its
 * opener's: every call into it is synchronous, so it keeps working after the
 * opener's document is gone, and the popup skips decoding and compiling the
 * wasm again.
 */
let adopted: typeof getRewriter | undefined;
export function adoptRewriter(from: typeof getRewriter) {
	adopted = from;
}

/** Whether `getRewriter` has something to rewrite with. */
export function hasRewriter(): boolean {
	return !!(adopted || wasm_u8);
}

const MAGIC = "\0asm".split("").map((x) => x.charCodeAt(0));

function initWasm() {
	if (!wasm_u8)
		throw new Error("rewriter wasm not found (was setWasm called?)");

	if (![...wasm_u8.slice(0, 4)].every((x, i) => x === MAGIC[i]))
		throw new Error(
			"rewriter wasm does not have wasm magic (was it fetched correctly?)\nrewriter wasm contents: " +
				TextDecoder_decode(wasm_u8)
		);

	initSync({
		module: new WebAssembly_Module(wasm_u8 as unknown as BufferSource),
	});
}

type RewriterBox = { rewriter: Rewriter; inUse: boolean };
const rewriters: RewriterBox[] = [];
export function getRewriter(
	context: ScramjetContext,
	meta: URLMeta
): [Rewriter, () => void] {
	if (adopted) return adopted(context, meta);

	initWasm();

	let obj: RewriterBox;
	const index = rewriters.findIndex((x) => !x.inUse);
	const len = rewriters.length;

	if (index === -1) {
		if (flagEnabled("rewriterLogs", context, flagsUrl(meta)))
			dbg.log(`creating new rewriter, ${len} rewriters made already`);

		const rewriter = new Rewriter();
		obj = { rewriter, inUse: false };
		rewriters.push(obj);
	} else {
		obj = rewriters[index];
	}
	obj.inUse = true;

	return [obj.rewriter, () => (obj.inUse = false)];
}
