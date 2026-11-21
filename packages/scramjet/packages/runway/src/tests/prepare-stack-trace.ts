import { basicTest } from "../testcommon.ts";

// A page's Error.prepareStackTrace formats the page's errors, and is handed
// the page's frames, not scramjet's
export default [
	basicTest({
		name: "prepare-stack-trace-page-formatter-honoured",
		js: `
			const saved = Error.prepareStackTrace;
			Error.prepareStackTrace = (_, stack) => stack;
			const stack = new Error().stack;
			Error.prepareStackTrace = saved;
			assertConsistent("is-callsites", Array.isArray(stack) && typeof stack[0].getFileName === "function");
		`,
	}),
	basicTest({
		name: "prepare-stack-trace-no-scramjet-frames",
		scramjetOnly: true,
		js: `
			const saved = Error.prepareStackTrace;
			Error.prepareStackTrace = (_, stack) => stack.map((c) => String(c.getFileName()));
			let files;
			document.body.addEventListener("x", () => { files = new Error().stack; });
			document.body.dispatchEvent(new Event("x"));
			Error.prepareStackTrace = saved;
			assert(Array.isArray(files), "the page's formatter ran");
			assertEqual(files.filter((f) => /scramjet/.test(f)).join(","), "", "no scramjet frames");
		`,
	}),
];
