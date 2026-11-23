import { serverTest } from "../testcommon.ts";

// The markup sinks hand the page's string to the browser untouched when a scan
// finds nothing a rewrite would change. Each of these spells a rewritten
// attribute or element the way the HTML tokenizer still reads as one, and
// each has to load through the proxy, whichever sink parsed it
const FRAGMENTS = [
	`<IMG SRC="{p}1">`,
	`<img/src="{p}2">`,
	`<img alt="x"src="{p}3">`,
	`<svg><image xlink:href="{p}4" width="1" height="1"></image></svg>`,
	`<img src={p}5>`,
	`<div style="background:url({p}6)">x</div>`,
	`<style>#{id}{background:url({p}7)}</style><div id="{id}">x</div>`,
	`<img\nsrc="{p}8">`,
	`<details open ontoggle="fetch('{p}9?' + location.host)"><summary>x</summary></details>`,
	`<DIV><IMG\tSrC='{p}10'></DIV>`,
];

const SINKS = ["i", "d", "r", "u"];
const EXPECTED = SINKS.flatMap((k) =>
	FRAGMENTS.map((_, i) => `/f/${k}/${i + 1}`)
);

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64"
);

export default [
	serverTest({
		scramjetOnly: true,
		name: "innerhtml-fastpath-still-rewrites",
		start: async (server, port, { pass, fail }) => {
			const seen = new Set<string>();
			server.on("request", (req, res) => {
				const [path, query] = (req.url ?? "/").split("?");
				if (path === "/") {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`<!doctype html><body><script>
						const adopt = (doc) =>
							document.body.append(...doc.head.childNodes, ...doc.body.childNodes);
						const sinks = {
							i: (html) => {
								const div = document.createElement("div");
								document.body.appendChild(div);
								div.innerHTML = html;
							},
							d: (html) => adopt(new DOMParser().parseFromString(html, "text/html")),
							r: (html) => {
								const range = document.createRange();
								range.selectNode(document.body);
								document.body.appendChild(range.createContextualFragment(html));
							},
							u: (html) => adopt(Document.parseHTMLUnsafe(html)),
						};
						for (const [k, sink] of Object.entries(sinks))
							for (const html of ${JSON.stringify(FRAGMENTS)})
								sink(html.replaceAll("{p}", "/f/" + k + "/").replaceAll("{id}", "s" + k));
					</script>`);
					return;
				}
				if (path.startsWith("/f/")) {
					res.writeHead(200, { "Content-Type": "image/png" });
					res.end(PNG);
					// an unrewritten handler reads the proxy's own location
					if (!path.endsWith("/9") || query === `localhost:${port}`)
						seen.add(path);
					if (seen.size === EXPECTED.length) pass("every fragment rewritten");
					return;
				}
				res.writeHead(404);
				res.end();
			});
			setTimeout(() => {
				const missing = EXPECTED.filter((p) => !seen.has(p));
				if (missing.length) fail("never requested: " + missing.join(" "));
			}, 8000);
		},
	}),
];
