// node src/bench/lines.ts file.cpuprofile funcName — hottest lines (by tick) inside a function
import fs from "node:fs";
const [file, name] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const ticks = new Map<string, number>();
for (const n of p.nodes) {
	if (n.callFrame.functionName !== name) continue;
	for (const t of n.positionTicks ?? []) {
		const k = `${n.callFrame.url.replace(/^.*\//, "")}:${t.line}`;
		ticks.set(k, (ticks.get(k) ?? 0) + t.ticks);
	}
}
for (const [k, v] of [...ticks].sort((a, b) => b[1] - a[1]).slice(0, 12))
	console.log(v, k);
