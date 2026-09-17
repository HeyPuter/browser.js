/**
 * A scramjet ProxyTransport that serves every upstream request from an sbxdiff
 * network store instead of the live internet.
 *
 * Why this exists, in order of importance:
 *
 * 1. **The oracle needs both runs to see the same bytes.** The direct run
 *    records a store; this transport replays it into the sandbox. Without it
 *    the two runs fetch the live site independently and diverge on content
 *    neither side controls.
 *
 * 2. **The Chromium-side replay cannot reach here.** `--sbxdiff-net-replay` is
 *    installed at `WillCreateURLLoaderFactory`, but a sandbox's real egress is
 *    WebSocket frames to a wisp server, which never goes through a
 *    URLLoaderFactory. Replacing the transport is the only layer that sees
 *    these requests.
 *
 * 3. **It keys on the real URL.** The transport is called with the upstream
 *    URL *before* scramjet proxies it, so a store recorded from a direct run
 *    matches directly -- no proxy-URL normalization needed.
 *
 * 4. **It removes the WebSocket, which is what deadlocks virtual time.** The
 *    wisp transport drives itself with timers; `kDeterministicLoading` pauses
 *    virtual time while a load is outstanding; the load waits on the timer and
 *    the timer waits on the clock. A plain same-origin `fetch` is a load the
 *    scheduler already knows how to account for.
 *
 * A miss is a hard failure, never a live fetch: a silent fallback would let a
 * real divergence look like a clean run, which is the bug class this whole tool
 * exists to catch (RULES.md #14).
 */
class SbxdiffTransport {
	/** @param {{ endpoint?: string, onMiss?: (url: string) => void }} [opts] */
	constructor(opts = {}) {
		this.endpoint = opts.endpoint ?? "/__sbxdiff/fetch";
		this.onMiss = opts.onMiss ?? null;
		this.ready = false;
		/** URLs the store did not have. Surfaced so a run can report them. */
		this.misses = [];
		/** url -> ordered [{mime, body}, ...] pulled in by init(); see why there. */
		this.preloaded = new Map();
		/** url -> how many times this run has asked for it. */
		this.counts = new Map();
	}

	/**
	 * Pull the whole store into memory before the page under test loads.
	 *
	 * This is not an optimisation. Under the `advance` virtual time policy the
	 * clock races forward whenever the run is idle, so every *real* I/O wait on
	 * the guest-load path converts real elapsed time into a nondeterministic
	 * amount of virtual time. A per-request `fetch` to the store endpoint is
	 * exactly such a wait. Preloading moves all of it before virtual time is
	 * enabled, leaving the guest load with no real I/O to race against.
	 */
	async init() {
		console.info(`sbxdiff-transport: init ${this.endpoint}`);
		const res = await fetch(`${this.endpoint}?all=1`);
		console.info(`sbxdiff-transport: preload ${res.status}`);
		if (res.ok) {
			const payload = await res.json();
			// v2 of this endpoint wraps the map so it can carry run-wide flags.
			const all = payload.hits ?? payload;
			this.strictBodies = Boolean(payload.strictBodies);
			for (const [url, entries] of Object.entries(all)) {
				this.preloaded.set(url, entries);
			}
		}
		this.ready = true;
		console.info(`sbxdiff-transport: ready, ${this.preloaded.size} url(s)`);
	}

	/**
	 * @param {URL} remote
	 * @param {string} method
	 * @param {BodyInit | null} body
	 * @param {[string, string][]} headers
	 * @param {AbortSignal | undefined} signal
	 */
	/**
	 * FNV-1a, rendered "<length>:<hash in base36>".
	 *
	 * One of THREE implementations that have to agree byte for byte: this one,
	 * `bodyHash` in store.ts, and `base::sbxdiff::BodyHash` in
	 * `base/sbxdiff_body_hash.h`. The oracle builds its request bodies in C++
	 * inside the network service and the sandbox builds its own here, in the
	 * guest's JavaScript; there is no object the two can share, only a string
	 * both can independently derive. If they drift the comparison silently stops
	 * meaning anything. `sbxdiff/bodyhash.test.ts` holds all three to one set of
	 * golden vectors.
	 *
	 * Public rather than `#private` so that test can reach it. There is nothing
	 * to protect: the class is already on `window`, and this is a diagnostic.
	 *
	 * Not a digest -- it only has to distinguish payloads, and it has to be
	 * computable on the request path without SubtleCrypto's async ceremony.
	 */
	static hash(bytes) {
		let h = 0x811c9dc5;
		for (let i = 0; i < bytes.length; i++) {
			h ^= bytes[i];
			h = Math.imul(h, 0x01000193) >>> 0;
		}

		return `${bytes.length}:${h.toString(36)}`;
	}

