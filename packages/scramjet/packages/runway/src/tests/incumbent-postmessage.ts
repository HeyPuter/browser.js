import { incumbenceMatrix } from "../incumbence.ts";

/**
 * https://html.spec.whatwg.org/multipage/web-messaging.html#window-post-message-steps
 *
 *   Let source be the WindowProxy object corresponding to incumbent settings
 *   object's global object (a Window object).
 *
 * The **incumbent** settings object, where `window.open` uses the entry one, so
 * the two answer sheets differ - the column below is not the one in
 * `incumbent.ts`, and every row where they disagree is a row where an
 * implementation that computes one settings object and uses it for both is
 * wrong about one of them.
 *
 * The message always goes to the top and always through the top's own
 * `postMessage`, so the only thing varying down the column is which realm the
 * browser considers to be running.
 *
 * The other two things `postMessage` takes from the incumbent settings object -
 * the message's `origin`, and what a `targetOrigin` of `"/"` matches - are its
 * origin rather than its identity, and every realm here is same origin, which
 * they have to be to reach into each other at all. `source` is the observable
 * that distinguishes them.
 */
export default incumbenceMatrix({
	prefix: "incumbent-postmessage",
	sink: (win) => `${win}.__top.postMessage('ping', '*')`,
	setup: {
		top: `addEventListener('message', function (e) {
			var realm = 'unknown';
			try {
				if (e.source === window) realm = 'top';
				else if (e.source === frames[0]) realm = 'frame';
				else if (frames[0] && e.source === frames[0].frames[0]) realm = 'sub';
			} catch (err) {}
			__report(realm);
		})`,
	},
	expect: {
		sanity: "frame",
		"sanity-sanity": "top",
		crossrealm: "frame",
		functioncall: "top",
		eval: "top",
		functionctor: "top",
		settimeout: "top",
		"settimeout-cb": "frame",
		promise: "top",
		"promise-cb": "top",
		"event-listener": "frame",
		"event-listener-foreign-cb": "top",
		"reverse-functioncall": "frame",
		"three-realm": "sub",
		"builtin-callback": "top",
		"async-crossrealm-function": "top",
		"inline-handler": "frame",
		"message-event": "frame",
	},
});
