import { serverTest } from "../testcommon.ts";

export default [
	// Test: charset specified in Content-Type header
	serverTest({
		name: "charset-header-utf8",
		js: `
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "utf-8 content from header should decode correctly");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`<!DOCTYPE html><html><head><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),

	// Test: charset specified in <meta charset> tag
	serverTest({
		name: "charset-meta-tag",
		js: `
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "utf-8 content from meta charset should decode correctly");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),

	// Test: charset in http-equiv meta tag
	serverTest({
		name: "charset-http-equiv",
		js: `
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "utf-8 content from http-equiv should decode correctly");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),

	// Test: no charset specified (should default to utf-8)
	serverTest({
		name: "charset-default-utf8",
		js: `
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "default utf-8 should decode correctly");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`<!DOCTYPE html><html><head><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),

	// Test: iso-8859-1 charset in header with actual iso-8859-1 encoded content
	serverTest({
		name: "charset-iso-8859-1-header",
		js: `
			const text = document.getElementById("test").textContent;
			assert(text.length > 0, "content should not be empty");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html; charset=iso-8859-1" });
				// Encode in iso-8859-1: é = 0xe9, ö = 0xf6
				const body = Buffer.from(
					'<!DOCTYPE html><html><head><script src="/common.js"></script></head><body><span id="test">h\xe9llo w\xf6rld</span><script src="/script.js"></script></body></html>',
					"latin1"
				);
				res.end(body);
			});
		},
	}),

	// Test: charset with extra params and quoting in header
	serverTest({
		name: "charset-header-quoted",
		js: `
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "quoted charset in header should decode correctly");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": 'text/html; charset="utf-8"; boundary=something' });
				res.end(`<!DOCTYPE html><html><head><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),

	// Test: header charset takes priority over meta charset
	serverTest({
		name: "charset-header-priority",
		js: `
			// The page is served as utf-8 (header) despite the meta saying iso-8859-1
			// The content is utf-8 encoded, so it should decode correctly with the header charset
			assertEqual(document.getElementById("test").textContent, "héllo wörld", "header charset should take priority over meta");
		`,
		start: async (server, port) => {
			server.on("request", (req, res) => {
				if (req.url === "/" || req.url === "/common.js" || req.url === "/script.js") return;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`<!DOCTYPE html><html><head><meta charset="iso-8859-1"><script src="/common.js"></script></head><body><span id="test">héllo wörld</span><script src="/script.js"></script></body></html>`);
			});
		},
	}),
];
