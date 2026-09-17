// Loaded by `blankframe.html` from inside a blank iframe, by a script that
// iframe's document did not originally contain. Reaching this file at all is
// the thing being tested: it means a relative `src` in an about:blank document
// resolved against the creator's URL and the fetch was actually served.
//
// It also records what a script LOADED THIS WAY can see about itself. In the
// sandbox such a script is fetched by a controlled ancestor and installed as
// inline text, which is not the same thing as being loaded from a `src`, and
// the differences are exactly what a script that bootstraps from its own
// context would trip over -- Cloudflare's JS detections stop dead a few
// operations in.
window.__markerRan = (window.__markerRan || 0) + 1;
window.__markerEnv = (function () {
	const cs = document.currentScript;
	const env = {};
	try {
		env.hasCurrentScript = !!cs;
		env.currentScriptSrc = cs ? String(cs.src) : "none";
		env.currentScriptTag = cs ? cs.tagName : "none";
		env.isConnected = cs ? String(cs.isConnected) : "none";
		env.readyState = document.readyState;
		env.docURL = document.URL;
		env.baseURI = document.baseURI;
		env.hasBody = !!document.body;
		env.origin = String(document.location.origin);
	} catch (e) {
		env.threw = e.name + ":" + e.message;
	}

	return env;
})();
