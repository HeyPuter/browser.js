#!/usr/bin/env node
/**
 * Rewrites wasm-bindgen's JS glue so it touches no global and no prototype the
 * page can reach, then lints the result with tools/wbg/eslint.config.mjs and
 * refuses to write it if anything is left.
 *
 *   node tools/wbg/harden.mjs <wasm-bindgen out dir> <dest dir>
 *
 * reads <in>/wasm.js, <in>/wasm.d.ts and the snippets they import, and writes
 * <dest>/wasm.js and <dest>/wasm.d.ts.
 *
 * The rewrite is mostly mechanical. Every global becomes an import from
 * src/shared/rewriters/wbg-snapshot.ts, and every property access is resolved
 * against the *kind* of its receiver - a small inference over the glue that
 * knows `getUint8ArrayMemory0()` returns a Uint8Array, `wasm.memory` is a
 * Memory, and so on - so that `view.subarray(a, b)` becomes
 * `Uint8Array_subarray(view, a, b)` and `s.length` on a string becomes
 * `Own_get(s, "length")`. What the inference can't place is an error, not a
 * guess. A handful of structures (the imports object, initSync, the async
 * loader we never use) are rewritten by shape, and those shapes are asserted.
 *
 * Anything this doesn't recognise aborts with a message saying what and where.
 * The lint pass is the backstop for whatever it recognised wrongly.
 */
import { parseForESLint } from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import prettier from "prettier";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SNAPSHOT_SOURCE } from "./eslint.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(here, "../..");
const snapshotFile = path.join(coreDir, "src/shared/rewriters/wbg-snapshot.ts");

// ---------------------------------------------------------------------------
// tables

/** Bare globals, and what replaces them. */
const GLOBALS = {
	Error: "Error",
	TextDecoder: "_TextDecoder",
	TextEncoder: "_TextEncoder",
	Uint8Array: "_Uint8Array",
	DataView: "_DataView",
	URL: "_URL",
	FinalizationRegistry: "_FinalizationRegistry",
	encodeURIComponent: "encodeURIComponent",
};

/** `Global.member`, and what replaces it. */
const GLOBAL_MEMBERS = {
	"Reflect.get": "Reflect_get",
	"Reflect.set": "Reflect_set",
	"Reflect.apply": "Reflect_apply",
	"Symbol.dispose": "Symbol_dispose",
	"WebAssembly.Instance": "WebAssembly_Instance",
};

/** What `new Global(...)` produces, by the global's name before rewriting. */
const CONSTRUCTED_KINDS = {
	Uint8Array: "Uint8Array",
	DataView: "DataView",
	TextDecoder: "TextDecoder",
	TextEncoder: "TextEncoder",
	FinalizationRegistry: "FinalizationRegistry",
	URL: "URL",
	"WebAssembly.Instance": "Instance",
};

/** The fields of the exports object the glue reads as values, by name. */
const EXPORT_KINDS = {
	memory: "Memory",
	__wbindgen_externrefs: "Table",
};

/**
 * Parameters whose kind the inference can't see from inside the function,
 * checked against wasm-bindgen's own JSDoc-free helpers.
 */
const PARAMETER_KINDS = {
	passStringToWasm0: { arg: "String", malloc: "Function", realloc: "Function" },
	passArray8ToWasm0: { arg: "Uint8Array", malloc: "Function" },
	handleError: { f: "Function" },
};

const DATAVIEW_METHODS = Object.fromEntries(
	[
		"Int8",
		"Uint8",
		"Int16",
		"Uint16",
		"Int32",
		"Uint32",
		"Float32",
		"Float64",
		"BigInt64",
		"BigUint64",
	].flatMap((t) => [
		[`get${t}`, { fn: `DataView_get${t}`, kind: "Number" }],
		[`set${t}`, { fn: `DataView_set${t}` }],
	])
);

/**
 * Per kind: `props` are reads (`own` for an own data property, read through
 * Own_get), `methods` are calls. Each maps to the wbg-snapshot export that
 * replaces it, taking the receiver first, and the kind of the result.
 */
