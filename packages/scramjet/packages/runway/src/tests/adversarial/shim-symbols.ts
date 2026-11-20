import { htmlTest } from "../../testcommon.ts";

export default [
	// the client's own symbol is on the global, where no browser has one
	htmlTest({
		name: "native-no-scramjet-symbols",
		html: `<script>runTest(async () => {
			assertEqual(JSON.stringify(Reflect.ownKeys(window).filter((k) => typeof k === "symbol").map(String)), "[]");
			assertEqual(JSON.stringify(Object.getOwnPropertySymbols(window).map(String)), "[]");
			assertEqual(JSON.stringify(Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(window)).map(String)), "[]");
		}, true);</script>`,
	}),
];
