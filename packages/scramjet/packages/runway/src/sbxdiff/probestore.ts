/**
 * Prepend a line of JavaScript to a recorded response, in a copy of the store.
 *
 * The cheapest instrument this tool has. Both sides replay the same store, so
 * a probe planted in a recorded script body runs on BOTH sides, in the same
 * script, at the same point in that script's execution -- which is the one
 * thing no amount of reasoning about two separate runs can give you. It needs
 * no Chromium rebuild, no new trace field and no change to either side's
 * configuration.
 *
 * It found rule 100: `document.scripts.length` read 20 in the oracle and 23 in
 * the sandbox, and three rounds of plausible explanations (the shim's injected
 * scripts, `document.currentScript`, the collection itself) were all wrong.
 * Three lines prepended to the recorded `gtag/js` body printed the src list
 * from inside the reading script and named the three extra elements in one run.
 *
 * Report through a sink the page does not read. `document.createComment`
 * carries its argument into the trace and nothing else on the page can see it.
 * `document.title` is tempting -- it is already the differ's GUEST_SINK -- and
 * wrong for anything pointed at an anti-bot payload, because those read the
 * title, so the probe would feed itself back into its own measurement.
 * `titleProbe` below is for probes planted somewhere nothing is watching.
 *
 * Always into a COPY. A store is a recording of a journey that cannot be made
 * again -- rym's took a headed run through a Cloudflare managed challenge --
 * and a patched body is not that recording any more.
 */
import {
	cpSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const MAGIC_V3 = "SBXD3\n";

/**
 * The raw pieces of one store file, including the header BYTES.
 *
 * `parse` in store.ts splits the headers into pairs and throws the raw block
 * away, which is right for serving and useless for rewriting: the block is
 * length-prefixed, so it has to be reproduced exactly or every later offset
 * shifts. Hence a second, byte-level reader -- kept honest by
 * `probestore.test.ts`, which round-trips real files through both.
 */
export type RawEntry = {
	url: string;
	mime: string;
	encoding: string;
	rawHeaders: Buffer;
	requestBody: Buffer;
	body: Buffer;
};

/** Splits one SBXD3 file, or null if it is not one. */
export function splitEntry(buf: Buffer): RawEntry | null {
	if (buf.subarray(0, MAGIC_V3.length).toString("latin1") !== MAGIC_V3) {
		return null;
	}
	let pos = MAGIC_V3.length;
	const field = (): string | null => {
		const end = buf.indexOf(0x0a, pos);
		if (end < 0) return null;
		const s = buf.subarray(pos, end).toString("utf8");
		pos = end + 1;

		return s;
	};
	const url = field();
	const mime = field();
	const encoding = field();
	const rawLenStr = field();
	const bodyLenStr = field();
	if (
		url === null ||
		mime === null ||
		encoding === null ||
		rawLenStr === null ||
		bodyLenStr === null
	) {
		return null;
	}
	const rawLen = Number(rawLenStr);
	const bodyLen = Number(bodyLenStr);
	if (!Number.isFinite(rawLen) || !Number.isFinite(bodyLen)) return null;
	if (pos + rawLen + bodyLen > buf.length) return null;
	const rawHeaders = buf.subarray(pos, pos + rawLen);
	pos += rawLen;
	const requestBody = buf.subarray(pos, pos + bodyLen);
	pos += bodyLen;

	return {
		url,
		mime,
		encoding,
		rawHeaders,
		requestBody,
		body: buf.subarray(pos),
	};
}

/** Rebuilds a store file from its pieces. The inverse of `splitEntry`. */
export function joinEntry(e: RawEntry): Buffer {
	return Buffer.concat([
		Buffer.from(
			`${MAGIC_V3}${e.url}\n${e.mime}\n${e.encoding}\n` +
				`${e.rawHeaders.length}\n${e.requestBody.length}\n`
		),
		e.rawHeaders,
		e.requestBody,
		e.body,
	]);
}

/**
 * Drops `Content-Length`, which the probe has just made a lie.
 *
 * Nothing in this harness reads it -- the replayer and the in-page transport
 * both serve the bytes they hold -- but a header that disagrees with the body
 * is a trap for whatever reads it next, and the guest can read it through
 * `performance.getEntries()` and `Response.headers`.
 */
function dropContentLength(raw: Buffer): Buffer {
	const fields = raw.toString("latin1").split("\0");

	return Buffer.from(
		fields.filter((f) => !/^content-length\s*:/i.test(f)).join("\0"),
		"latin1"
	);
}

function isHtml(mime: string): boolean {
	return /(^|\/)(x?html)\b|^text\/html/i.test(mime);
}

/**
 * Puts the probe inside a `<script>` at the top of `<head>`, not at byte 0.
 *
 * A document is not a script: prepending raw JavaScript to one makes the
 * parser read it as text. And prepending `<script>` is worse than useless,
 * because a `<script>` ahead of the DOCTYPE is exactly what puts a browser in
 * quirks mode -- which moves `compatMode`, `clientHeight`, `scrollHeight` and
 * every layout number the page can read (see the `isQuirky` path in scramjet's
 * html rewriter, which exists for the same reason).
 *
 * So: after `<head>` if there is one, after the DOCTYPE and any comments
 * otherwise, and at the front only if the document has neither -- at which
 * point it is already in quirks mode and nothing is being changed.
 */
function injectIntoHtml(body: Buffer, probe: string, nonce?: string): Buffer {
	const text = body.toString("utf8");
	const tag = `<script${nonce ? ` nonce="${nonce}"` : ""}>${probe}\n</script>`;
	const head = /<head\b[^>]*>/i.exec(text);
	if (head) {
		const at = head.index + head[0].length;
		return Buffer.from(text.slice(0, at) + tag + text.slice(at), "utf8");
	}
	const doctype = /<!doctype[^>]*>/i.exec(text);
	if (doctype) {
		const at = doctype.index + doctype[0].length;
		return Buffer.from(text.slice(0, at) + tag + text.slice(at), "utf8");
	}

	return Buffer.from(tag + text, "utf8");
}

/**
 * The nonce a document's own CSP requires of an inline script, if it has one.
 *
 * Without it the probe runs on ONE side. Cloudflare's widget document sends
 * `script-src 'nonce-...'`, so unmodified Chromium refuses an injected inline
 * script and the sandbox -- which does not enforce the site's CSP -- runs it.
 * The first blob probe reported three Blobs from the sandbox and not one line
 * from the oracle, which reads exactly like the oracle having no blobs
 * (RULES.md #115).
 */
function cspNonce(rawHeaders: Buffer): string | undefined {
	for (const field of rawHeaders.toString("latin1").split("\0")) {
		if (!/^content-security-policy\s*:/i.test(field)) continue;
		const m = /'nonce-([^']+)'/.exec(field);
		if (m) return m[1];
	}

	return undefined;
}