const OWN = "own";
const KINDS = {
	String: {
		props: { length: { fn: "String_length", kind: "Number" } },
		methods: {
			charCodeAt: { fn: "String_charCodeAt", kind: "Number" },
			slice: { fn: "String_slice", kind: "String" },
		},
	},
	Array: {
		props: { length: { fn: OWN, kind: "Number" } },
		methods: {
			push: { fn: "Array_append", kind: "Number" },
			slice: { fn: "Array_copy", kind: "Array", arity: 0 },
		},
	},
	Uint8Array: {
		props: {
			length: { fn: "TypedArray_length", kind: "Number" },
			byteLength: { fn: "TypedArray_byteLength", kind: "Number" },
			byteOffset: { fn: "TypedArray_byteOffset", kind: "Number" },
			buffer: { fn: "TypedArray_buffer", kind: "ArrayBuffer" },
		},
		methods: {
			subarray: { fn: "Uint8Array_subarray", kind: "Uint8Array" },
			set: { fn: "TypedArray_set" },
		},
		// `view[i]` and `view[i] = x`, with any index expression
		elements: { read: "Uint8Array_getIndex", write: "Uint8Array_setIndex" },
	},
	DataView: {
		props: { buffer: { fn: "DataView_buffer", kind: "ArrayBuffer" } },
		methods: DATAVIEW_METHODS,
	},
	ArrayBuffer: {
		props: { detached: { fn: "ArrayBuffer_detached", kind: "Boolean" } },
		methods: {},
	},
	Memory: {
		props: { buffer: { fn: "Memory_buffer", kind: "ArrayBuffer" } },
		methods: { grow: { fn: "Memory_grow", kind: "Number" } },
	},
	Table: {
		props: { length: { fn: "Table_length", kind: "Number" } },
		methods: {
			get: { fn: "Table_get" },
			set: { fn: "Table_set" },
			grow: { fn: "Table_grow", kind: "Number" },
		},
	},
	TextDecoder: {
		props: {},
		methods: { decode: { fn: "TextDecoder_decode", kind: "String" } },
	},
	TextEncoder: {
		props: {},
		methods: {
			encode: { fn: "TextEncoder_encode", kind: "Uint8Array" },
			encodeInto: { fn: "TextEncoder_encodeInto", kind: "EncodeResult" },
		},
	},
	EncodeResult: {
		props: {
			read: { fn: OWN, kind: "Number" },
			written: { fn: OWN, kind: "Number" },
		},
		methods: {},
	},
	FinalizationRegistry: {
		props: {},
		methods: {
			register: { fn: "FinalizationRegistry_register" },
			unregister: { fn: "FinalizationRegistry_unregister" },
		},
	},
	Instance: {
		props: { exports: { fn: "Instance_exports", kind: "Exports" } },
		methods: {},
	},
	Function: {
		props: {},
		methods: {
			// f.call(thisArg, ...args): Function_call is call.bind(call)
			call: { fn: "Function_call" },
			// f.apply(thisArg, args)
			apply: { fn: "Reflect_apply" },
		},
	},
	URL: {
		props: {
			href: { fn: "URL_href", kind: "String" },
			origin: { fn: "URL_origin", kind: "String" },
		},
		methods: { toString: { fn: "URL_toString", kind: "String" } },
	},
	// a multi-value return: an array the engine built, read by index
	MultiValue: { props: {}, methods: {}, indexed: true },
};
KINDS.Array.indexed = true;

/**
 * Where the receiver's kind is unknown, a name that only one kind has settles
 * it. `toString` is the exception: wasm-bindgen emits `arg0.toString()` for
 * every binding of it, so it goes to a helper that dispatches on brand.
 */
const UNKNOWN_RECEIVER = {
	methods: { toString: { fn: "Value_toString", kind: "String" } },
};

/**
 * The `inline_js` snippets wasm-bindgen may import, verbatim (whitespace
 * aside), and the wbg-snapshot export that stands in for each of their
 * exports. A snippet that changes needs its replacement re-checked.
 */
const SNIPPETS = [
	{
		origin: "rewriter/wasm/src/jsr.rs",
		source: `
export function scramtag() {
    return (""+1e10).replace(/[018]/g,
      c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}`,
		exports: { scramtag: "scramtag" },
	},
];

/** Top-level declarations dropped: the async/fetch loader, unused here. */
const REMOVED = new Set([
	"__wbg_load",
	"__wbg_init",
	"EXPECTED_RESPONSE_TYPES",
]);

/**
 * initSync, cut down to the one call shared/rewriters/wasm.ts makes:
 * `initSync({ module })` with a compiled WebAssembly.Module. wasm-bindgen's
 * version sniffs its argument's prototype and uses `instanceof`, to support
 * forms nothing here uses.
 */
const INIT_SYNC = `function initSync(options) {
    if (wasm !== undefined) return wasm;

    const module = Own_get(options, "module");
    const instance = new WebAssembly_Instance(module, __wbg_get_imports());

    return __wbg_finalize_init(instance, module);
}`;

