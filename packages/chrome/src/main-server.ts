import { render } from "dreamland/ssr/server";
import { jsxDEV } from "dreamland/jsx-runtime";

export default (path: string) => render(() => jsxDEV("div", { id: "app" }, []));
