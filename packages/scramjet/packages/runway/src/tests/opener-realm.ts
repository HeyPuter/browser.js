import http from "node:http";
import { playwrightTest } from "../testcommon.ts";
/* eslint-disable quotes */

// A window hooked from outside while it is still the initial about:blank - a
// window.open popup, or an iframe whose contentWindow a page reads before its
// document commits - keeps its Window when that document commits, so whatever
// installed scramjet there has to step aside for the document's own copy.
// Otherwise every interceptor belongs to the realm that hooked it, and once
// that realm's document goes away Chrome stops running its jobs and callbacks.

const BATTERY = String.raw`
window.__r = {};
window.runTests = () => {
  const r = window.__r;
  const T = (k, f) => { try { f(); } catch (e) { r[k] = "throw " + e.message; } };
  const P = (k, f) => { try { Promise.resolve(f()).then((v) => { r[k] = "ok " + v; }, (e) => { r[k] = "reject " + e.message; }); } catch (e) { r[k] = "throw " + e.message; } };
  Promise.resolve().then(() => { r.promise = "ok"; });
  T("timeout", () => setTimeout(() => { r.timeout = "ok"; }, 10));
  T("listener", () => { const d = document.createElement("div"); d.addEventListener("x", () => { r.listener = "ok"; }); d.dispatchEvent(new Event("x")); });
  T("onclick", () => { const d = document.createElement("div"); d.onclick = () => { r.onclick = "ok"; }; d.click(); });
  T("message", () => { addEventListener("message", (e) => { r.message = "ok " + e.data; }); postMessage("hi", "*"); });
  T("mo", () => { new MutationObserver(() => { r.mo = "ok"; }).observe(document.body, { childList: true }); document.body.append("t"); });
  T("xhr", () => { const x = new XMLHttpRequest(); x.open("GET", "/data.txt"); x.onload = () => { r.xhr = "ok " + x.responseText; }; x.send(); });
  T("img", () => { const i = new Image(); i.onload = () => { r.img = "ok"; }; i.onerror = () => { r.img = "error"; }; i.src = "/img.gif"; });
  T("worker", () => { const w = new Worker("/w.js"); w.onmessage = (e) => { r.worker = "ok " + e.data; }; });
  P("fetch", () => fetch("/data.txt").then((x) => x.text()));
  P("fetchRequest", () => fetch(new Request("/data.txt")).then((x) => x.text()));
  P("import", () => { return import("/mod.js").then((m) => m.v); });
  P("caches", () => caches.open("c").then(() => 1));
  P("opfs", () => navigator.storage.getDirectory().then((d) => d.kind));
  P("idb", () => indexedDB.databases().then(() => 1));
  P("blob", () => new Blob(["b"]).text());
  r.href = location.pathname;
};
`;

const EXPECTED = {
	promise: "ok",
	timeout: "ok",
	listener: "ok",
	onclick: "ok",
	message: "ok hi",
	mo: "ok",
	xhr: "ok data",
	img: "ok",
	worker: "ok w",
	fetch: "ok data",
	fetchRequest: "ok data",
	import: "ok 1",
	caches: "ok 1",
	opfs: "ok directory",
	idb: "ok 1",
	blob: "ok b",
	href: "/child.html",
};

const GIF = Buffer.from(
	"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
	"base64"
);

type Kind =
	// the opener navigates once the popup has loaded
	| "popup-opener-navigates"
	// the opener is an iframe, removed once the popup has loaded
	| "popup-opener-removed"
	// the opener navigates while the popup is still waiting on its response,
	// so the hooking realm is already gone when the popup's document commits
	| "popup-opener-navigates-early"
	// a child frame makes an iframe in its parent's document, reads its
	// contentWindow before it commits, then navigates
	| "iframe-creator-navigates";

