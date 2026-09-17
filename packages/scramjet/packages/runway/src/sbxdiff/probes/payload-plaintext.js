/**
 * The canonical payload-plaintext probe.
 *
 * Cloudflare's `/fo/` body is `base64(rsa-wrapped key || xtea(lzw(json)))`, so
 * a byte diff of two bodies says only that they differ: LZW turns one early
 * difference into a different tail. This reads the payload BEFORE it is
 * encrypted, on both sides, from the build rym actually replays -- no lifting,
 * no deobfuscation, no Chromium rebuild.
 *
 * ## The two seams, and why these two
 *
 * **`String.prototype.charCodeAt`.** The pipeline is JSON -> LZW -> XTEA ->
 * base64, and LZW reads its input one character at a time. So the plaintext is
 * simply *the receiver of a long `charCodeAt`*. This is the seam that works on
 * rateyourmusic and it is the one worth remembering: earlier passes looked for
 * one big plaintext string, concluded none existed, and were wrong -- it is
 * chunked at 4096/8192 with a one-character header, so there are dozens of
 * small ones (FINDINGS #150).
 *
 * **`JSON.stringify`.** The parts the challenge serialises conventionally.
 * Gives field-level text directly, and is how the `PerformanceResourceTiming`
 * field diff in FINDINGS #109 was read. On rym all 41 of these came back
 * byte-identical (#205), which is what proved the remaining difference is
 * assembled inside the VM and never touches a traced API.
 *
 * ## What does NOT work, so nobody tries it again
 *
 * `internal-cf/sandbox/payload-plaintext.mjs` rewrites `xhr.send(enc(payload))`
 * in source. That needs a deobfuscated challenge. rym's recording is a
 * string-table VM -- `send` and `XMLHttpRequest` exist only as entries in a
 * semicolon-joined table reached by computed index -- and a search of all 97
 * store entries for that shape found zero matches. The only `.send(` anywhere
 * in rym's store is gtag and jQuery (FINDINGS #150).
 *
 * `Object.keys`/`entries`/`getOwnPropertyNames` (FINDINGS #147) gives the key
 * SET but no values. Useful for "which field is extra", useless for "what does
 * it say". Kept as a separate question, not folded in here.
 *
 * ## Two traps in reading the output
 *
 * 1. The ORACLE has no scramjet, so every oracle chunk is the challenge's. A
 *    SANDBOX-ONLY chunk is suspect rather than interesting: wasm-bindgen's
 *    string passing also reads ASCII character by character. The one
 *    sandbox-only chunk in the run that established this was a 2168-byte
 *    `<style>` block -- the challenge setting `innerHTML`, and scramjet handing
 *    it to the rewriter.
 * 2. Pair chunks by CONTENT, never by index. Both sides do a different number
 *    of encodings, so the sequences offset.
 *
 * ## How it gets in
 *
 * Planted in the store with `probestore.ts`, because that is the only injection
 * that reaches BOTH sides: the sandbox could take it through scramjet's
 * `probePath`, but the oracle has no scramjet. Both sides replay the same
 * store, so a probe in a recorded body runs in the same script at the same
 * point in both runs.
 *
 *     src/sbxdiff/rym.sh plaintext
 *
 * Read the result with `src/sbxdiff/plaintext.ts`; the run's own bucket counts
 * mean nothing, because a patched body changes every request after it.
 */
