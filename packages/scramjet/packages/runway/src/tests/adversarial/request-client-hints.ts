import { serverTest } from "../../testcommon.ts";

const json = (res: any, value: unknown) => {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(value));
};

export default [
	// Critical-CH restarts a navigation, never a subresource: a POST asked
	// for hints is answered, not sent a second time
	serverTest({
		name: "request-critical-ch-post-sent-once",
		autoPass: true,
		js: `
			const id = Math.random().toString(36).slice(2);
			const r = await fetch("/api?" + id, { method: "POST", body: "hello" });
			assertEqual(await r.text(), "ok");
			const seen = await (await fetch("/seen?" + id)).json();
			assertEqual(JSON.stringify(seen), JSON.stringify(["hello"]));
		`,
		async start(server) {
			const runs: Record<string, string[]> = {};
			const run = (url: string) => (runs[url.split("?")[1]] ??= []);
			server.on("request", (req, res) => {
				if (req.url!.startsWith("/api?")) {
					let body = "";
					req.on("data", (c) => (body += c));
					req.on("end", () => {
						run(req.url!).push(body);
						res.writeHead(200, {
							"Accept-CH": "Sec-CH-UA-Arch",
							"Critical-CH": "Sec-CH-UA-Arch",
						});
						res.end("ok");
					});
				} else if (req.url!.startsWith("/seen?")) {
					json(res, run(req.url!));
				}
			});
		},
	}),
	// an insecure origin is never sent a high-entropy hint, whatever it asks
	serverTest({
		name: "request-no-client-hints-over-http",
		autoPass: true,
		js: `
			const id = Math.random().toString(36).slice(2);
			await fetch("/ask?" + id);
			await fetch("/probe?" + id);
			const seen = await (await fetch("/seen?" + id)).json();
			assertEqual(seen.arch, null);
		`,
		async start(server) {
			const runs: Record<string, { arch: string | null }> = {};
			const run = (url: string) => (runs[url.split("?")[1]] ??= { arch: null });
			server.on("request", (req, res) => {
				if (req.url!.startsWith("/ask?")) {
					res.writeHead(200, { "Accept-CH": "Sec-CH-UA-Arch" });
					res.end();
				} else if (req.url!.startsWith("/probe?")) {
					run(req.url!).arch =
						(req.headers["sec-ch-ua-arch"] as string | undefined) ?? null;
					res.end();
				} else if (req.url!.startsWith("/seen?")) {
					json(res, run(req.url!));
				}
			});
		},
	}),
	// and a secure one that asked for a hint is sent it, and has a navigation
	// it named critical made again with it. Bare headless Chromium does not
	// act on Accept-CH here, so this is the proxy alone
	serverTest({
		name: "request-critical-ch-restarts-navigation",
		hostname: "hints.runway.test",
		autoPass: true,
		js: `
			const id = Math.random().toString(36).slice(2);
			const frame = document.createElement("iframe");
			const loaded = new Promise((r) => (frame.onload = r));
			frame.src = "/doc?" + id;
			document.body.appendChild(frame);
			await loaded;
			assertEqual(frame.contentDocument.body.textContent, "served");
			const seen = await (await fetch("/seen?" + id)).json();
			assertEqual(seen.length, 2, "asked twice");
			assertEqual(seen[0], null, "first without the hint");
			assert(seen[1] !== null, "second with it");
		`,
		async start(server) {
			const runs: Record<string, (string | null)[]> = {};
			const run = (url: string) => (runs[url.split("?")[1]] ??= []);
			server.on("request", (req, res) => {
				if (req.url!.startsWith("/doc?")) {
					const arch =
						(req.headers["sec-ch-ua-arch"] as string | undefined) ?? null;
					run(req.url!).push(arch);
					res.writeHead(arch === null ? 403 : 200, {
						"Content-Type": "text/html",
						"Accept-CH": "Sec-CH-UA-Arch",
						"Critical-CH": "Sec-CH-UA-Arch",
					});
					res.end(arch === null ? "challenged" : "served");
				} else if (req.url!.startsWith("/seen?")) {
					json(res, run(req.url!));
				}
			});
		},
	}),
];
