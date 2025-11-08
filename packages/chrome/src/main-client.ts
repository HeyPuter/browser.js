import { hydrate } from "dreamland/ssr/client";
import { App } from "./App";
import { jsxDEV } from "dreamland/jsx-runtime";
import { mount } from "./main";

mount().then((h) => {
	hydrate(
		() => h,
		document.querySelector("#app")!,
		document.head,
		document.querySelector("[dlssr-d]")!
	);
});