(function () {
	"use strict";
	var GUARD = Symbol.for("sbxdiff.plaintext");
	var self_ = typeof globalThis !== "undefined" ? globalThis : this;
	if (!self_ || self_[GUARD]) return;
	self_[GUARD] = true;

	/** Chunk marker. Distinct from the guest-op recorder's `sbxgop`. */
	var MARK = "sbxpt";
	/**
	 * The tracer truncates a traced string at 512 bytes, so a payload chunk
	 * cannot go out in one call. It is sliced, and each slice is escaped to
	 * stay inside the cap even in the worst case (every character escaping to
	 * six).
	 */
	var SLICE = 64;
	/**
	 * Only strings in this range are candidates. Below 512 is ordinary string
	 * work; above 70000 is a document, not a payload chunk.
	 */
	var MIN = 512;
	var MAX = 70000;
	/** Stop after this much, so a pathological run cannot fill the disk. */
	var BUDGET = 4 * 1024 * 1024;

	var doc = self_.document;
	var sink = null;
	if (doc && doc.createComment) {
		var cc = Function.prototype.bind.call(doc.createComment, doc);
		sink = function (s) {
			cc(s);
		};
	} else if (typeof self_.URL === "function") {
		// A worker has no document. `URL.constructor` is a traced binding that
		// records its string ARGUMENT, and an opaque-path URL parses without
		// touching the network. The challenge encodes inside blob workers, so
		// this is not an edge case -- it is most of the payload.
		var U = self_.URL;
		sink = function (s) {
			new U("sbxpt:" + s);
		};
	}
	if (!sink) return;

	var spent = 0;
	var nextId = 1;
	var seen = Object.create(null);

	/** Escape to a byte-safe, separator-safe form the decoder can invert. */
	var esc = function (s) {
		var out = "";
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c === 0x5c) out += "\\\\";
			else if (c === 0x7c) out += "\\p";
			else if (c >= 0x20 && c < 0x7f) out += s.charAt(i);
			else out += "\\u" + ("000" + c.toString(16)).slice(-4);
		}

		return out;
	};

	var hash = function (s) {
		var h = 0x811c9dc5;
		for (var i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i) & 0xff;
			h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
		}

		return h.toString(36);
	};

	/** Mostly-printable: the filter that separates a payload from binary. */
	var printable = function (s) {
		var ok = 0;
		var step = s.length > 2048 ? 7 : 1;
		var n = 0;
		for (var i = 0; i < s.length; i += step) {
			n++;
			var c = s.charCodeAt(i);
			if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c < 0x7f)) ok++;
		}

		return n > 0 && ok / n > 0.9;
	};

	var emit = function (kind, s) {
		if (spent >= BUDGET) return;
		var key = kind + ":" + s.length + ":" + hash(s);
		if (seen[key]) return;
		seen[key] = 1;

		var id = nextId++;
		var esced = esc(s);
		var parts = Math.ceil(esced.length / SLICE) || 1;
		// A header of its own, so a chunk whose tail is lost to a killed run is
		// still identifiable and still reports its TRUE length.
		sink(
			MARK +
				"h|" +
				id +
				"|" +
				kind +
				"|" +
				s.length +
				"|" +
				hash(s) +
				"|" +
				parts
		);
		for (var i = 0; i < parts; i++) {
			sink(
				MARK +
					"d|" +
					id +
					"|" +
					i +
					"|" +
					esced.slice(i * SLICE, (i + 1) * SLICE)
			);
		}
		spent += esced.length;
	};

	// ---- charCodeAt: the LZW input --------------------------------------
	var S = self_.String;
	if (S && S.prototype && typeof S.prototype.charCodeAt === "function") {
		var nativeCCA = S.prototype.charCodeAt;
		// `last` makes this affordable. LZW calls `charCodeAt` once per
		// character, so a naive hook runs millions of times; the length test is
		// a property read and the identity test short-circuits on the pointer,
		// so a repeat receiver costs two comparisons and nothing else.
		var last = null;
		try {
			Object.defineProperty(S.prototype, "charCodeAt", {
				value: function (i) {
					var len = this.length;
					if (len >= MIN && len <= MAX && this !== last) {
						last = this;
						try {
							var v = String(this);
							if (printable(v)) emit("lzw", v);
						} catch (err) {
							/* a receiver that resists String(); not our payload */
						}
					}

					return nativeCCA.call(this, i);
				},
				writable: true,
				configurable: true,
			});
		} catch (err) {
			/* frozen prototype; the JSON seam below still works */
		}
	}

	// ---- JSON.stringify: the conventionally-serialised fields ------------
	var J = self_.JSON;
	if (J && typeof J.stringify === "function") {
		var nativeStringify = J.stringify;
		try {
			J.stringify = function () {
				var out = nativeStringify.apply(J, arguments);
				if (typeof out === "string" && out.length >= 64) emit("json", out);

				return out;
			};
		} catch (err) {
			/* non-writable JSON.stringify; nothing else to do */
		}
	}

	try {
		console.info(
			"sbxdiff-plaintext: installed (" + (doc ? "document" : "worker") + ")"
		);
	} catch (err) {
		/* no console */
	}
})();
