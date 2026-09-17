/**
 * Instrumentation for a LIVE run, wrapped around whichever transport is doing
 * the fetching.
 *
 * A live run has no store to diff against and no baseline to compare to. The
 * only things it can report are what it sent, what came back, and whether
 * Cloudflare ever handed over a `cf_clearance` -- and those have to be the same
 * measurements whichever transport is underneath, or two transports cannot be
 * compared to each other. Hence a wrapper rather than a method on one of them.
 *
 * On the wisp transports (epoxy, libcurl) the headers logged here ARE the wire
 * bytes: nothing between this seam and the socket adds, drops, renames or
 * reorders a header. That is not true of the Blink transport, where Chromium
 * recomposes the request afterwards -- for that path the equivalent measurement
 * is SBXDIFF_LOG_WIRE_HEADERS inside the browser.
 */
export class SbxdiffLiveLogTransport {
	/**
	 * @param {any} inner
	 * @param {string} label transport name, so a log says which one it was
	 * @param {boolean} headers whether to dump request headers and Set-Cookie
	 * @param {string | null} recordTo port of the store recorder, or null
	 */
	constructor(inner, label, headers, recordTo = null) {
		this.inner = inner;
		this.label = label;
		this.headers = headers;
		this.recordTo = recordTo;
		this.stats = { requests: 0, failures: 0, clearances: 0 };
	}