// ---------------------------------------------------------------------------

class HardenError extends Error {}

const errors = [];
let currentFile = "";
function fail(node, message) {
	const where = node?.loc
		? `${currentFile}:${node.loc.start.line}:${node.loc.start.column + 1}`
		: currentFile;
	errors.push(`${where}: ${message}`);

	return `/* HARDEN ERROR */`;
}

const normalize = (s) => s.replace(/\s+/g, " ").trim();

function snapshotExports() {
	const source = fs.readFileSync(snapshotFile, "utf8");
	const names = new Set();
	for (const m of source.matchAll(
		/^export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm
	))
		names.add(m[1]);
	for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
		for (const name of m[1].split(","))
			if (name.trim())
				names.add(
					name
						.trim()
						.split(/\s+as\s+/)
						.pop()
				);
	}

	return names;
}

export function harden(code, { file = "wasm.js", readSnippet } = {}) {
	currentFile = file;
	errors.length = 0;

	const { ast, scopeManager, visitorKeys } = parseForESLint(code, {
		sourceType: "module",
		ecmaVersion: "latest",
		range: true,
		loc: true,
		// no implicit TS lib globals: every builtin stays an unresolved
		// reference, which is what marks it as a global here
		lib: [],
	});

	// the parser leaves `parent` to ESLint's traversal
	(function link(node, parent) {
		node.parent = parent;
		for (const key of visitorKeys[node.type] ?? []) {
			const child = node[key];
			for (const c of Array.isArray(child) ? child : [child])
				if (c && typeof c.type === "string") link(c, node);
		}
	})(ast, null);

	const moduleScope = scopeManager.scopes.find((s) => s.type === "module");
	const referenceOf = new Map();
	for (const scope of scopeManager.scopes)
		for (const ref of scope.references) referenceOf.set(ref.identifier, ref);

	// names imported from wbg-snapshot, in order of first use
	const used = new Set();
	const use = (name) => (used.add(name), name);

	const removedVariables = new Set(
		moduleScope.variables.filter((v) => REMOVED.has(v.name))
	);

	// -------------------------------------------------------------------------
	// kind inference

	const variableKinds = new Map();
	const returnKinds = new Map();
	const PENDING = "Pending";

	function union(kinds) {
		const known = [
			...new Set(
				kinds.filter((k) => k !== PENDING && k !== "Null" && k !== "Undefined")
			),
		];

		return known.length === 1 ? known[0] : "Unknown";
	}

	function enclosingFunctionName(node) {
		for (let n = node; n; n = n.parent)
			if (n.type === "FunctionDeclaration") return n.id?.name;

		return undefined;
	}

	function variableKind(variable) {
		if (variableKinds.has(variable)) return variableKinds.get(variable);
		variableKinds.set(variable, PENDING);

		let kind;
		const def = variable.defs[0];
		if (variable.scope === moduleScope && variable.name === "wasm")
			kind = "Exports";
		else if (def?.type === "FunctionName") kind = "LocalFunction";
		else if (def?.type === "ClassName") kind = "Class";
		else if (def?.type === "Parameter") {
			kind =
				PARAMETER_KINDS[enclosingFunctionName(def.node)]?.[variable.name] ??
				"Unknown";
		} else {
			const writes = variable.references
				.filter((r) => r.isWrite() && r.writeExpr)
				.map((r) => exprKind(r.writeExpr));
			if (def?.type === "Variable" && !def.node.init) writes.push("Undefined");
			kind = union(writes);
		}

		variableKinds.set(variable, kind);

		return kind;
	}

	function returnKind(fn) {
		if (returnKinds.has(fn)) return returnKinds.get(fn);
		returnKinds.set(fn, PENDING);

		const kinds = [];
		(function walk(node) {
			if (!node || typeof node.type !== "string") return;
			if (node !== fn && /Function/.test(node.type)) return;
			if (node.type === "ReturnStatement")
				kinds.push(node.argument ? exprKind(node.argument) : "Undefined");
			for (const key of visitorKeys[node.type] ?? []) {
				const child = node[key];
				if (Array.isArray(child)) child.forEach(walk);
				else walk(child);
			}
		})(fn);

		const kind = union(kinds);
		returnKinds.set(fn, kind);

		return kind;
	}

	function globalName(node) {
		if (node.type === "Identifier") {
			const ref = referenceOf.get(node);

			return ref && !ref.resolved ? node.name : null;
		}
		if (node.type === "MemberExpression" && !node.computed) {
			const object = globalName(node.object);

			return object ? `${object}.${node.property.name}` : null;
		}

		return null;
	}

	function member(kind, name, kindOfTable) {
		const table = KINDS[kind];
		if (table) return table[kindOfTable][name] ?? null;

		// unknown receiver: settle it by the name, if exactly one kind has it
		const special = UNKNOWN_RECEIVER[kindOfTable]?.[name];
		if (special) return special;
		const candidates = Object.values(KINDS)
			.map((t) => t[kindOfTable][name])
			.filter(Boolean);

		return candidates.length === 1 ? candidates[0] : null;
	}

	/**
	 * `typeof FinalizationRegistry === 'undefined' ? stub : new ...`: every
	 * engine this runs on has it, so the stub (a plain object literal) goes.
	 */
	function isFinalizationGuard(node) {
		const t = node.test;
		return (
			t.type === "BinaryExpression" &&
			t.left.type === "UnaryExpression" &&
			t.left.operator === "typeof" &&
			t.left.argument.type === "Identifier" &&
			globalName(t.left.argument) === "FinalizationRegistry" &&
			t.right.type === "Literal" &&
			t.right.value === "undefined"
		);
	}

	function exprKind(node) {
		switch (node.type) {
			case "Literal":
				if (node.value === null) return "Null";
				return typeof node.value === "string"
					? "String"
					: typeof node.value === "number"
						? "Number"
						: "Unknown";
			case "TemplateLiteral":
				return "String";
			case "ArrayExpression":
				return "Array";
			case "ObjectExpression":
				return "Object";
			case "FunctionExpression":
			case "ArrowFunctionExpression":
				return "Function";
			case "Identifier": {
				if (node.name === "undefined") return "Undefined";
				const ref = referenceOf.get(node);
				if (!ref?.resolved) return "Unknown";
				return variableKind(ref.resolved);
			}
			case "NewExpression": {
				const name = globalName(node.callee);
				return (name && CONSTRUCTED_KINDS[name]) ?? "Unknown";
			}
			case "CallExpression": {
				const callee = node.callee;
				if (callee.type === "Identifier") {
					const variable = referenceOf.get(callee)?.resolved;
					const def = variable?.defs[0];
					if (def?.type === "FunctionName") return returnKind(def.node);
					return "Unknown";
				}
				if (callee.type === "MemberExpression" && !callee.computed) {
					const receiver = exprKind(callee.object);
					if (receiver === "Exports") return "MultiValue";
					return (
						member(receiver, callee.property.name, "methods")?.kind ?? "Unknown"
					);
				}
				return "Unknown";
			}
			case "MemberExpression": {
				if (node.computed) return "Unknown";
				const receiver = exprKind(node.object);
				if (receiver === "Exports")
					return EXPORT_KINDS[node.property.name] ?? "Function";
				return member(receiver, node.property.name, "props")?.kind ?? "Unknown";
			}
			case "ConditionalExpression":
				if (isFinalizationGuard(node)) return exprKind(node.alternate);
				return union([exprKind(node.consequent), exprKind(node.alternate)]);
			case "LogicalExpression":
				return union([exprKind(node.left), exprKind(node.right)]);
			case "AssignmentExpression":
				return node.operator === "=" ? exprKind(node.right) : "Unknown";
			case "SequenceExpression":
				return exprKind(node.expressions[node.expressions.length - 1]);
			default:
				return "Unknown";
		}
	}

	// -------------------------------------------------------------------------
	// printing

	const text = (node) => code.slice(node.range[0], node.range[1]);

	function children(node) {
		const out = [];
		for (const key of visitorKeys[node.type] ?? []) {
			const child = node[key];
			if (Array.isArray(child)) out.push(...child.filter(Boolean));
			else if (child && typeof child.type === "string") out.push(child);
		}

		// `export { a }` has `local` and `exported` over the same text
		return out
			.sort((a, b) => a.range[0] - b.range[0])
			.filter((c, i, all) => i === 0 || c.range[0] >= all[i - 1].range[1]);
	}

	function printDefault(node) {
		let out = "";
		let pos = node.range[0];
		for (const child of children(node)) {
			out += code.slice(pos, child.range[0]) + print(child);
			pos = child.range[1];
		}

		return out + code.slice(pos, node.range[1]);
	}

	function print(node) {
		return transform(node) ?? printDefault(node);
	}

	const printArgs = (args) => args.map(print).join(", ");

	function isRemovedReference(identifier) {
		const variable = referenceOf.get(identifier)?.resolved;
		return !!variable && removedVariables.has(variable);
	}

	function isClassPrototype(node) {
		return (
			node.type === "MemberExpression" &&
			!node.computed &&
			node.property.name === "prototype" &&
			node.object.type === "Identifier" &&
			exprKind(node.object) === "Class"
		);
	}

	function isOwnFieldAccess(node) {
		return (
			node.object.type === "ThisExpression" &&
			!node.computed &&
			node.property.name.startsWith("__wbg_")
		);
	}

	/** `this.method` inside a method of the class that declares `method`. */
	function isOwnMethodAccess(node) {
		if (node.object.type !== "ThisExpression" || node.computed) return false;
		let n = node.parent;
		while (n && n.type !== "MethodDefinition") n = n.parent;

		return (
			!!n &&
			!n.static &&
			n.parent.body.some(
				(m) =>
					m.type === "MethodDefinition" &&
					m.kind === "method" &&
					!m.static &&
					!m.computed &&
					m.key.name === node.property.name
			)
		);
	}

	const isWriteTarget = (node) =>
		(node.parent.type === "AssignmentExpression" &&
			node.parent.left === node) ||
		node.parent.type === "UpdateExpression";

	function transform(node) {
		switch (node.type) {
			case "Program":
				return printProgram(node);

			case "FunctionDeclaration":
				if (node.id?.name === "initSync") {
					use("Own_get");
					use("WebAssembly_Instance");
					return INIT_SYNC;
				}
				if (node.id?.name === "__wbg_get_imports") return printGetImports(node);
				return null;

			case "ExpressionStatement": {
				// `__wbg_init.__wbindgen_wasm_module = module;`
				const e = node.expression;
				if (
					e.type === "AssignmentExpression" &&
					e.left.type === "MemberExpression" &&
					e.left.object.type === "Identifier" &&
					isRemovedReference(e.left.object)
				)
					return "";
				return null;
			}

			case "IfStatement":
				return transformIf(node);

			case "ClassBody": {
				// fields the class reads through `this`, declared up front so
				// they are own data properties from construction on
				const fields = new Set();
				(function walk(n) {
					if (
						n.type === "MemberExpression" &&
						n.object.type === "ThisExpression" &&
						!n.computed &&
						n.property.name.startsWith("__wbg_")
					)
						fields.add(n.property.name);
					for (const child of children(n)) walk(child);
				})(node);
				for (const m of node.body)
					if (m.type === "PropertyDefinition") fields.delete(m.key.name);
				const printed = printDefault(node);
				const declarations = [...fields].map((f) => `\n    ${f} = 0;`).join("");

				return "{" + declarations + printed.slice(1);
			}

			case "ConditionalExpression":
				return isFinalizationGuard(node) ? print(node.alternate) : null;

			case "AssignmentExpression": {
				const left = node.left;
				if (
					left.type !== "MemberExpression" ||
					!left.computed ||
					!KINDS[exprKind(left.object)]?.elements
				)
					return null;
				if (node.operator !== "=")
					return fail(
						node,
						`compound assignment \`${text(node)}\` is not handled`
					);
				const { write } = KINDS[exprKind(left.object)].elements;
				return `${use(write)}(${print(left.object)}, ${print(left.property)}, ${print(node.right)})`;
			}

			case "ObjectExpression": {
				const first = node.properties[0];
				if (
					first?.type === "Property" &&
					!first.computed &&
					(first.key.name ?? first.key.value) === "__proto__"
				)
					return null;
				const printed = printDefault(node);
				return node.properties.length === 0
					? "{ __proto__: null }"
					: "{ __proto__: null," + printed.slice(1);
			}

			case "NewExpression": {
				const name = globalName(node.callee);
				if (node.arguments.length === 0 && name === "Object")
					return "{ __proto__: null }";
				if (node.arguments.length === 0 && name === "Array") return "[]";
				return null;
			}

			case "Identifier": {
				const ref = referenceOf.get(node);
				if (!ref) return null;
				if (ref.resolved) {
					if (removedVariables.has(ref.resolved))
						return fail(node, `\`${node.name}\` is removed, but still used`);
					return null;
				}
				if (node.name === "undefined") return null;
				if (GLOBALS[node.name]) return use(GLOBALS[node.name]);
				return fail(
					node,
					`global \`${node.name}\` has no snapshot; add it to GLOBALS`
				);
			}

			case "MemberExpression":
				return transformMember(node);

			case "CallExpression":
				return transformCall(node);

			case "ChainExpression":
				return fail(node, "optional chaining is not handled");

			default:
				return null;
		}
	}

	function transformMember(node) {
		const global = globalName(node);
		if (global) {
			if (GLOBAL_MEMBERS[global]) return use(GLOBAL_MEMBERS[global]);
			// the object is a global in its own right, e.g. `Error.prototype`
			if (node.object.type === "Identifier" && GLOBALS[node.object.name])
				return fail(node, `\`${global}\` has no snapshot`);
			return fail(
				node,
				`\`${global}\` has no snapshot; add it to GLOBAL_MEMBERS`
			);
		}

		if (isOwnFieldAccess(node) || isOwnMethodAccess(node)) return null;

		const receiver = exprKind(node.object);

		if (receiver === "Exports" && !node.computed) {
			if (isWriteTarget(node)) return fail(node, "write to the exports object");
			return null;
		}
		if (isClassPrototype(node)) return null;
		if (isClassPrototype(node.object) && !node.computed) return null;

		// element writes are rewritten whole, by the AssignmentExpression
		if (isWriteTarget(node))
			return fail(node, `write through \`${text(node)}\` is not handled`);

		if (node.computed) {
			const elements = KINDS[receiver]?.elements;
			if (elements)
				return `${use(elements.read)}(${print(node.object)}, ${print(node.property)})`;
			if (
				KINDS[receiver]?.indexed &&
				node.property.type === "Literal" &&
				typeof node.property.value === "number"
			)
				return `${use("Own_get")}(${print(node.object)}, ${node.property.raw})`;
			return fail(
				node,
				`computed access \`${text(node)}\` on ${receiver} is not handled`
			);
		}

		const name = node.property.name;
		const entry = member(receiver, name, "props");
		if (!entry)
			return fail(
				node,
				`read of \`.${name}\` on ${receiver} (\`${text(node)}\`) is not handled; add it to KINDS${receiver === "Unknown" ? " or PARAMETER_KINDS" : ""}`
			);
		if (entry.fn === OWN)
			return `${use("Own_get")}(${print(node.object)}, "${name}")`;

		return `${use(entry.fn)}(${print(node.object)})`;
	}

	function transformCall(node) {
		const callee = node.callee;
		if (callee.type !== "MemberExpression") return null;
		if (node.optional) return fail(node, "optional call is not handled");
		if (globalName(callee)) return null; // Reflect.get(...) and the like

		const receiver = exprKind(callee.object);
		if (receiver === "Exports" && !callee.computed) return null;
		if (isClassPrototype(callee.object) || isOwnMethodAccess(callee))
			return null;
		if (callee.computed)
			return fail(node, `computed call \`${text(callee)}\` is not handled`);

		const name = callee.property.name;
		const entry = member(receiver, name, "methods");
		if (!entry)
			return fail(
				node,
				`call of \`.${name}()\` on ${receiver} (\`${text(callee)}\`) is not handled; add it to KINDS${receiver === "Unknown" ? " or PARAMETER_KINDS" : ""}`
			);
		if (entry.arity !== undefined && node.arguments.length !== entry.arity)
			return fail(node, `\`.${name}()\` with arguments is not handled`);

		const args = [print(callee.object), ...node.arguments.map(print)];

		return `${use(entry.fn)}(${args.join(", ")})`;
	}

	function transformIf(node) {
		const t = node.test;

		// `if (!('encodeInto' in cachedTextEncoder)) { polyfill }`: encodeInto is
		// universal, and the polyfill writes to the encoder
		if (
			t.type === "UnaryExpression" &&
			t.operator === "!" &&
			t.argument.type === "BinaryExpression" &&
			t.argument.operator === "in" &&
			t.argument.left.value === "encodeInto"
		)
			return "";

		// `if (Symbol.dispose) C.prototype[Symbol.dispose] = C.prototype.free;`
		// assigns through [[Set]], which a setter on Object.prototype would catch
		if (
			globalName(t) === "Symbol.dispose" &&
			node.consequent.type === "ExpressionStatement"
		) {
			const e = node.consequent.expression;
			if (
				e.type === "AssignmentExpression" &&
				e.operator === "=" &&
				e.left.type === "MemberExpression" &&
				e.left.computed &&
				globalName(e.left.property) === "Symbol.dispose" &&
				isClassPrototype(e.left.object)
			) {
				const dispose = use("Symbol_dispose");
				return `if (${dispose}) ${use("Object_defineProperty")}(${print(e.left.object)}, ${dispose}, { __proto__: null, value: ${print(e.right)}, writable: true, enumerable: true, configurable: true });`;
			}
			return fail(node, "unrecognised Symbol.dispose installation");
		}

		return null;
	}

	/**
	 * `const imports = {}; imports.wbg = {}; imports.wbg.x = f; ...` - member
	 * writes into objects that inherit from Object.prototype, where a setter
	 * would see every import - becomes one null-prototype literal.
	 */
	function printGetImports(fn) {
		const body = fn.body.body;
		const [decl, wbg, ...rest] = body;
		const ret = rest.pop();

		const isImportsDecl =
			decl?.type === "VariableDeclaration" &&
			decl.declarations.length === 1 &&
			decl.declarations[0].id.name === "imports" &&
			decl.declarations[0].init?.type === "ObjectExpression" &&
			decl.declarations[0].init.properties.length === 0;
		const isWbgDecl =
			wbg?.type === "ExpressionStatement" &&
			normalize(text(wbg)) === "imports.wbg = {};";
		const isReturn =
			ret?.type === "ReturnStatement" && text(ret) === "return imports;";
		if (!isImportsDecl || !isWbgDecl || !isReturn)
			return fail(fn, "__wbg_get_imports no longer has the expected shape");

		const entries = [];
		for (const statement of rest) {
			const e = statement.expression;
			if (
				statement.type !== "ExpressionStatement" ||
				e.type !== "AssignmentExpression" ||
				e.left.type !== "MemberExpression" ||
				e.left.computed ||
				normalize(text(e.left.object)) !== "imports.wbg"
			)
				return fail(
					statement,
					"__wbg_get_imports has a statement other than `imports.wbg.name = ...`"
				);
			entries.push(`        ${e.left.property.name}: ${print(e.right)},`);
		}

		return `function __wbg_get_imports() {
    const imports = {
        __proto__: null,
        wbg: {
            __proto__: null,
${entries.join("\n")}
        },
    };

    return imports;
}`;
	}

	function printProgram(program) {
		const parts = [];
		const snippetNames = [];
		let pos = program.range[0];

		for (const statement of program.body) {
			parts.push(code.slice(pos, statement.range[0]));
			pos = statement.range[1];

			if (statement.type === "ImportDeclaration") {
				snippetNames.push(...importSnippet(statement));
				continue;
			}
			const declared =
				statement.type === "VariableDeclaration"
					? statement.declarations.map((d) => d.id.name)
					: statement.type === "FunctionDeclaration" ||
						  statement.type === "ClassDeclaration"
						? [statement.id.name]
						: [];
			if (declared.length && declared.every((n) => REMOVED.has(n))) continue;
			if (
				statement.type === "ExportDefaultDeclaration" &&
				statement.declaration.type === "Identifier" &&
				REMOVED.has(statement.declaration.name)
			)
				continue;
			if (
				statement.type === "ExportNamedDeclaration" &&
				!statement.declaration &&
				statement.specifiers.some((s) => REMOVED.has(s.local.name))
			) {
				fail(statement, "a removed declaration is exported");
				continue;
			}

			parts.push(print(statement));
		}
		parts.push(code.slice(pos, program.range[1]));

		for (const name of snippetNames) used.add(name);

		const available = snapshotExports();
		for (const name of used)
			if (!available.has(name))
				fail(null, `wbg-snapshot.ts does not export \`${name}\``);
		for (const name of used)
			if (
				moduleScope.set.get(name)?.defs.some((d) => d.type !== "ImportBinding")
			)
				fail(null, `\`${name}\` is both a snapshot import and declared here`);

		// Imported under a `$` name and aliased to a module-level const: a
		// bundler compiles each use of an import binding into a read of a
		// getter on its module-exports object, which in the per-character loop
		// of passStringToWasm0 made every call ~15x slower. A const is read
		// straight from the module's scope
		const names = [...used].sort();
		for (const name of names)
			if (moduleScope.set.has(`$${name}`))
				fail(
					null,
					`\`$${name}\` is declared here, and needed for an import alias`
				);
		const header = `// Generated by tools/wbg/harden.mjs from wasm-bindgen output. Do not edit:
// rebuild with \`pnpm rewriter:build\`.
import {
${names.map((n) => `    ${n} as $${n},`).join("\n")}
} from "${SNAPSHOT_SOURCE}";

${names.map((n) => `const ${n} = $${n};`).join("\n")}
`;

		return header + parts.join("").replace(/\n{3,}/g, "\n\n");
	}

	function importSnippet(statement) {
		const source = statement.source.value;
		if (!/^\.\/snippets\//.test(source))
			return (fail(statement, `unexpected import from '${source}'`), []);

		const contents = readSnippet(source);
		const known = SNIPPETS.find(
			(s) => normalize(s.source) === normalize(contents)
		);
		if (!known)
			return (
				fail(
					statement,
					`snippet ${source} is not one SNIPPETS knows; check its replacement in wbg-snapshot.ts and update it:\n${contents}`
				),
				[]
			);

		const names = [];
		for (const specifier of statement.specifiers) {
			const imported = specifier.imported?.name;
			if (
				specifier.type !== "ImportSpecifier" ||
				imported !== specifier.local.name ||
				!known.exports[imported]
			) {
				fail(specifier, `unexpected import of \`${text(specifier)}\``);
				continue;
			}
			if (known.exports[imported] !== imported)
				fail(specifier, "renamed snippet exports are not supported");
			names.push(known.exports[imported]);
		}

		return names;
	}

	const output = print(ast);

	if (errors.length) throw new HardenError(errors.join("\n"));

	return output;
}

/**
 * The declarations follow initSync's narrowing, and lose the default export
 * along with the loader it described.
 */
export function hardenTypes(dts) {
	let out = dts;
	const replace = (pattern, replacement, what) => {
		const matches = out.match(new RegExp(pattern.source, pattern.flags + "g"));
		if (matches?.length !== 1)
			throw new HardenError(
				`wasm.d.ts: expected exactly one ${what}, found ${matches?.length ?? 0}`
			);
		out = out.replace(pattern, replacement);
	};

	replace(
		/export function initSync\([^\n]*\): InitOutput;/,
		"export function initSync(options: { module: WebAssembly.Module }): InitOutput;",
		"initSync declaration"
	);
	replace(
		/\/\*\*\n\* If `module_or_path`[\s\S]*?export default function __wbg_init[^\n]*\n/,
		"",
		"__wbg_init declaration"
	);

	return out;
}

export async function lint(code, filePath) {
	const eslint = new ESLint({
		cwd: coreDir,
		overrideConfigFile: path.join(here, "eslint.config.mjs"),
	});
	const [result] = await eslint.lintText(code, { filePath, warnIgnored: true });
	if (!result || result.messages.length === 0) return null;

	const formatter = await eslint.loadFormatter("stylish");

	return formatter.format([result]);
}

async function main() {
	const [inDir, outDir] = process.argv.slice(2);
	if (!inDir || !outDir) {
		console.error("usage: harden.mjs <wasm-bindgen out dir> <dest dir>");
		process.exit(2);
	}

	const dest = path.resolve(outDir, "wasm.js");
	const rejected = path.resolve(outDir, "wasm.rejected.js");
	// never leave a stale copy behind for the bundler to pick up
	fs.rmSync(dest, { force: true });
	fs.rmSync(rejected, { force: true });

	const expectedSource = path
		.relative(path.resolve(outDir), snapshotFile)
		.split(path.sep)
		.join("/");
	if (expectedSource !== SNAPSHOT_SOURCE) {
		console.error(
			`harden: the glue has to be written to rewriter/wasm/out (import path would be ${expectedSource})`
		);
		process.exit(1);
	}

	let js, dts;
	try {
		js = harden(fs.readFileSync(path.join(inDir, "wasm.js"), "utf8"), {
			file: path.join(inDir, "wasm.js"),
			readSnippet: (source) =>
				fs.readFileSync(path.join(inDir, source), "utf8"),
		});
		dts = hardenTypes(fs.readFileSync(path.join(inDir, "wasm.d.ts"), "utf8"));
	} catch (e) {
		if (!(e instanceof HardenError)) throw e;
		console.error(
			`harden: wasm-bindgen output has changed in ways harden.mjs doesn't handle:\n\n${e.message}\n`
		);
		process.exit(1);
	}

	// formatted before linting, so the report's line numbers are the file's
	js = await prettier.format(js, {
		...(await prettier.resolveConfig(dest)),
		filepath: dest,
	});

	const report = await lint(js, dest);
	if (report) {
		fs.writeFileSync(rejected, js);
		console.error(
			`harden: the hardened glue still has unsafe accesses; refusing to write it.\n` +
				`(written to ${path.relative(process.cwd(), rejected)} for inspection)\n${report}`
		);
		process.exit(1);
	}

	fs.writeFileSync(dest, js);
	fs.writeFileSync(path.resolve(outDir, "wasm.d.ts"), dts);
	console.log(`harden: wrote ${path.relative(process.cwd(), dest)}`);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await main();