	async request(remote, method, body, headers, signal) {
		// Nth request for a URL gets the Nth recording. A URL can return
		// different bodies on successive requests -- a challenge page and then
		// the real page -- and collapsing them silently replays a different
		// journey than the one recorded.
		const ordinal = this.counts.get(remote.href) ?? 0;
		this.counts.set(remote.href, ordinal + 1);
		// Which recording this request actually consumed. Always `ordinal` now:
		// this used to skip one across a Critical-CH restart, because the oracle
		// performed that restart and the proxy did not, so the two sides read
		// different entries for the same URL. scramjet performs it itself now
		// (see clienthints.ts), which means it asks for the entry instead of
		// being handed it, and both sides ask the same number of times.
		const servedOrdinal = ordinal;

		// Any method, exactly like the Chromium-side replay, which keys on URL
		// alone too. Refusing non-GET made the sandbox stricter than the
		// oracle: Cloudflare POSTs to its `fo/` endpoint, the recording holds
		// that response, the oracle replays it and the sandbox reported a miss
		// -- a divergence manufactured by the harness.
		// Every request, logged. A preloaded hit never reaches the store server,
		// so without this the only requests the run can see are the ones that
		// MISS -- and "the sandbox never asked for this at all" is exactly the
		// shape of divergence a miss cannot show. Chromium's stderr captures
		// console output, so this lands next to the oracle's own replay log.
		console.info(`sbxdiff: req #${ordinal} ${method} ${remote.href}`);
		const hits = this.preloaded.get(remote.href);
		if (hits && hits.length) {
			// Past the end reuses the last: fetched more often than recorded is
			// normal, and the oracle saw no more than it recorded.
			// Past the end reuses the last, and says so. A page that asks for a
			// URL more times than the recording did is being answered with a
			// stale body, which is a divergence the store cannot resolve --
			// silently repeating the last response is how a retry loop hides.
			if (ordinal >= hits.length) {
				console.info(
					`sbxdiff: past-the-end #${ordinal} of ${hits.length} ${remote.href}`
				);
				// Beaconed, not just logged. A preloaded hit never touches the
				// server, so this is the only way the run's summary can count
				// the leniency that would otherwise let a looping page be handed
				// the recorded destination and look like it had arrived.
				void fetch(
					`${this.endpoint.replace("/fetch", "/pastend")}?url=${encodeURIComponent(
						remote.href
					)}&ordinal=${ordinal}&have=${hits.length}`
				).catch(() => {});
			}
			const hit = hits[Math.min(ordinal, hits.length - 1)];
			// Was this verdict graded on THIS answer? A store cannot grade a
			// request, so Cloudflare's recorded "you passed" comes back whatever
			// was posted to it. Comparing against what the recording sent is the
			// difference between the sandbox producing the same answer and being
			// told what it wanted to hear.
			if (body) {
				const bytes = new Uint8Array(await new Response(body).arrayBuffer());
				const sent = SbxdiffTransport.hash(bytes);
				// Grade the request, the way the real server would.
				//
				// A store cannot grade, so without this Cloudflare's recorded
				// "you passed" comes back whatever was posted -- and a sandbox
				// whose payload the live server REJECTS sails through replay and
				// looks like it passed. That is exactly why the live failure
				// (post, rejected, retry, loop) has never reproduced here.
				//
				// Against the ORACLE's body, not the recording's: the recording
				// came from another run with another clock, and unmodified
				// Chromium does not reproduce it either (RULES.md #61).
				if (this.strictBodies && hit.oracleHash && sent !== hit.oracleHash) {
					console.info(
						`sbxdiff: REJECTED #${servedOrdinal} ${sent} vs oracle ${hit.oracleHash} ${remote.href}`
					);
					void fetch(this.endpoint.replace("/fetch", "/reject"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							url: remote.href,
							ordinal: servedOrdinal,
							sent,
							oracle: hit.oracleHash,
						}),
					}).catch(() => {});
					// 403 with an empty body is what an anti-bot endpoint answers
					// when it does not believe you, and it is what makes the
					// widget retry instead of proceeding.
					return new Response("", {
						status: 403,
						statusText: "Forbidden",
						headers: { "content-type": "text/plain" },
					});
				}
				if (hit.reqHash && sent !== hit.reqHash) {
					console.info(
						`sbxdiff: request body mismatch ${sent} vs recorded ${hit.reqHash} ${remote.href}`
					);
				}
				// Reported whether or not it matches the recording. The recording
				// is the wrong reference: the oracle -- unmodified Chromium --
				// disagrees with it on these same endpoints, because Cloudflare's
				// payload is built from the clock and from entropy drawn during
				// the run. The comparison that means something is this hash
				// against the ORACLE's, which the harness pairs up by url+ordinal.
				//
				// The bytes go too. A hash says "not the same answer"; only the
				// bytes say which part of the answer.
				let b64 = "";
				for (let i = 0; i < bytes.length; i++)
					b64 += String.fromCharCode(bytes[i]);
				void fetch(this.endpoint.replace("/fetch", "/reqbody"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						url: remote.href,
						ordinal: servedOrdinal,
						sent: btoa(b64),
						sentHash: sent,
						recordedHash: hit.reqHash ?? null,
					}),
				}).catch(() => {});
			}
			return this.#toResponse(hit);
		}

		const res = await fetch(
			`${this.endpoint}?url=${encodeURIComponent(remote.href)}&method=${encodeURIComponent(method)}&ordinal=${ordinal}`,
			{ method: "GET", signal }
		);

		if (res.status === 404) {
			this.misses.push(remote.href);
			if (this.onMiss) this.onMiss(remote.href);
			// Thrown, not a 504. A miss is a request that could not be made,
			// and Chromium's own replay answers one with
			// `net::ERR_BLOCKED_BY_CLIENT` -- a network error, no response. A
			// 504 gave the sandbox's guest an HTTP status where the oracle's
			// guest had nothing, on every miss.
			//
			// Measured on the brunhild probe, which Cloudflare's challenge
			// makes to a host that resolves nowhere and then records how it
			// failed: the oracle reported `fetch_error` and the sandbox
			// `http_error:504`. The two sides were describing the same
			// unreachable host differently, and the difference was the
			// harness's.
			//
			// The miss is still recorded above, so a run still reports it --
			// through the miss list, which is where a person reads it, rather
			// than through a status the page can read.
			throw new TypeError(`sbxdiff: no recorded response for ${remote.href}`);
		}

		return this.#toResponse(await res.json());
	}

	/** @param {{headers?: [string, string][]}} stored @param {string} name */
	#header(stored, name) {
		for (const [k, v] of stored.headers ?? []) {
			if (k.toLowerCase() === name) return v;
		}

		return undefined;
	}

	/**
	 * @param {{mime?: string, body: string, status?: number,
	 *          headers?: [string, string][]}} stored
	 */
	#toResponse(stored) {
		/** @type {[string, string][]} */
		const outHeaders = [];
		let sawContentType = false;
		for (const [name, value] of stored.headers ?? []) {
			const lower = name.toLowerCase();
			// The store keeps a DECODED body, so the recorded framing headers no
			// longer describe it: content-length is the wrong number and
			// content-encoding would ask for a second decode of already-decoded
			// bytes.
			if (
				lower === "content-encoding" ||
				lower === "content-length" ||
				lower === "transfer-encoding"
			) {
				continue;
			}
			if (lower === "content-type") sawContentType = true;
			outHeaders.push([name, value]);
		}
		// Everything else is passed through, `location` included. A redirect is
		// a recorded response now, and the URL a redirect lands on is content:
		// Cloudflare's challenge reads its token out of `location`, so a
		// transport that flattened the chain would run the script at a URL the
		// recording never committed to.
		if (!sawContentType && stored.mime) {
			outHeaders.push(["content-type", stored.mime]);
		}
		return {
			body: Uint8Array.from(atob(stored.body), (c) => c.charCodeAt(0)).buffer,
			headers: outHeaders,
			status: stored.status ?? 200,
			statusText: "",
		};
	}

	/**
	 * WebSockets are not recorded, so there is nothing to replay. Failing
	 * loudly beats opening a live socket and silently making the run
	 * non-hermetic.
	 */
	connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
		queueMicrotask(() =>
			onerror(`sbxdiff: WebSocket to ${url.href} is not replayable`)
		);
		return [() => {}, () => {}];
	}
}

window.SbxdiffTransport = SbxdiffTransport;
