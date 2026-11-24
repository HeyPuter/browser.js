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

				let rewritten = rewriteJs(
					new _Uint8Array(await response.arrayBuffer()),
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
