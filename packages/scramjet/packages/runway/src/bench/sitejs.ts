// node src/bench/sitejs.ts bare.cpuprofile sj.cpuprofile — self time in the
// site's own scripts, by script, bare against proxied
import fs from "node:fs";
const norm = (url: string) => {
	const m = url.match(/\/~\/sj\/[^/]+\/[^/]+\/([^?]*)/);
	let u = m ? decodeURIComponent(m[1]) : url;
	return u.split("?")[0];
};
function bySite(file: string) {
	const p = JSON.parse(fs.readFileSync(file, "utf8"));
	const byId = new Map<number, any>(p.nodes.map((n: any) => [n.id, n]));
	const out = new Map<string, number>();
	for (let i = 0; i < p.samples.length; i++) {
		const url: string = byId.get(p.samples[i]).callFrame.url || "";
		if (!url || (url.includes("localhost:458") && !url.includes("/~/sj/")))
			continue;
		if (url.startsWith("wasm") || url.startsWith("data:")) continue;
		const k = norm(url);
		out.set(k, (out.get(k) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
	}
	return out;
}
const [a, b] = process.argv.slice(2).map(bySite);
let ta = 0,
	tb = 0;
const rows = [...new Set([...a.keys(), ...b.keys()])].map(
	(k) => [k, a.get(k) ?? 0, b.get(k) ?? 0] as [string, number, number]
);
for (const [, x, y] of rows) {
	ta += x;
	tb += y;
}
console.log(
	"site js self ms: bare",
	ta.toFixed(0),
	"proxied",
	tb.toFixed(0),
	"ratio",
	(tb / ta).toFixed(2)
);
for (const [k, x, y] of rows.sort((p, q) => q[2] - p[2]).slice(0, 8))
	console.log(
		x.toFixed(0).padStart(6),
		y.toFixed(0).padStart(6),
		(y / (x || 1)).toFixed(1).padStart(5),
		k.slice(-70)
	);
