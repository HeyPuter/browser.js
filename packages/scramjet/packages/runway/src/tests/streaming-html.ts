import { serverTest } from "../testcommon.ts";

// A document is rewritten as it arrives. This one arrives in pieces cut
// inside a tag name, an attribute name, an attribute value, a script, a style
// and a comment, and every one of them has to come out the way the whole
// document would have.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64"
);

const SCRIPT = `
	var parts = [document.compatMode, document.head.getAttribute("data-h")];
	parts.push(location.host);
	parts.push(document.currentScript.textContent === SOURCE ? "source" : "rewritten-source");
	fetch("/r/script?" + encodeURIComponent(parts.join(",")));
`;

const DOC =
	`<!doctype html><html lang="en"><head data-h="kept"><title>t</title>` +
	`<style>#s{background:url(/r/style)}</style>` +
	`<script>var SOURCE = ${JSON.stringify("REPLACED")};</script>` +
	`<script>${SCRIPT}</script>` +
	`</head><body><!-- a <img src="/r/never"> comment -->` +
	`<img src="/r/img"><div id="s">x</div>` +
	`<img data-x="1" srcset="/r/srcset 1x"></body></html>`;

// the script compares its own source against what the page wrote
const PAGE = DOC.replace(`"REPLACED"`, JSON.stringify(SCRIPT));

const EXPECTED = ["/r/style", "/r/img", "/r/srcset", "/r/script"];

export default [
	serverTest({
		scramjetOnly: true,
		name: "streaming-html-split-everywhere",
		start: async (server, port, { pass, fail }) => {
			const seen = new Set<string>();
			server.on("request", async (req, res) => {
				const [path, query] = (req.url ?? "/").split("?");
				if (path === "/") {
					res.writeHead(200, { "Content-Type": "text/html" });
					// cut every few characters, so most cuts land mid-token
					for (let at = 0; at < PAGE.length; at += 7) {
						res.write(PAGE.slice(at, at + 7));
						await new Promise((r) => setTimeout(r, 2));
					}
					res.end();
					return;
				}
				if (path === "/r/never")
					fail("a comment's markup was rewritten into a request");
				if (path.startsWith("/r/")) {
					if (path === "/r/script") {
						const want = `CSS1Compat,kept,localhost:${port},source`;
						const got = decodeURIComponent(query ?? "");
						if (got !== want) fail(`script saw ${got}, wanted ${want}`);
					}
					seen.add(path);
					res.writeHead(200, { "Content-Type": "image/png" });
					res.end(PNG);
					if (EXPECTED.every((p) => seen.has(p))) pass("every piece rewritten");
					return;
				}
				res.writeHead(404);
				res.end();
			});
			setTimeout(() => {
				const missing = EXPECTED.filter((p) => !seen.has(p));
				if (missing.length) fail("never requested: " + missing.join(" "));
			}, 10000);
		},
	}),
];
