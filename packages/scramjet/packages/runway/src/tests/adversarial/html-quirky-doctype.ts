import { htmlTest } from "../../testcommon.ts";

export default [
	// A root-level element after `</html>` is enough to send the rewriter down
	// its quirky-structure path, which injects ahead of everything else. Ahead
	// of the doctype is too far: a start tag before a DOCTYPE token sets the
	// document to quirks mode (HTML Standard 13.2.6.4.1).
	htmlTest({
		name: "html-quirky-structure-keeps-doctype",
		html: `<!DOCTYPE html>
<html>
	<head></head>
	<body>
		<script>
			runTest(async () => {
				assertEqual(document.compatMode, "CSS1Compat");
				assertEqual(document.firstChild.nodeType, Node.DOCUMENT_TYPE_NODE);
			}, true);
		</script>
	</body>
</html>
<div></div>`,
	}),
];
