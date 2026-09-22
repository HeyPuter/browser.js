import { fileURLToPath } from "node:url";

// resolved against this file rather than the cwd, because the per-package
// `format` scripts run prettier from inside their own directory and still pick
// this config up by searching upwards
const interceptHug = fileURLToPath(
	new URL("./tools/prettier/intercept-hug.mjs", import.meta.url)
);

/**
 * @type {import("prettier").Config}
 */
const config = {
	trailingComma: "es5",
	useTabs: true,
	semi: true,
	singleQuote: false,
	plugins: [interceptHug],
};

export default config;
