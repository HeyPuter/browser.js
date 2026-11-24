// node src/bench/cats.ts a.cpuprofile [b.cpuprofile...] — main-thread time by category
import fs from "node:fs";
const cat = (fn: string, url: string) => {
	if (fn === "(idle)") return null;
	if (fn === "(program)") return "(program)";
	if (fn === "(garbage collector)") return "gc";
	if (url.startsWith("wasm://"))
		return url.includes("wasm.wasm") ||
			url.includes("00249c7a") ||
			url.includes("0027ae5a")
			? "rewriter wasm"
			: "transport wasm";
	if (url.includes("/scramjet/scramjet.js")) return "scramjet client";
	if (url.includes("/controller/")) return "controller";
	if (url.includes("/libcurl/") || url.includes("runway-"))
		return "transport js";
	if (url.startsWith("data:")) return "scramjet client";
	if (!url) return "native (dom, parse, compile)";
	return "site js";
};
const files = process.argv.slice(2);
const all: Record<string, number>[] = files.map((f) => {
	const p = JSON.parse(fs.readFileSync(f, "utf8"));
	const byId = new Map<number, any>(p.nodes.map((n: any) => [n.id, n]));
	const out: Record<string, number> = {};
	for (let i = 0; i < p.samples.length; i++) {
		const cf = byId.get(p.samples[i]).callFrame;
		const c = cat(cf.functionName, cf.url || "");
		if (c) out[c] = (out[c] ?? 0) + (p.timeDeltas[i] ?? 0) / 1000;
	}
	return out;
});
const keys = [...new Set(all.flatMap((o) => Object.keys(o)))];
console.log(
	"".padEnd(30) +
		files
			.map((f) => f.replace(/.*\//, "").replace(".cpuprofile", "").padStart(14))
			.join("")
);
for (const k of keys.sort(
	(a, b) => (all.at(-1)![b] ?? 0) - (all.at(-1)![a] ?? 0)
))
	console.log(
		k.padEnd(30) +
			all
				.map((o) =>
					Math.round(o[k] ?? 0)
						.toString()
						.padStart(14)
				)
				.join("")
	);
console.log(
	"total".padEnd(30) +
		all
			.map((o) =>
				Math.round(Object.values(o).reduce((a, b) => a + b, 0))
					.toString()
					.padStart(14)
			)
			.join("")
);
