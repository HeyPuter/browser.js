// node src/bench/where.cjs file.js.map line:col ...
const {
	SourceMapConsumer,
} = require("../../../../node_modules/.pnpm/source-map@0.7.6/node_modules/source-map");
const fs = require("fs");
const [map, ...locs] = process.argv.slice(2);
SourceMapConsumer.with(JSON.parse(fs.readFileSync(map, "utf8")), null, (c) => {
	for (const l of locs) {
		const [line, col] = l.split(":").map(Number);
		const p = c.originalPositionFor({ line, column: col - 1 });
		console.log(l, "->", p.source, p.line + ":" + p.column, p.name);
	}
});
