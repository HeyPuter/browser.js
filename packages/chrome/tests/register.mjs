// Run the shell's TypeScript models with Node's test runner. Only application
// bootstrap and network/UI boundaries are replaced; Dreamland state is real.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const source = new URL("../src/", import.meta.url);
const environment = new URL("./fixtures/environment.ts", import.meta.url).href;

registerHooks({
	resolve(specifier, context, nextResolve) {
		let url;
		if (specifier.startsWith("@components/")) {
			url = new URL(specifier.replace("@components/", "components/"), source);
		} else if (specifier.startsWith(".") || specifier.startsWith("file:")) {
			url = new URL(specifier, context.parentURL);
		}
		if (url) {
			const path = fileURLToPath(url);
			if (
				[
					source.href.slice(0, -1),
					source.href,
					new URL("index.ts", source).href,
				].includes(url.href)
			) {
				return { url: environment, shortCircuit: true };
			}
			for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
				if (existsSync(path + suffix) && /\.(ts|tsx)$/.test(path + suffix)) {
					return { url: pathToFileURL(path + suffix).href, shortCircuit: true };
				}
			}
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (/\.(ts|tsx)$/.test(url) && !url.includes("node_modules")) {
			const source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
				fileName: fileURLToPath(url),
				compilerOptions: {
					target: ts.ScriptTarget.ES2022,
					module: ts.ModuleKind.ESNext,
					jsx: ts.JsxEmit.ReactJSX,
					jsxImportSource: "dreamland",
				},
			}).outputText;
			return { format: "module", source, shortCircuit: true };
		}
		return nextLoad(url, context);
	},
});
