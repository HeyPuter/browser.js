import { serverTest } from "../../testcommon.ts";

/* eslint-disable quotes -- browser snippets are clearer as template literals */

// `requests/XMLHttpRequest.ts` restores the response header list from the
// `x-scramjet-` carriers `rewriteResponseHeaders` wrote. The fetch side of the
// same restoration gates on `box.taggedHeaders`, so a Headers object that
// never came off the wire is left alone; the XHR side has no such gate and
// assumes every response it ever sees carries them. Anything that reaches XHR
// without going through the rewriter therefore reads back as a response with
// no headers at all.

export default [
	// A `data:` URL response is synthesized rather than fetched, and its
	// Content-Type is the one thing a page reads off it.
	serverTest({
		name: "xhrfidelity-data-url-response-headers",
		autoPass: false,
		js: `
			const xhr = new XMLHttpRequest();
			xhr.open("GET", "data:text/plain,xhrfidelity");
			xhr.onload = () => {
				const type = xhr.getResponseHeader("content-type");
				const all = xhr.getAllResponseHeaders();
				assertEqual(xhr.responseText, "xhrfidelity", "the body arrives");
				assert(
					type !== null,
					"getResponseHeader('content-type') is not null for a data: URL"
				);
				assert(
					all.length > 0,
					"getAllResponseHeaders() is not empty for a data: URL"
				);
				pass();
			};
			xhr.onerror = () => fail("data: URL request errored");
			xhr.send();
		`,
		async start() {},
	}),

	// The same through a Blob URL, which is the other response a page can
	// produce without the network.
	serverTest({
		name: "xhrfidelity-blob-url-response-headers",
		autoPass: false,
		js: `
			const url = URL.createObjectURL(
				new Blob(["xhrfidelity-blob"], { type: "text/plain" })
			);
			const xhr = new XMLHttpRequest();
			xhr.open("GET", url);
			xhr.onload = () => {
				const type = xhr.getResponseHeader("content-type");
				assertEqual(xhr.responseText, "xhrfidelity-blob", "the body arrives");
				assert(
					type !== null,
					"getResponseHeader('content-type') is not null for a blob: URL"
				);
				pass();
			};
			xhr.onerror = () => fail("blob: URL request errored");
			xhr.send();
		`,
		async start() {},
	}),

	// https://xhr.spec.whatwg.org/#the-open()-method
	//
	// `open()` throws InvalidAccessError for a synchronous request only when
	// there is no responsible document, or when `timeout` or `responseType`
	// has already been set. A plain synchronous request from a document is
	// legal - deprecated, warned about, and still used by plenty of code that
	// predates fetch.
	serverTest({
		name: "xhrfidelity-sync-open-is-allowed",
		autoPass: false,
		js: `
			const xhr = new XMLHttpRequest();
			let threw = null;
			try {
				xhr.open("GET", "/script.js", false);
			} catch (error) {
				threw = error.name + ": " + error.message;
			}
			assertEqual(threw, null, "a synchronous open() does not throw");
			pass();
		`,
		async start() {},
	}),
];
