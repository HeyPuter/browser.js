import { BareResponse } from "@mercuryworkshop/proxy-transports";
import {
	BodyType,
	ScramjetFetchHandler,
	ScramjetFetchParsed,
	ScramjetFetchRequest,
} from ".";
import {
	flagEnabled,
	isHtmlMimeType,
	isJavascriptMimeType,
	rewriteCss,
	rewriteHtml,
	rewriteJs,
	rewriteWorkers,
} from "@/shared";
import {
	StreamingHtmlRewriter,
	htmlRewriterHooked,
} from "@/shared/rewriters/html";
import {
	giveNewScriptId,
	replaceAsciiAll,
	rewriteScriptForReuse,
} from "@/shared/rewriters/js";
import { sniffEncoding } from "@/shared/sniffEncoding";
import { documentReferrer } from "./headers";
import {
	TextDecoder_decode,
	TextEncoder_encode,
	_TextDecoder,
	_Uint8Array,
} from "@/shared/snapshot";

export async function rewriteBody(
	handler: ScramjetFetchHandler,
	request: ScramjetFetchRequest,
	parsed: ScramjetFetchParsed,
	response: BareResponse
): Promise<BodyType> {
	switch (parsed.destination) {
		case "iframe":
		case "document":
			if (
				isHtmlMimeType(response.headers.get("content-type") ?? "") &&
				response.body &&
				!htmlRewriterHooked(handler.context)
			) {
				return streamHtml(
					response.body as ReadableStream<Uint8Array>,
					response.headers.get("content-type"),
					new StreamingHtmlRewriter(handler.context, parsed.meta, {
						loadScripts: true,
						inline: true,
						source: parsed.url.href,
						headers: response.rawHeaders,
						referrer: documentReferrer(parsed),
					})
				);
			}
			if (isHtmlMimeType(response.headers.get("content-type") ?? "")) {
				const buf = await response.arrayBuffer();
				const bytes = new _Uint8Array(buf);
				const encoding = sniffEncoding(
					bytes,
					response.headers.get("content-type")
				);
				const htmlContent = new _TextDecoder(encoding).decode(bytes);

				return rewriteHtml(htmlContent, handler.context, parsed.meta, {
					loadScripts: true,
					inline: true,
					source: parsed.url.href,
					headers: response.rawHeaders,
					referrer: documentReferrer(parsed),
				});
			} else {
				return response.body;
			}
		case "script": {
			// do not attempt to rewrite a 404 response
			if (response.ok) {
				const ct = response.headers.get("content-type");
				// don't rewrite invalid module scripts when the server declares a non-JS type
				if (parsed.isModule && ct && !isJavascriptMimeType(ct)) {
					return response.body;
				}

				const source = new _Uint8Array(await response.arrayBuffer());
				let rewritten =
					(await reusedRewrite(handler, source, response.url, parsed)) ??
					rewriteJs(
						source,
						response.url,
						handler.context,
						parsed.meta,
						parsed.isModule
					);

				if (flagEnabled("debugSourceURL", handler.context)) {
					if (typeof rewritten !== "string") {
						rewritten = TextDecoder_decode(rewritten);
					}
					rewritten += `\n//# sourceURL=${parsed.url.href}`;
				}

				return rewritten as unknown as ArrayBuffer;
			}
			return response.body;
		}
		case "style":
			return rewriteCss(await response.text(), handler.context, parsed.meta);
		case "sharedworker":
		case "worker":
			return rewriteWorkers(
				new _Uint8Array(await response.arrayBuffer()),
				response.url,
				handler.context,
				parsed.meta,
				parsed.isModule
			);
		default:
			return response.body;
	}
}

/**
 * How much of a document the encoding is sniffed from: the prescan reads the
 * first 1024 bytes for a `<meta charset>`.
 * https://html.spec.whatwg.org/multipage/parsing.html#prescan-a-byte-stream-to-determine-its-encoding
 */
const SNIFF_BYTES = 1024;

/** the most of a document {@link streamHtml} rewrites in one go */
const REWRITE_SLICE = 65536;

/** a document's body, rewritten as it arrives */
function streamHtml(
	body: ReadableStream<Uint8Array>,
	contentType: string | null,
	rewriter: StreamingHtmlRewriter
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	let decoder: InstanceType<typeof _TextDecoder> | null = null;
	let head: Uint8Array[] = [];
	let headLength = 0;

	const decode = (bytes: Uint8Array) => {
		if (!decoder) {
			head[head.length] = bytes;
			headLength += bytes.length;
			if (headLength < SNIFF_BYTES) return "";
			return startDecoding();
		}

		return rewriter.write(decoder.decode(bytes, { stream: true }));
	};
	const startDecoding = () => {
		const all = new _Uint8Array(headLength);
		let at = 0;
		for (let i = 0; i < head.length; i++) {
			all.set(head[i], at);
			at += head[i].length;
		}
		head = [];
		decoder = new _TextDecoder(sniffEncoding(all, contentType));

		return rewriter.write(decoder.decode(all, { stream: true }));
	};

	// what is left of a chunk too big to rewrite at once
	let rest: Uint8Array | null = null;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				for (;;) {
					let done = false;
					let value: Uint8Array | undefined;
					if (rest) {
						value = rest;
						rest = null;
					} else {
						({ done, value } = await reader.read());
					}
					// A body that arrives all at once - from a cache - is still
					// rewritten a slice per pull. The page is parsed on the
					// thread that rewrites it, and one rewrite of a whole
					// document holds its parser, and its first paint, until
					// the last byte is done.
					if (value && value.length > REWRITE_SLICE) {
						rest = value.subarray(REWRITE_SLICE);
						value = value.subarray(0, REWRITE_SLICE);
					}
					if (done) {
						const text =
							(decoder ? "" : startDecoding()) +
							rewriter.write(decoder!.decode()) +
							rewriter.end();
						if (text) controller.enqueue(TextEncoder_encode(text));
						controller.close();

						return;
					}
					const text = decode(value!);
					if (text) {
						controller.enqueue(TextEncoder_encode(text));

						return;
					}
				}
			} catch (e) {
				// a document cut off where the rewrite failed, rather than
				// the rest of it going out unrewritten
				controller.error(e);
				reader.cancel(e).catch(() => {});
			}
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

