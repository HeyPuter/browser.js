// The real file on disk. Reaching this means the request went over the NETWORK
// and the service worker never saw it; `swblank-sw.js` answers the same URL
// with "sw" when it does.
//
// `document.currentScript`, not `location`: a classic script's `location` is
// the DOCUMENT's, so inside a blank frame it has no search at all and every
// marker reported itself as the top-level one.
try {
	const src = (document.currentScript && document.currentScript.src) || "";
	const which = src.slice(src.indexOf("?") + 1) || "unknown";
	parent.document.title = "sw.marker." + which + "=network";
} catch (e) {
	// a detached or cross-origin parent is itself an answer, but not one this
	// probe can write down
}
