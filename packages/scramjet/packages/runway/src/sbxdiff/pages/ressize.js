// A script big enough, and rewritable enough, that proxying changes its size.
//
// The rewriter expands every global it has to route through the shim, and
// prepends its sourcemap on top of that, so the bytes the browser receives for
// this file are not the bytes the site served. `ressize.html` checks that the
// page cannot tell.
(function () {
	const bits = [];
	for (let i = 0; i < 40; i++) {
		bits.push(window.location.href);
		bits.push(document.location.protocol);
		bits.push(String(window.top === window.self));
		bits.push(String(typeof window.fetch));
		bits.push(String(typeof window.XMLHttpRequest));
		bits.push(String(navigator.userAgent).slice(0, 4));
	}
	window.__ressize = bits.length;
})();
