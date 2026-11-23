import { serverTest } from "../testcommon.ts";

// innerHTML hands the page's string to the browser untouched when a scan finds
// nothing a rewrite would change. Each of these spells a rewritten attribute
// or element the way the HTML tokenizer still reads as one, and each has to
// load through the proxy
const FRAGMENTS = [
	`<IMG SRC="/f/1">`,
	`<img/src="/f/2">`,
	`<img alt="x"src="/f/3">`,
	`<svg><image xlink:href="/f/4" width="1" height="1"></image></svg>`,
	`<img src=/f/5>`,
	`<div style="background:url(/f/6)">x</div>`,
	`<style>#f7{background:url(/f/7)}</style><div id="f7">x</div>`,
	`<img\nsrc="/f/8">`,
	`<details open ontoggle="fetch('/f/9?' + location.host)"><summary>x</summary></details>`,
	`<DIV><IMG\tSrC='/f/10'></DIV>`,
];

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
					res.end(
						`<!doctype html><body><script>
							for (const html of ${JSON.stringify(FRAGMENTS)}) {
								const div = document.createElement("div");
								document.body.appendChild(div);
								div.innerHTML = html;
							}
						</script>`
					);
					return;
				}
				if (path.startsWith("/f/")) {
					res.writeHead(200, { "Content-Type": "image/png" });
					res.end(PNG);
					// an unrewritten handler reads the proxy's own location
					if (path !== "/f/9" || query === `localhost:${port}`) seen.add(path);
					if (seen.size === FRAGMENTS.length) pass("every fragment rewritten");
					return;
				}
				res.writeHead(404);
				res.end();
			});
			setTimeout(() => {
				const missing = FRAGMENTS.map((_, i) => `/f/${i + 1}`).filter(
					(p) => !seen.has(p)
				);
				if (missing.length) fail("never requested: " + missing.join(" "));
			}, 8000);
		},
	}),
];
