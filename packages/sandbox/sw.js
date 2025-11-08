importScripts("./controller.sw.js");

addEventListener("fetch", (event) => {
	if ($scramjetController.shouldRoute(event)) {
		event.respondWith($scramjetController.route(event));
	}
});

self.addEventListener("install", () => {
	self.skipWaiting();
});

async function notify() {
	let clients = await self.clients.matchAll();
	for (let client of clients) {
		client.postMessage("ready");
	}
}

self.addEventListener("activate", (e) => {
	e.waitUntil(self.clients.claim().then(notify));
});

console.log("sw initialized");
notify();