function serve(kind: Kind) {
	const opener =
		kind === "iframe-creator-navigates"
			? `<body><button id=b>go</button><script>document.getElementById("b").onclick = () => {
				const f = parent.document.createElement("iframe");
				f.id = "child";
				f.src = "/child.html";
				parent.document.body.append(f);
				// this frame's getter, not the parent's, so this realm hooks it
				Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow").get.call(f).document;
			};</script></body>`
			: '<body><button id=b>open</button><script>document.getElementById("b").onclick = () => { window.open("/child.html", "_blank"); };</script></body>';
	const top =
		kind === "popup-opener-removed" || kind === "iframe-creator-navigates"
			? '<body><iframe id=f src="/opener.html"></iframe></body>'
			: opener;

	return http.createServer(async (req, res) => {
		const p = req.url!.split("?")[0];
		const send = (type: string, body: string | Buffer) => {
			res.writeHead(200, { "Content-Type": type });
			res.end(body);
		};
		if (p === "/child.html") {
			if (kind === "popup-opener-navigates-early")
				await new Promise((r) => setTimeout(r, 1500));
			send(
				"text/html",
				`<!DOCTYPE html><body><script>${BATTERY}</script></body>`
			);
		} else if (p === "/opener.html") send("text/html", opener);
		else if (p === "/data.txt") send("text/plain", "data");
		else if (p === "/img.gif") send("image/gif", GIF);
		else if (p === "/mod.js") send("text/javascript", "export const v = 1;");
		else if (p === "/w.js") send("text/javascript", "postMessage('w');");
		else if (p === "/gone.html") send("text/html", "<body>gone</body>");
		else send("text/html", top);
	});
}

async function until<T>(f: () => Promise<T | undefined>, ms: number) {
	const end = Date.now() + ms;
	for (;;) {
		const v = await f().catch(() => undefined);
		if (v !== undefined || Date.now() > end) return v;
		await new Promise((r) => setTimeout(r, 100));
	}
}

function mk(kind: Kind) {
	return playwrightTest({
		name: "opener-realm-" + kind,
		fn: async ({ page, navigate }) => {
			const server = serve(kind);
			await new Promise<void>((r) => server.listen(0, r));
			const port = (server.address() as any).port;
			const errors: string[] = [];
			page.on("pageerror", (e: Error) => errors.push(e.message));
			try {
				await navigate(`http://localhost:${port}/`);
				const isProxied = (f: any) => f.url().includes("localhost%3A" + port);
				const find = (path: string) =>
					page
						.frames()
						.find((f: any) => isProxied(f) && f.url().includes(path));
				const outer = await until(
					async () => page.frames().find((f: any) => isProxied(f)),
					5000
				);
				if (!outer) throw new Error("the test page never loaded");

				const usesFrame =
					kind === "popup-opener-removed" ||
					kind === "iframe-creator-navigates";
				const openerFrame = usesFrame
					? await until(async () => find("opener.html"), 5000)
					: outer;
				if (!openerFrame) throw new Error("the opener frame never loaded");
				await openerFrame.waitForSelector("#b");

				const popupPromise = kind.startsWith("popup")
					? page.context().waitForEvent("page")
					: null;
				await openerFrame.locator("#b").click();

				if (kind === "popup-opener-navigates-early")
					await outer.evaluate('location.href = "/gone.html"');

				let target: any;
				if (popupPromise) {
					const popup = await popupPromise;
					popup.on("pageerror", (e: Error) => errors.push(e.message));
					target = popup;
				} else {
					target = await until(async () => find("child.html"), 5000);
				}
				await until(
					() =>
						target.evaluate(
							"typeof window.runTests === 'function' || undefined"
						),
					8000
				);

				if (kind === "popup-opener-navigates")
					await outer.evaluate('location.href = "/gone.html"');
				if (kind === "popup-opener-removed")
					await outer.evaluate('document.getElementById("f").remove()');
				if (kind === "iframe-creator-navigates")
					await openerFrame.evaluate('location.href = "/gone.html"');
				await new Promise((r) => setTimeout(r, 1000));

				await target.evaluate("window.runTests()");
				const keys = Object.keys(EXPECTED);
				const result = await until(async () => {
					const r = JSON.parse(
						await target.evaluate("JSON.stringify(window.__r)")
					);

					return keys.every((k) => k in r) ? r : undefined;
				}, 5000);
				const got =
					result ??
					JSON.parse(await target.evaluate("JSON.stringify(window.__r)"));

				const wrong = keys.filter((k) => got[k] !== EXPECTED[k]);
				if (wrong.length || errors.length) {
					throw new Error(
						wrong
							.map((k) => `${k}: expected ${EXPECTED[k]}, got ${got[k]}`)
							.join("\n") +
							(errors.length ? "\npage errors: " + errors.join("; ") : "")
					);
				}
			} finally {
				server.closeAllConnections();
				server.close();
			}
		},
	});
}

export default [
	mk("popup-opener-navigates"),
	mk("popup-opener-removed"),
	mk("popup-opener-navigates-early"),
	mk("iframe-creator-navigates"),
];
