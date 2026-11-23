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
