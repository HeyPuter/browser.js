/**
 * The lint pass harden.mjs runs over the hardened wasm-bindgen glue before it
 * writes it out. It is deliberately far stricter than the main config, and has
 * no escape hatch: inline `eslint-disable` comments are ignored, so nothing
 * wasm-bindgen emits can switch a rule off, and any report at all - warnings
 * included - aborts the build.
 *
 * If this fails after a wasm-bindgen or rewriter change, the new output does
 * something harden.mjs doesn't know how to make safe yet. Teach it (a capture
 * in src/shared/rewriters/wbg-snapshot.ts, an entry in harden.mjs's tables);
 * don't loosen this.
 */
import noInstanceofPlugin from "../eslint/no-instanceof-plugin.mjs";
import noUnsafeIterationPlugin from "../eslint/no-unsafe-iteration-plugin.mjs";
import wbgHardenedPlugin from "../eslint/wbg-hardened-plugin.mjs";

// fully specified: rspack resolves an ESM .js file's imports as written
export const SNAPSHOT_SOURCE = "../../../src/shared/rewriters/wbg-snapshot.ts";

const RESTRICTED_SYNTAX = [
	["ForInStatement", "`for...in` enumerates keys up the prototype chain."],
	["WithStatement", "`with` resolves names through an object."],
	[
		"TemplateLiteral[expressions.length>0]",
		"A template substitution runs ToString, which consults the value's prototype.",
	],
	[
		"TaggedTemplateExpression",
		"Tagged templates build their strings array through the page's Array.prototype.",
	],
	[
		"AwaitExpression",
		"`await` reads `then` off the value, and off %Promise.prototype%.",
	],
	[":function[async=true]", "Async functions resolve through `then`."],
	[":function[generator=true]", "Generators run the iterator protocol."],
	["YieldExpression", "Generators run the iterator protocol."],
	["BinaryExpression[operator='in']", "`in` walks the prototype chain."],
	["ClassDeclaration[superClass], ClassExpression[superClass]", "No extends."],
	["ChainExpression", "Optional chaining is a member access in disguise."],
	[
		"Property[computed=true], MethodDefinition[computed=true]",
		"A computed key runs ToPropertyKey on its value.",
	],
	[
		"UnaryExpression[operator='delete']",
		"`delete` on a non-own key is a lookup.",
	],
	["Super", "No super."],
	["DebuggerStatement", "No debugger."],
].map(([selector, message]) => ({ selector, message }));

export default [
	{
		linterOptions: {
			noInlineConfig: true,
			reportUnusedDisableDirectives: "off",
		},
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			// deliberately empty. ESLint still declares the ES builtins for the
			// ecmaVersion, which is why wbg-hardened/no-globals reports
			// references to declared globals as well as unresolved ones
			globals: {},
		},
		plugins: {
			"scramjet-core": {
				rules: {
					...noInstanceofPlugin.rules,
					...noUnsafeIterationPlugin.rules,
				},
			},
			"wbg-hardened": wbgHardenedPlugin,
		},
		rules: {
			"scramjet-core/no-instanceof": "error",
			"scramjet-core/no-unsafe-iteration": "error",

			"wbg-hardened/no-globals": "error",
			"wbg-hardened/no-unvetted-member": "error",
			"wbg-hardened/null-proto-literals": "error",
			"wbg-hardened/only-snapshot-imports": [
				"error",
				{ source: SNAPSHOT_SOURCE },
			],
			"wbg-hardened/new-only-snapshot": "error",
			"wbg-hardened/alias-imports": "error",

			"no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX],
			// loose equality with an object runs ToPrimitive
			eqeqeq: ["error", "always"],
			"no-eval": "error",
			"no-implied-eval": "error",
			"no-new-func": "error",
			"no-caller": "error",
			"no-proto": "error",
			"no-extend-native": "error",
			"no-global-assign": "error",
			"no-implicit-globals": "error",
			"no-undef": "error",
			"no-shadow-restricted-names": "error",
		},
	},
];
