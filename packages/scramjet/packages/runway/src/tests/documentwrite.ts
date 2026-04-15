import { basicTest } from "../testcommon.ts";

export default [
	basicTest({
		name: "documentwrite-preserves-parser-state-across-calls",
		js: `
			const iframe = document.createElement("iframe");
			document.body.append(iframe);

			const doc = iframe.contentDocument;
			if (!doc) {
				fail("iframe contentDocument unavailable");
				return;
			}

			doc.write("<!doctype html><body><div cl", 'ass="ok">hello');
			doc.writeln("</div", ">", "<span>tail</span>");
			doc.close();

			assertEqual(
				doc.body.innerHTML,
				'<div class="ok">hello</div><span>tail</span>\\n',
				"document.write/writeln should keep parser state across calls and arguments"
			);
		`,
	}),
];