	/**
	 * Write one exchange into the store the harness is recording.
	 *
	 * `--sbxdiff-net-record` cannot do this: it records what the BROWSER's
	 * network stack received, and on the wisp path the sandbox's upstream never
	 * touches it. The transport is the only place the sandbox's own journey
	 * exists, and it runs in the page -- hence an endpoint rather than a file.
	 *
	 * One framed blob rather than JSON, because a JSON envelope would have to
	 * base64 the bytes and these run to megabytes.
	 */
	async #record(remote, requestBody, res, bodyBytes) {
		const headers = res.headers ?? [];
		const contentType =
			headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
		const meta = {
			url: remote.href,
			mime: contentType.split(";")[0].trim(),
			encoding: /charset=([^;]+)/i.exec(contentType)?.[1]?.trim() ?? "",
			status: res.status,
			statusText: res.statusText || "",
			headers,
			reqBodyLen: requestBody.byteLength,
		};
		const head = new TextEncoder().encode(`${JSON.stringify(meta)}\n`);
		try {
			await fetch(`http://localhost:${this.recordTo}/__sbxdiff/record`, {
				method: "POST",
				body: new Blob([head, requestBody, bodyBytes]),
			});
		} catch (err) {
			console.error(`sbxdiff-live: record failed for ${remote.href}: ${err}`);
		}
	}

	get ready() {
		return this.inner.ready;
	}

	init() {
		return this.inner.init();
	}

	meta(...args) {
		return this.inner.meta?.(...args);
	}

	/**
	 * The request body as bytes, whatever shape it arrived in.
	 *
	 * A ReadableStream is the shape that matters and the one the old inline
	 * version did not have a branch for, so every recorded request body was
	 * zero bytes -- which is invisible until you go looking for one. It also
	 * has to happen BEFORE the inner transport runs: the transport consumes
	 * the stream, so reading it afterwards yields nothing at all.
	 */
	static async #bytes(body) {
		if (body == null) return new Uint8Array(0);
		if (body instanceof Uint8Array) return body;
		if (typeof body === "string") return new TextEncoder().encode(body);
		if (body instanceof ArrayBuffer) return new Uint8Array(body);
		if (ArrayBuffer.isView(body))
			return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
		// Blob and ReadableStream both, via Response.
		try {
			return new Uint8Array(await new Response(body).arrayBuffer());
		} catch (err) {
			console.error(`sbxdiff-live: could not read request body: ${err}`);

			return new Uint8Array(0);
		}
	}

	async request(remote, method, body, headers, signal) {
		this.stats.requests++;

		// Materialised up front, and the BYTES are what goes downstream -- a
		// stream that has been read cannot also be sent.
		//
		// `body != null` guards the substitution, NOT just the read. A GET
		// arrives with a null body, and replacing that with a zero-length
		// Uint8Array is not the same thing: the transport then sends a body on
		// a request that must not have one, and epoxy refuses the very first
		// GET of the run. Measured -- one store file written, no challenge at
		// all, and it only happens when recording is on, so an unrecorded run
		// looks fine.
		let sent = null;
		if (this.recordTo && body != null) {
			sent = await SbxdiffLiveLogTransport.#bytes(body);
			body = sent;
		}
		// Path AND query. Cloudflare's whole challenge flow is distinguished by
		// the query alone -- `/`, `/?__cf_chl_tk=...` and `/?__cf_chl_f_tk=...`
		// are three different steps at one path -- so a log that stops at
		// `pathname` renders the flow as one URL repeated and hides which step
		// the run is actually on.
		const where = `${remote.host}${remote.pathname}${remote.search}`;
		if (this.headers) {
			console.info(
				`sbxdiff-live-req: ${method} ${remote.href} :: ` +
					(headers ?? []).map(([k, v]) => `${k}: ${v}`).join(" | ")
			);
		}

		let res;
		try {
			res = await this.inner.request(remote, method, body, headers, signal);
		} catch (err) {
			this.stats.failures++;
			// Logged rather than swallowed: a transport failure reaches the
			// guest as a rejected fetch, which on a challenge page looks exactly
			// like the challenge deciding not to answer.
			console.error(`sbxdiff-live: FAILED ${method} ${where}: ${err}`);
			throw err;
		}

		// Cloudflare returns its verdict on the `/fo/` XHR as `cf-chl-out` and
		// `cf-chl-out-s` RESPONSE headers; the Turnstile widget reads them and
		// that is what redeems the challenge. A header the guest cannot read is
		// indistinguishable, from inside the page, from a challenge that was
		// refused -- so what arrives here is worth seeing whole.
		if (this.headers) {
			const interesting = (res.headers ?? []).filter(([k]) =>
				/^cf-|^access-control-expose/i.test(k)
			);
			if (interesting.length) {
				console.info(
					`sbxdiff-live-cf: ${where.slice(0, 70)} :: ` +
						interesting.map(([k, v]) => `${k}=${v.slice(0, 40)}`).join(" | ")
				);
			}
		}

		for (const [key, value] of res.headers ?? []) {
			if (key.toLowerCase() !== "set-cookie") continue;
			if (this.headers) {
				console.info(`sbxdiff-live-setcookie: ${remote.host} ${value}`);
			}
			// The one response header a live run is waiting for. Cloudflare
			// issues `cf_clearance` when it accepts the challenge, and nothing
			// else on this path reports success: the page looks the same whether
			// the cookie came back or the challenge looped.
			//
			// Being issued one is NOT passing. The clearance is bound to the
			// client that earned it, and the binding reaches below HTTP -- so
			// the next request can present it and still be answered 403. Both
			// numbers are in the summary for that reason.
			if (value.startsWith("cf_clearance=")) {
				this.stats.clearances++;
				console.info(`sbxdiff-live: CF_CLEARANCE issued by ${remote.host}`);
			}
		}

		console.info(`sbxdiff-live: ${res.status} ${method} ${where}`);

		if (this.recordTo) {
			// The request body too: a replayed run is graded on whether it posts
			// what the recording posted, so a store without them cannot tell a
			// sandbox that answered the challenge from one that answered
			// something else.
			const bytes = new Uint8Array(await new Response(res.body).arrayBuffer());
			await this.#record(remote, sent ?? new Uint8Array(0), res, bytes);

			// The body was consumed to record it, so hand onward a fresh one.
			return { ...res, body: new Blob([bytes]).stream() };
		}

		return res;
	}

	connect(...args) {
		return this.inner.connect(...args);
	}
}
