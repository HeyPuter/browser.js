/**
 * The live transport: scramjet's own egress, over wisp, with TLS in the page.
 *
 * This is an ES module, not a classic script like the other two transports in
 * this directory, because it imports epoxy from `/epoxy/full.js`. The harness
 * loads it with `await import(...)` from inside `init()`.
 *
 * WHY THIS AND NOT THE BLINK TRANSPORT
 *
 * The Blink transport fetches upstream with the page's own `fetch()`, so the
 * request that reaches the server is composed by CHROMIUM: it re-derives the
 * `Sec-Fetch-*` family in the network service, drops every forbidden header
 * scramjet set (`Cookie` first among them), attaches client hints for the
 * PROXY's origin, and adds a `Referer` of its own. Getting scramjet's bytes
 * through it took a carrier -- `x-sbxdiff-h-<name>` on the way out, three
 * patched Chromium call sites to put them back -- and after all of that the
 * wire still differed from the oracle's on client hints, because Chrome only
 * emits high-entropy hints for an origin that asked for them via `Accept-CH`,
 * and under the proxy that origin is localhost.
 *
 * None of that is what production does. Production is this: scramjet composes
 * the headers, and they go out as composed, over a socket the browser is not
 * allowed to touch. Anything the sandbox gets wrong here is a scramjet bug
 * rather than an artefact of the diagnostic, which is the only kind of bug
 * worth finding.
 *
 * WHY EPOXY AND NOT LIBCURL
 *
 * Both do TLS in the page, so both present one client end to end. epoxy is
 * rustls + hyper compiled to wasm, from a checkout we have (`epoxy-tls`, branch
 * `rewrite`, `client/`), so the ClientHello is ours to shape -- cipher order,
 * curves, ALPN, the lot -- and hyper's `HeaderCaseMap` sends header names with
 * the case scramjet chose instead of lowercasing them. libcurl's TLS is
 * whatever its wasm build was configured with and is not reachable from here.
 *
 * A Cloudflare managed challenge fingerprints the handshake, so "reachable from
 * here" is the whole difference between a transport that can be made to match
 * and one that cannot.
 */
import {
	EpoxyClient,
	WebSocketJsProvider,
	WispSocketProvider,
	init,
} from "/epoxy/full.js";

/** Copy out of a possibly-offset view, because wasm hands back subarrays. */
function toArrayBuffer(chunk) {
	if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength) {
		return chunk.buffer;
	}

	return chunk.buffer.slice(
		chunk.byteOffset,
		chunk.byteOffset + chunk.byteLength
	);
}

export class SbxdiffEpoxyTransport {
	/** @param {string} wispUrl */
	constructor(wispUrl) {
		this.wispUrl = wispUrl;
		this.ready = false;
		this.client = null;
	}

	async init() {
		// The wasm is fetched as wasm rather than inlined into the module, so
		// this is a streaming compile.
		await init("/epoxy/full.wasm");
		const provider = new WispSocketProvider(
			new WebSocketJsProvider(),
			this.wispUrl
		);
		this.client = new EpoxyClient(provider);
		console.info(
			`sbxdiff-epoxy: upstream goes out through wisp at ${this.wispUrl}, ` +
				`TLS in the page`
		);
		this.ready = true;
	}

	async meta() {}

	/**
	 * @param {URL} remote
	 * @param {string} method
	 * @param {BodyInit | null} body
	 * @param {[string, string][]} headers
	 * @param {AbortSignal | undefined} signal
	 */
	async request(remote, method, body, headers, signal) {
		// epoxy takes a stream or a buffer; a Blob is neither.
		if (body instanceof Blob) body = await body.arrayBuffer();

		// Nothing is caught here on purpose: a failure is reported by
		// SbxdiffLiveLogTransport, so that it is counted the same way whichever
		// transport produced it.
		//
		// `redirect: "manual"`: scramjet follows redirects itself, off the
		// Location header, so it has to see the 3xx rather than the thing at the
		// end of it.
		//
		// `headers` goes through untouched. That is the point of this transport
		// -- no forbidden-header filter, no recomputation, no second cookie jar.
		const res = await this.client.fetch(remote.href, {
			method,
			body,
			headers,
			redirect: "manual",
			signal,
		});

		// Flattened, and one entry per repeat: `rawHeaders` groups values by
		// name, and Set-Cookie arrives repeated.
		/** @type {[string, string][]} */
		const out = [];
		for (const [key, values] of Object.entries(res.rawHeaders)) {
			for (const value of values) out.push([key, value]);
		}

		return {
			body: res.body,
			headers: out,
			status: res.status,
			statusText: res.statusText,
		};
	}

	connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
		const ws = this.client.websocket(url.href, {
			protocols,
			headers: requestHeaders,
		});
		const writer = ws.then((socket) => socket.writable.getWriter());
		// Failures are reported to onerror by the read loop below; this just
		// stops the unhandled rejection.
		writer.catch(() => {});

		let settled = false;
		const fail = (err) => {
			if (settled) return;
			settled = true;
			onerror(String(err));
		};
		const finish = (info) => {
			if (settled) return;
			settled = true;
			onclose(info.closeCode ?? 1000, info.reason ?? "");
		};

		(async () => {
			let socket;
			try {
				socket = await ws;
			} catch (err) {
				fail(err);

				return;
			}

			socket.closed.then(finish, fail);
			onopen(
				socket.protocol,
				socket.headers.get("sec-websocket-extensions") || ""
			);

			const reader = socket.readable.getReader();
			try {
				for (;;) {
					// eslint-disable-next-line no-await-in-loop
					const { done, value } = await reader.read();
					if (done || value === undefined) break;
					onmessage(typeof value === "string" ? value : toArrayBuffer(value));
				}
			} catch (err) {
				fail(err);
			} finally {
				reader.releaseLock();
			}
		})();

		return [
			async (data) => {
				try {
					if (data instanceof Blob) data = await data.arrayBuffer();
					const w = await writer;
					await w.write(
						data instanceof ArrayBuffer ? new Uint8Array(data) : data
					);
				} catch (err) {
					fail(err);
				}
			},
			async (code, reason) => {
				try {
					(await ws).close({ closeCode: code, reason: reason || "" });
				} catch (err) {
					fail(err);
				}
			},
		];
	}
}
