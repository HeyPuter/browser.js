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
];
