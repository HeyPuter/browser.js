importScripts("./controller.sw.js");

addEventListener("fetch", (event) => {
	if (shouldRoute(event)) {
		event.respondWith(route(event));
	}
});

self.addEventListener("install", () => {
	self.skipWaiting();
});

self.addEventListener("activate", (e) => {
	e.waitUntil(self.clients.claim());
});

console.log("sw initialized");
