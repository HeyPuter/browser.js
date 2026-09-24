import { basicTest } from "../../testcommon.ts";
export default [
	basicTest({
		name: "zzprobe-svg",
		js: `
			const e = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
			fail([e.outerHTML, e.namespaceURI, e.constructor.name, String(document.createElementNS).slice(0, 60)].join(" | "));
		`,
	}),
];
