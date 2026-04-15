import { spawnSync } from "node:child_process";

function run(command, args) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
	});

	if (result.error) throw result.error;

	return result.status ?? 1;
}

function getDefaultTargets() {
	const result = spawnSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"--",
			"*.js",
			"*.mjs",
			"*.cjs",
			"*.ts",
			":(exclude)external/**",
		],
		{
			encoding: "utf8",
		}
	);

	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);

	return result.stdout.split("\0").filter(Boolean);
}

const cliArgs = process.argv.slice(2);
const needsGitAwareTargets =
	cliArgs.length === 0 || cliArgs.includes(".") || cliArgs.includes("./");

const passthroughArgs = cliArgs.filter((arg) => arg !== "." && arg !== "./");
const eslintArgs = needsGitAwareTargets
	? [...passthroughArgs, ...getDefaultTargets()]
	: cliArgs;

process.exit(run("pnpm", ["exec", "eslint", ...eslintArgs]));
