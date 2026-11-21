import http from "http";
import { playwrightTest } from "../testcommon.ts";

// The service worker is stopped (as Chrome does to an idle one)
// while a proxied page stays open, then the page POSTs. The POST must still
// reach the site through the proxy, not the proxy host's own server.
const PAGE = `<!DOCTYPE html>
<button id="go">go</button>
<div id="out">pending</div>
<script>
	document.getElementById("go").onclick = () => {
		fetch("/post", { method: "POST", body: "marker" })
			.then((r) => r.text())
			.then((t) => (document.getElementById("out").textContent = "done:" + t))
			.catch((e) => (document.getElementById("out").textContent = "error:" + e));
	};
</script>`;

function revivalTest(name: string) {
	return playwrightTest({
		name,
		fn: async ({ page, frame, navigate }) => {
			let posts = 0;
			const server = http.createServer((req, res) => {
				if (req.url === "/post" && req.method === "POST") {
					posts++;
					res.writeHead(200, { "Content-Type": "text/plain" });
					res.end("ok");
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(PAGE);
			});
			await new Promise<void>((resolve) => server.listen(0, resolve));
			const port = (server.address() as { port: number }).port;
			const cdp = await page.context().newCDPSession(page);

			try {
				await navigate(`http://localhost:${port}/`);
				await frame.locator("#go").waitFor({ timeout: 10000 });
				// let the controller's init (and the prefix write) land
				await page.waitForTimeout(500);

				await cdp.send("ServiceWorker.enable");
				await cdp.send("ServiceWorker.stopAllWorkers");
				await page.waitForTimeout(300);

				await frame.locator("#go").click();
				const out = frame.locator("#out");
				await out.filter({ hasNotText: "pending" }).waitFor({ timeout: 15000 });
				const text = await out.textContent();
				if (posts !== 1 || text !== "done:ok") {
					throw new Error(
						`after the worker stopped: site saw ${posts} POST(s), page got ${JSON.stringify(text)}`
					);
				}
			} finally {
				await cdp.detach().catch(() => {});
				server.close();
			}
		},
	});
}

export default [revivalTest("sw-revival-idle-stop-post")];