/**
 * Copies `src` to `dst` and plants `probe` in every body whose URL contains
 * `match`: at the front of a script, inside a `<script>` at the top of `<head>`
 * for a document. Returns the URLs it patched.
 *
 * A substring rather than an exact URL because the interesting targets carry
 * cache-busting query strings, and a probe that silently matched nothing would
 * look exactly like a probe that found no divergence.
 */
export function plantProbe(opts: {
	src: string;
	dst: string;
	match: string;
	probe: string;
}): string[] {
	rmSync(opts.dst, { recursive: true, force: true });
	cpSync(opts.src, opts.dst, { recursive: true });
	// A trailing newline, so a source file ending in a line comment cannot eat
	// the first statement of the real body.
	const prefix = Buffer.from(`${opts.probe}\n`);
	const patched: string[] = [];
	for (const name of readdirSync(opts.dst)) {
		if (name.startsWith("sbxdiff-")) continue;
		const file = path.join(opts.dst, name);
		const entry = splitEntry(readFileSync(file));
		if (!entry || !entry.url.includes(opts.match)) continue;
		entry.body = isHtml(entry.mime)
			? injectIntoHtml(entry.body, opts.probe, cspNonce(entry.rawHeaders))
			: Buffer.concat([prefix, entry.body]);
		entry.rawHeaders = dropContentLength(entry.rawHeaders);
		writeFileSync(file, joinEntry(entry));
		patched.push(entry.url);
	}

	return patched;
}

/**
 * A probe that reports one expression per `document.title` write.
 *
 * Wrapped in try/catch and keyed by name, because a probe that throws takes
 * the recorded script with it and turns one measurement into a whole run of
 * missing calls.
 */
export function titleProbe(fields: Record<string, string>): string {
	const body = Object.entries(fields)
		.map(([k, expr]) => `document.title=${JSON.stringify(`${k}=`)}+(${expr});`)
		.join("");

	return `try{${body}}catch($e){document.title="probe.err="+$e}`;
}

if (import.meta.filename === process.argv[1]) {
	const [src, dst, match, probeFile] = process.argv.slice(2);
	if (!src || !dst || !match || !probeFile) {
		console.error(
			"usage: probestore.ts <src-store> <dst-store> <url-substring> <probe.js>"
		);
		process.exit(2);
	}
	const urls = plantProbe({
		src,
		dst,
		match,
		probe: readFileSync(probeFile, "utf8"),
	});
	for (const u of urls) console.log(`patched ${u}`);
	// A probe that matched nothing is the failure mode worth failing on: the
	// run that follows would look clean and mean nothing.
	if (urls.length === 0) {
		console.error(`no stored URL contains ${JSON.stringify(match)}`);
		process.exit(1);
	}
}
