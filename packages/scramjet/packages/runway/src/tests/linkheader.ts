import { serverTest } from "../testcommon.ts";

export default [
	serverTest({
		name: "linkheader-preload",
		start: async (server, port, { pass, fail }) => {
			server.on("request", (req, res) => {
				if (req.url === "/") {
					res.writeHead(200, {
						"Content-Type": "text/html",
						Link: `<http://localhost:${port}/script.js>; rel="preload"; as="script"`,
					});
					res.end();
				} else if (req.url === "/script.js") {
					console.log("script.js loaded");
					pass("script.js loaded");
				} else {
					console.log("unexpected url request", req.url);
					res.writeHead(404);
					res.end("Not found");
					fail("unexpected url request");
				}
			});
		},
	}),
];
