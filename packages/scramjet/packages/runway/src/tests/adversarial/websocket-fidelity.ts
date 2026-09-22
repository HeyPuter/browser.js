import { serverTest } from "../../testcommon.ts";
import { WebSocketServer } from "ws";
import type { Server } from "http";

/* eslint-disable quotes -- browser snippets are clearer as template literals */

// `shared/requests/WebSocket.ts` does not wrap a real WebSocket, it builds an
// EventTarget, reparents it onto `WebSocket.prototype` and answers every
// member out of a side table. That buys a socket the proxy can carry, and it
// means every observable a real socket has must be reproduced by hand - so
// this covers the ones that are cheap for a page to look at.

function echo(server: Server) {
	const wss = new WebSocketServer({ server });

	wss.on("connection", (socket) => {
		socket.on("message", (message, isBinary) => {
			socket.send(message, { binary: isBinary });
		});
	});

	return wss;
}

export default [
	// https://html.spec.whatwg.org/multipage/webappapis.html#activate-an-event-handler
	//
	// An `on*` handler is a listener like any other, added when it is first
	// set - so one set after an addEventListener runs after it. Replacing the
	// handler keeps that place; clearing it and setting it again moves it to
	// the end.
	serverTest({
		name: "wsfidelity-handler-listener-order",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			const order = [];
			let round = 0;
			socket.addEventListener("message", () => order.push("a"));
			socket.onmessage = () => order.push("h1");
			socket.addEventListener("message", () => order.push("b"));
			socket.addEventListener("message", () => {
				round++;
				if (round === 1) {
					// replaced in place: still between a and b
					socket.onmessage = () => order.push("h2");
					socket.send("two");
				} else if (round === 2) {
					// cleared and set again: now last
					socket.onmessage = null;
					socket.onmessage = () => order.push("h3");
					socket.send("three");
				} else {
					// h3 is after this listener, so check once the dispatch is done
					setTimeout(() => {
						socket.close();
						assertEqual(
							order.join(","),
							"a,h1,b,a,h2,b,a,b,h3",
							"the handler runs where it was added"
						);
						pass();
					});
				}
			});
			socket.onopen = () => socket.send("one");
			socket.onerror = () => fail("socket errored");
		`,
		async start(server) {
			echo(server);
		},
	}),

	// the handler is invoked by the dispatch, with the socket as `this`,
	// `target` set and `isTrusted` true - not called by hand ahead of it
	serverTest({
		name: "wsfidelity-handler-sees-the-dispatched-event",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.onmessage = function (e) {
				const got = {
					thisIsSocket: this === socket,
					target: e.target === socket,
					trusted: e.isTrusted,
					data: e.data,
				};
				socket.close();
				assertEqual(JSON.stringify(got), JSON.stringify({
					thisIsSocket: true, target: true, trusted: true, data: "hi",
				}), "the handler sees the dispatched event");
				pass();
			};
			socket.onopen = () => socket.send("hi");
			socket.onerror = () => fail("socket errored");
		`,
		async start(server) {
			echo(server);
		},
	}),

	// [LegacyTreatNonObjectAsNull]: a primitive is null, an object is kept and
	// read back as itself, and neither throws when the event fires
	serverTest({
		name: "wsfidelity-handler-value-conversion",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.onmessage = 5;
			assertEqual(socket.onmessage, null, "a primitive reads back as null");
			const obj = {};
			socket.onmessage = obj;
			assert(socket.onmessage === obj, "an object reads back as itself");
			socket.addEventListener("message", () => {
				socket.close();
				pass();
			});
			socket.onopen = () => socket.send("x");
			socket.onerror = () => fail("socket errored");
		`,
		async start(server) {
			echo(server);
		},
	}),

	// A WebSocket has no own properties at all: `url`, `readyState` and the
	// event handlers are all prototype accessors, and `constructor` is on the
	// prototype too. An own property of any name is a one-expression tell.
	serverTest({
		name: "wsfidelity-instance-has-no-own-properties",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.addEventListener("open", () => {
				const own = Object.getOwnPropertyNames(socket);
				socket.close();
				assertEqual(
					own.join(","),
					"",
					"a WebSocket instance has no own properties"
				);
				pass();
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			echo(server);
		},
	}),

	// https://dom.spec.whatwg.org/#dom-event-istrusted
	//
	// Every event a socket fires is dispatched by the browser, so `isTrusted`
	// is true - and it has to be true for both ways of listening, not just the
	// `onopen` half.
	serverTest({
		name: "wsfidelity-events-are-trusted",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.addEventListener("open", (event) => {
				const trusted = event.isTrusted;
				socket.close();
				assertEqual(
					trusted,
					true,
					"an open event delivered to addEventListener is trusted"
				);
				pass();
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			echo(server);
		},
	}),

	// https://websockets.spec.whatwg.org/#dom-websocket-close
	//
	// `close(code)` is `[Clamp] unsigned short`, and the code must then be 1000
	// or in 3000-4999. 70000 clamps to 65535, which is neither, so it is an
	// InvalidAccessError. Converting it as a plain `unsigned short` wraps it to
	// 4464 instead, which is inside the allowed range - so the call silently
	// succeeds and closes the socket with a code the page never named.
	serverTest({
		name: "wsfidelity-close-code-is-clamped",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.addEventListener("open", () => {
				let threw = null;
				try {
					socket.close(70000);
				} catch (error) {
					threw = error.name;
				}
				try {
					socket.close();
				} catch {}
				assertEqual(
					threw,
					"InvalidAccessError",
					"close(70000) clamps to 65535 and is rejected"
				);
				pass();
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			echo(server);
		},
	}),

	// https://websockets.spec.whatwg.org/#dom-websocket-send
	//
	// `send()` before the handshake finishes is an InvalidStateError, which is
	// how a page detects that it raced its own open.
	serverTest({
		name: "wsfidelity-send-while-connecting-throws",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			assertEqual(socket.readyState, WebSocket.CONNECTING, "socket is connecting");

			let threw = null;
			try {
				socket.send("too early");
			} catch (error) {
				threw = error.name;
			}
			socket.addEventListener("open", () => socket.close());
			assertEqual(
				threw,
				"InvalidStateError",
				"send() while CONNECTING throws InvalidStateError"
			);
			pass();
		`,
		async start(server) {
			echo(server);
		},
	}),

	// https://websockets.spec.whatwg.org/#dom-websocket-close step 3.2
	//
	// A close during CONNECTING fails the connection: CLOSING at once, never
	// an `open`, then `error` and a `close` with 1006 and wasClean false. The
	// state only ever moves forward.
	serverTest({
		name: "wsfidelity-close-while-connecting-fails",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			const seen = [];
			const states = [socket.readyState];
			socket.close();
			states.push(socket.readyState);
			socket.addEventListener("open", () => seen.push("open"));
			socket.addEventListener("error", () => {
				seen.push("error");
				states.push(socket.readyState);
			});
			socket.addEventListener("close", (e) => {
				seen.push("close:" + e.code + ":" + e.wasClean);
				states.push(socket.readyState);
				// long enough for the handshake to finish behind it
				setTimeout(() => {
					states.push(socket.readyState);
					assertEqual(seen.join(","), "error,close:1006:false", "the connection fails");
					assertEqual(states.join(","), "0,2,3,3,3", "readyState only moves forward");
					pass();
				}, 300);
			});
		`,
		async start(server) {
			echo(server);
		},
	}),

	// https://websockets.spec.whatwg.org/#dom-websocket-close step 3.4 and
	// #dom-websocket-send - after close() the socket is CLOSING: a second
	// close() does nothing, a send() is discarded and neither throws, and the
	// closing handshake completes cleanly.
	serverTest({
		name: "wsfidelity-closing-state",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.addEventListener("open", () => {
				socket.close(1000, "bye");
				assertEqual(socket.readyState, WebSocket.CLOSING, "CLOSING after close()");
				socket.close(3001);
				assertEqual(socket.send("late"), undefined, "a send while CLOSING returns undefined");
				assertEqual(socket.readyState, WebSocket.CLOSING, "still CLOSING");
			});
			socket.addEventListener("message", () => fail("a discarded send was echoed"));
			socket.addEventListener("close", (e) => {
				assertEqual(e.code + ":" + e.reason + ":" + e.wasClean, "1000:bye:true", "a clean close");
				assertEqual(socket.readyState, WebSocket.CLOSED, "CLOSED");
				pass();
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			echo(server);
		},
	}),

	// send() returns undefined, not the transport's promise
	serverTest({
		name: "wsfidelity-send-returns-undefined",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.addEventListener("open", () => {
				assertEqual(socket.send("x"), undefined, "send() returns undefined");
			});
			socket.addEventListener("message", () => {
				socket.close();
				pass();
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			echo(server);
		},
	}),

	// frames reach the page in the order they were sent, whatever each one
	// takes to convert
	serverTest({
		name: "wsfidelity-message-order",
		autoPass: false,
		js: `
			const socket = new WebSocket("ws://localhost:" + location.port);
			socket.binaryType = "arraybuffer";
			const got = [];
			socket.addEventListener("message", (e) => {
				got.push(typeof e.data === "string" ? e.data : "bin" + e.data.byteLength);
				if (got.length === 4) {
					socket.close();
					assertEqual(got.join(","), "bin3,a,bin1,b", "messages arrive in order");
					assertEqual(e.origin, "ws://localhost:" + location.port, "origin is the socket's");
					pass();
				}
			});
			socket.addEventListener("error", () => fail("socket errored"));
		`,
		async start(server) {
			const wss = new WebSocketServer({ server });
			wss.on("connection", (socket) => {
				socket.send(Buffer.from([1, 2, 3]), { binary: true });
				socket.send("a");
				socket.send(Buffer.from([4]), { binary: true });
				socket.send("b");
			});
		},
	}),

	// https://websockets.spec.whatwg.org/#dom-websocket-websocket steps 1-6
	serverTest({
		name: "wsfidelity-url-parsing",
		autoPass: false,
		js: `
			const relative = new WebSocket("/sock?x=1");
			assertEqual(relative.url, "ws://localhost:" + location.port + "/sock?x=1", "resolved and mapped to ws:");
			relative.close();

			const errorName = (url) => {
				try {
					new WebSocket(url);
				} catch (e) {
					return e.name;
				}
				return "none";
			};
			assertEqual(errorName("ftp://localhost/"), "SyntaxError", "a non-ws scheme");
			assertEqual(errorName("ws://localhost/#frag"), "SyntaxError", "a fragment");
			assertEqual(errorName("ws://localhost/#"), "SyntaxError", "an empty fragment");
			assertEqual(errorName("http://[::1"), "SyntaxError", "an unparseable URL");
			pass();
		`,
		async start(server) {
			echo(server);
		},
	}),

	// The handshake carries the page's origin and the *target's* cookies: a
	// socket to another site is not sent the page's own
	serverTest({
		name: "wsfidelity-handshake-cookies-and-origin",
		autoPass: false,
		js: `
			document.cookie = "wsfidelity=page";
			const ask = (host) => new Promise((resolve, reject) => {
				const socket = new WebSocket("ws://" + host + ":" + location.port);
				socket.onmessage = (e) => {
					socket.close();
					resolve(JSON.parse(e.data));
				};
				socket.onerror = () => reject(new Error("socket to " + host + " errored"));
			});
			const same = await ask("localhost");
			assertEqual(same.origin, location.origin, "Origin is the page's");
			assert((same.cookie || "").includes("wsfidelity=page"), "a same-site socket carries the cookie");
			const cross = await ask("127.0.0.1");
			assert(!(cross.cookie || "").includes("wsfidelity=page"), "a cross-site socket does not: " + cross.cookie);
			pass();
		`,
		async start(server) {
			const wss = new WebSocketServer({ server });
			wss.on("connection", (socket, req) => {
				socket.send(
					JSON.stringify({
						origin: req.headers.origin,
						cookie: req.headers.cookie,
					})
				);
			});
		},
	}),

	// WebSocketStream: a relative URL opens, messages read in order and the
	// readable ends when the server closes, and there are no own properties
	serverTest({
		name: "wsfidelity-stream-reads-to-close",
		autoPass: false,
		js: `
			if (typeof WebSocketStream === "undefined") { pass("no WebSocketStream"); return; }
			const wss = new WebSocketStream("/");
			assertEqual(wss.url, "ws://localhost:" + location.port + "/", "resolved and mapped to ws:");
			assertEqual(Object.getOwnPropertyNames(wss).join(","), "", "no own properties");
			const { readable } = await wss.opened;
			const got = [];
			for await (const chunk of readable) got.push(chunk);
			assertEqual(got.join(","), "a,b", "read to the end");
			// resolving at all is the clean close. The code is not checked:
			// the harness transport reports closes without one
			const info = await wss.closed;
			assertEqual(typeof info.closeCode, "number", "closed cleanly");
			pass();
		`,
		async start(server) {
			const wss = new WebSocketServer({ server });
			wss.on("connection", (socket) => {
				socket.send("a");
				socket.send("b");
				socket.close(1000);
			});
		},
	}),

	// WebSocketStream close() before the handshake finishes rejects both
	// promises rather than throwing
	serverTest({
		name: "wsfidelity-stream-close-while-connecting",
		autoPass: false,
		js: `
			if (typeof WebSocketStream === "undefined") { pass("no WebSocketStream"); return; }
			const wss = new WebSocketStream("ws://localhost:" + location.port);
			wss.close();
			const opened = await wss.opened.then(() => "resolved", () => "rejected");
			const closed = await wss.closed.then(() => "resolved", () => "rejected");
			assertEqual(opened + "," + closed, "rejected,rejected", "both reject");

			const ctl = new AbortController();
			const aborted = new WebSocketStream("ws://localhost:" + location.port, { signal: ctl.signal });
			ctl.abort();
			const r = await aborted.opened.then(() => "resolved", (e) => e.name);
			assertEqual(r, "AbortError", "an abort rejects with the signal's reason");
			pass();
		`,
		async start(server) {
			echo(server);
		},
	}),
];
