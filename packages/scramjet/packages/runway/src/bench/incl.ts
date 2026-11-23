// node src/bench/incl.ts file.cpuprofile [top] — inclusive time by function (outermost frame only, no double counting)
import fs from "node:fs";
const [file, top = "40"] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const byId = new Map<number, any>(p.nodes.map((n: any) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n: any) =>
	`${n.callFrame.functionName || "(anon)"} ${(n.callFrame.url || "").replace(/^.*\//, "").slice(0, 40)}:${n.callFrame.lineNumber + 1}`;
const incl = new Map<string, number>();
for (let i = 0; i < p.samples.length; i++) {
	const dt = p.timeDeltas[i] ?? 0;
	const seen = new Set<string>();
	for (
		let id: number | undefined = p.samples[i];
		id !== undefined;
		id = parent.get(id)
	) {
		const k = key(byId.get(id));
		if (seen.has(k)) continue;
		seen.add(k);
		incl.set(k, (incl.get(k) ?? 0) + dt);
	}
}
for (const [k, v] of [...incl]
	.sort((a, b) => b[1] - a[1])
	.slice(0, Number(top)))
	console.log((v / 1000).toFixed(1).padStart(8), k);
