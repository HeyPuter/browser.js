// node src/bench/summarize.ts file.cpuprofile [top]
// self time by function and by script, from a CDP cpu profile
import fs from "node:fs";
const [file, top = "40"] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const byId = new Map<number, any>(p.nodes.map((n: any) => [n.id, n]));
const self = new Map<number, number>();
const dt = p.timeDeltas;
for (let i = 0; i < p.samples.length; i++)
	self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (dt[i] ?? 0));
const fn = new Map<string, number>();
const script = new Map<string, number>();
let total = 0;
for (const [id, us] of self) {
	const n = byId.get(id)!;
	const cf = n.callFrame;
	const short = (cf.url || "")
		.replace(/^.*\/~\/sj\/[^/]+\/[^/]+\//, "sj:")
		.slice(0, 90);
	if (cf.functionName !== "(idle)" && cf.functionName !== "(program)")
		total += us;
	const k = `${cf.functionName || "(anon)"} ${short}:${cf.lineNumber + 1}:${cf.columnNumber + 1}`;
	fn.set(k, (fn.get(k) ?? 0) + us);
	const s = short.startsWith("http://localhost")
		? short.replace(/^http:\/\/localhost:\d+/, "")
		: short.split("?")[0].replace(/^sj:.*/, "(site js)") || "(native)";
	script.set(s, (script.get(s) ?? 0) + us);
}
const show = (m: Map<string, number>, n: number) =>
	[...m]
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.forEach(([k, v]) => console.log((v / 1000).toFixed(1).padStart(8), k));
console.log("total non-idle ms", (total / 1000).toFixed(1));
console.log("--- by script");
show(script, 15);
console.log("--- by function");
show(fn, Number(top));
