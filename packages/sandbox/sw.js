importScripts("./controller.sw.js");

addEventListener("fetch", (event) => {
	if ($scramjetController.shouldRoute(event)) {
		event.respondWith($scramjetController.route(event));
	}
});

console.log("sw initialized");