/** how much rewritten script a handler keeps, in bytes, before starting over */
const SCRIPT_REWRITES_MAX = 64 * 1024 * 1024;

declare const COMMITHASH: string;
declare const BUILDDATE: string;

/**
 * Where rewrites outlive the page: Cache Storage, under a name that changes
 * with every build, so a new rewriter never answers with an old one's output.
 */
const REWRITES_CACHE = "$scramjet$rewrites:";
const REWRITES_CACHE_NAME = REWRITES_CACHE + COMMITHASH + ":" + BUILDDATE;
/** entries kept in it; past this the oldest go */
const REWRITES_CACHE_ENTRIES = 4000;

async function openRewritesCache(): Promise<Cache | null> {
	if (typeof caches === "undefined") return null;
	try {
		// another build's entries are no use to this one
		for (const name of await caches.keys())
			if (name.startsWith(REWRITES_CACHE) && name !== REWRITES_CACHE_NAME)
				caches.delete(name);
		const cache = await caches.open(REWRITES_CACHE_NAME);
		// keys come back oldest first; past the limit, the oldest quarter goes
		cache.keys().then((keys) => {
			if (keys.length <= REWRITES_CACHE_ENTRIES) return;
			const drop = keys.length - (REWRITES_CACHE_ENTRIES * 3) / 4;
			for (let i = 0; i < drop; i++) cache.delete(keys[i]);
		});
		return cache;
	} catch {
		return null;
	}
}

const hex = (bytes: Uint8Array) => {
	let out = "";
	for (let i = 0; i < bytes.length; i++)
		out += bytes[i].toString(16).padStart(2, "0");
	return out;
};

/**
 * A script's rewrite, from an earlier one of the same bytes when there is one:
 * this handler's, or one kept in Cache Storage from another session. Each
 * copy handed out gets a PST registration ID of its own - two realms running
 * one script would otherwise register as one - and a stored one gets this
 * frame's prefix in place of the frame it was made for.
 *
 * Undefined when there is no digest to key on (no `crypto.subtle` outside a
 * secure context) or the script does not rewrite cleanly, which then goes
 * the ordinary way.
 */
async function reusedRewrite(
	handler: ScramjetFetchHandler,
	source: Uint8Array,
	url: string,
	parsed: ScramjetFetchParsed
): Promise<Uint8Array | undefined> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return undefined;

	const digest = new _Uint8Array(
		await subtle.digest("SHA-256", source as BufferSource)
	);
	// everything the output depends on but the frame's prefix, which is
	// swapped in on the way out
	const key =
		(parsed.isModule ? "m" : "s") +
		hex(digest) +
		"\0" +
		url +
		"\0" +
		parsed.meta.base.href +
		"\0" +
		(parsed.meta.initiatorOrigin ?? parsed.meta.origin.origin) +
		"\0" +
		handler.rewriteFingerprint();
	const prefix = handler.context.prefix.pathname;

	const entry = handler.scriptRewrites.get(key);
	if (entry) {
		const copy = entry.js.slice();
		if (entry.idAt !== -1) giveNewScriptId(copy, entry.idAt);
		return copy;
	}

	const remember = (js: Uint8Array, idAt: number) => {
		handler.scriptRewritesSize += js.length;
		if (handler.scriptRewritesSize > SCRIPT_REWRITES_MAX) {
			handler.scriptRewrites.clear();
			handler.scriptRewritesSize = js.length;
		}
		handler.scriptRewrites.set(key, { js, idAt });
	};

	handler.rewritesCache ??= openRewritesCache();
	const cache = await handler.rewritesCache;
	const storedAt =
		cache &&
		new URL(
			"/$scramjet$rewrites/" +
				hex(
					new _Uint8Array(
						await subtle.digest("SHA-256", TextEncoder_encode(key))
					)
				),
			location.href
		).href;

	if (cache && storedAt) {
		try {
			const stored = await cache.match(storedAt);
			const storedPrefix = stored?.headers.get("x-scramjet-prefix");
			if (stored && storedPrefix && storedPrefix.length === prefix.length) {
				const js = new _Uint8Array(await stored.arrayBuffer());
				const idAt = Number(stored.headers.get("x-scramjet-id-at"));
				replaceAsciiAll(js, storedPrefix, prefix);
				remember(js, idAt);
				const copy = js.slice();
				if (idAt !== -1) giveNewScriptId(copy, idAt);
				return copy;
			}
		} catch {
			// a cache that cannot be read is a miss
		}
	}

	const fresh = rewriteScriptForReuse(
		source,
		url,
		handler.context,
		parsed.meta,
		parsed.isModule
	);
	if (!fresh) return undefined;
	remember(fresh.js, fresh.idAt);
	if (cache && storedAt) {
		// not awaited: the page does not wait on the copy for later
		cache
			.put(
				storedAt,
				new Response(fresh.js.slice(), {
					headers: {
						"content-type": "text/javascript",
						"x-scramjet-prefix": prefix,
						"x-scramjet-id-at": String(fresh.idAt),
					},
				})
			)
			.catch(() => {});
	}

	// the first copy is the one just made, and its ID is already its own
	return fresh.js.slice();
}
