// node src/bench/bysource.cjs file.cpuprofile scramjet.js.map — scramjet.js self time by original source file
const fs = require("fs");
const { SourceMapConsumer } = require("../../../../node_modules/.pnpm/source-map@0.7.6/node_modules/source-map");
const [prof, map] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(prof, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
SourceMapConsumer.with(JSON.parse(fs.readFileSync(map, "utf8")), null, (c) => {
	const out = new Map();
	for (const [id, us] of self) {
		const cf = byId.get(id).callFrame;
		if (!cf.url.includes("/scramjet/scramjet.js")) continue;
		const pos = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
		const k = (pos.source || "?").replace(/.*packages\/core\//, "") ;
		out.set(k, (out.get(k) ?? 0) + us / 1000);
	}
	[...out].sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, v]) => console.log(v.toFixed(1).padStart(7), k));
});
