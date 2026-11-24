// node src/bench/synth.ts — writes synthetic stores into bench-data
import fs from "node:fs";
import path from "node:path";
import { Store } from "./store.ts";
const DATA = path.resolve(import.meta.dirname, "../../bench-data");
const html = [["content-type", "text/html; charset=utf-8"]] as [
	string,
	string,
][];
function make(name: string, pages: Record<string, string>) {
	const dir = path.join(DATA, name);
	fs.rmSync(dir, { recursive: true, force: true });
	const s = new Store(dir);
	for (const [p, body] of Object.entries(pages))
		s.record("GET", "https://bench.test" + p, 200, html, Buffer.from(body));
	s.save();
	fs.writeFileSync(path.join(dir, "url.txt"), "https://bench.test/");
}
// per-document setup: 40 trivial same-origin frames
make("synth-iframes", {
	"/": `<!doctype html><title>frames</title><body>${Array.from({ length: 40 }, () => `<iframe src="/f.html" width=40 height=40></iframe>`).join("")}`,
	"/f.html": `<!doctype html><p>hi</p><script>var x = 1;</script>`,
});

// per-request overhead: a chain of 50 fetches, each waiting on the last, and
// 100 at once
{
	const pages: Record<string, string> = {
		"/": `<!doctype html><title>reqs</title><script>
			(async () => {
				const t0 = performance.now();
				for (let i = 0; i < 50; i++) await (await fetch("/r/" + i + ".txt")).text();
				const t1 = performance.now();
				await Promise.all(Array.from({ length: 100 }, (_, i) => fetch("/p/" + i + ".txt").then((r) => r.text())));
				const t2 = performance.now();
				window.__reqs = { chainPerRequest: (t1 - t0) / 50, parallel100: t2 - t1 };
			})();
		</script>`,
	};
	for (let i = 0; i < 50; i++) pages["/r/" + i + ".txt"] = "x".repeat(100);
	for (let i = 0; i < 100; i++) pages["/p/" + i + ".txt"] = "y".repeat(100);
	make("synth-requests", pages);
}
