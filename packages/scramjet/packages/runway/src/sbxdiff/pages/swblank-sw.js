// Answers /swmarker.js itself, so "did the worker see this request" is legible
// in the response rather than inferred from timing. Claims its clients on
// activation so the page that registered it is controlled without a reload.
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
	const u = new URL(e.request.url);
	if (u.pathname !== "/swmarker.js") return;
	const which = u.search.slice(1) || "unknown";
	e.respondWith(
		new Response(
			`try{parent.document.title='sw.marker.${which}=sw';}catch(e){}`,
			{ headers: { "content-type": "application/javascript" } }
		)
	);
});
