#!/usr/bin/env node
// Codegen for the IDL-driven Window/Document (un)proxying tables consumed by
// src/client/shared/unproxy.ts.
//
// We walk every IDL definition shipped in @webref/idl and emit a static
// TypeScript file describing every operation/attribute/dictionary member that
// either:
//   - takes a Window/WindowProxy/Document value (so we must unwrap our own
//     globalProxy/documentProxy before native code sees it), or
//   - returns a Window/WindowProxy/Document value (so we must wrap the real
//     window/document with our proxy before user code sees it).
//
// The generated file is fully static and ships as plain code -- no IDL or
// webidl2 lives at runtime.

import { parseAll } from "@webref/idl";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePkgRoot = join(__dirname, "..");
// NB: lives outside src/client/shared/ because client.ts uses
// import.meta.webpackContext("./shared", ...) to auto-load every module in
// that directory as a ScramjetModule -- this file is data, not a module.
const outFile = join(corePkgRoot, "src/client/unproxy.generated.ts");

const require = createRequire(import.meta.url);
const webrefVersion = (() => {
	try {
		return require("@webref/idl/package.json").version;
	} catch {
		return "unknown";
	}
})();

// ----- Type classification ---------------------------------------------------

// Maps WebIDL type names that resolve to one of our two proxy kinds.
//   - "w" covers Window and its WebIDL alias WindowProxy.
//   - "d" covers Document AND any of its supertypes that the runtime might
//     legitimately receive a Document through. The most common one is `Node`
//     -- Document inherits from Node, so any IDL declaration with type Node
//     can carry a Document at runtime and must be (un)wrapped.
const KIND_BY_TYPE = {
	Window: "w",
	WindowProxy: "w",
	Document: "d",
	Node: "d",
};

/**
 * Walks an IDL idlType node (argument-type / attribute-type / return-type /
 * dictionary-type / etc) and returns "w" | "d" | null based on whether the
 * type expression definitely resolves to Window/Document. Unions and generic
 * wrappers (Promise<T>, sequence<T>, FrozenArray<T>...) are followed.
 */
function classifyType(t) {
	if (!t) return null;

	if (t.union && Array.isArray(t.idlType)) {
		for (const sub of t.idlType) {
			const k = classifyType(sub);
			if (k) return k;
		}
		return null;
	}

	if (t.generic && Array.isArray(t.idlType)) {
		for (const sub of t.idlType) {
			const k = classifyType(sub);
			if (k) return k;
		}
		return null;
	}

	if (typeof t.idlType === "string") {
		return KIND_BY_TYPE[t.idlType] ?? null;
	}

	return null;
}

/**
 * Returns the leaf type-name string of an idlType, drilling through unions
 * and generics. Used to detect dictionary-typed args so we can recurse into
 * dictionary members.
 */
function leafTypeNames(t) {
	if (!t) return [];
	if (t.union && Array.isArray(t.idlType)) {
		return t.idlType.flatMap(leafTypeNames);
	}
	if (t.generic && Array.isArray(t.idlType)) {
		return t.idlType.flatMap(leafTypeNames);
	}
	return typeof t.idlType === "string" ? [t.idlType] : [];
}

// ----- Definition collection -------------------------------------------------

const all = await parseAll();

const interfaces = new Map(); // interfaceName -> [partial defs...]
const mixins = new Map(); // mixinName -> [partial defs...]
const namespaces = new Map(); // namespaceName -> [partial defs...]
const dicts = new Map(); // dictionaryName -> [partial defs...]
const includes = new Map(); // interfaceName -> [mixinName...]

for (const list of Object.values(all)) {
	for (const def of list) {
		switch (def.type) {
			case "interface":
			case "callback interface":
				if (!interfaces.has(def.name)) interfaces.set(def.name, []);
				interfaces.get(def.name).push(def);
				break;
			case "interface mixin":
				if (!mixins.has(def.name)) mixins.set(def.name, []);
				mixins.get(def.name).push(def);
				break;
			case "namespace":
				if (!namespaces.has(def.name)) namespaces.set(def.name, []);
				namespaces.get(def.name).push(def);
				break;
			case "dictionary":
				if (!dicts.has(def.name)) dicts.set(def.name, []);
				dicts.get(def.name).push(def);
				break;
			case "includes":
				if (!includes.has(def.target)) includes.set(def.target, []);
				includes.get(def.target).push(def.includes);
				break;
		}
	}
}

// ----- Dictionary path resolution -------------------------------------------

// For each dictionary, compute the list of property paths whose values
// resolve to Window/Document. Used to recurse into dict args (e.g.
// IntersectionObserverInit { (Element or Document)? root; }).
const dictPaths = new Map(); // dictName -> [{ path: string[], kind: "w" | "d" }]

function collectDictPaths(dictName, seen = new Set()) {
	if (seen.has(dictName)) return [];
	seen.add(dictName);

	if (dictPaths.has(dictName)) return dictPaths.get(dictName);

	const parts = dicts.get(dictName);
	if (!parts) {
		dictPaths.set(dictName, []);
		return [];
	}

	const paths = [];
	for (const part of parts) {
		if (part.inheritance) {
			for (const p of collectDictPaths(part.inheritance, seen)) {
				paths.push(p);
			}
		}
		for (const member of part.members ?? []) {
			if (member.type !== "field") continue;
			const direct = classifyType(member.idlType);
			if (direct) {
				paths.push({ path: [member.name], kind: direct });
				continue;
			}
			for (const leafName of leafTypeNames(member.idlType)) {
				if (!dicts.has(leafName)) continue;
				for (const sub of collectDictPaths(leafName, seen)) {
					paths.push({ path: [member.name, ...sub.path], kind: sub.kind });
				}
			}
		}
	}

	dictPaths.set(dictName, paths);
	return paths;
}

for (const dictName of dicts.keys()) collectDictPaths(dictName);

// ----- Member walk ----------------------------------------------------------

/**
 * Returns the merged set of own + included-mixin members for an interface or
 * namespace. We never inherit members down the interface chain because the
 * inherited members live on the parent's prototype object in JS, where we'll
 * already patch them when we visit the parent interface.
 */
function gatherMembers(name) {
	const out = [];
	for (const part of interfaces.get(name) ?? []) {
		for (const m of part.members ?? []) out.push(m);
	}
	for (const part of namespaces.get(name) ?? []) {
		for (const m of part.members ?? []) out.push(m);
	}
	for (const mixinName of includes.get(name) ?? []) {
		for (const part of mixins.get(mixinName) ?? []) {
			for (const m of part.members ?? []) out.push(m);
		}
	}
	return out;
}

/**
 * Classify an operation/constructor argument list into selector tuples.
 * A selector is either:
 *   [argIdx, kind]                      -- the entire argument is W/D
 *   [argIdx, kind, ...path]             -- a property path inside a dict arg
 */
function classifyArgs(args) {
	const out = [];
	for (let i = 0; i < (args ?? []).length; i++) {
		const arg = args[i];
		const direct = classifyType(arg.idlType);
		if (direct) {
			out.push([i, direct]);
			continue;
		}
		for (const leafName of leafTypeNames(arg.idlType)) {
			const paths = dictPaths.get(leafName);
			if (!paths || paths.length === 0) continue;
			for (const { path, kind } of paths) {
				out.push([i, kind, ...path]);
			}
		}
	}
	return out;
}

// Coalesce overloads / partial definitions into a single entry per
// (owner, member, isStatic, isCtor) tuple. When two overloads disagree on
// return type (e.g. Document.open returns Document or WindowProxy depending
// on overload) we collapse to "*" -- the runtime probes the actual value.
const opMap = new Map(); // key -> { owner, member, isStatic, isCtor, argSelectors:Set, returnKinds:Set }
const attrMap = new Map(); // key -> { owner, member, isStatic, kind, readonly }

function opKey(owner, member, isStatic, isCtor) {
	return `${owner}\0${member}\0${isStatic ? 1 : 0}\0${isCtor ? 1 : 0}`;
}

function recordOperation(
	owner,
	member,
	isStatic,
	isCtor,
	argSelectors,
	returnKind
) {
	const key = opKey(owner, member, isStatic, isCtor);
	let entry = opMap.get(key);
	if (!entry) {
		entry = {
			owner,
			member,
			isStatic,
			isCtor,
			argSelectors: new Map(), // serialized selector -> selector array
			returnKinds: new Set(),
		};
		opMap.set(key, entry);
	}
	for (const sel of argSelectors) {
		entry.argSelectors.set(JSON.stringify(sel), sel);
	}
	if (returnKind) entry.returnKinds.add(returnKind);
}

function recordAttribute(owner, member, isStatic, kind, readonly) {
	const key = opKey(owner, member, isStatic, false);
	const entry = attrMap.get(key);
	if (!entry) {
		attrMap.set(key, { owner, member, isStatic, kind, readonly });
		return;
	}
	// If conflicting kinds, fall back to "*" (probe at runtime).
	if (entry.kind !== kind) entry.kind = "*";
	// readonly only stays true if every overload says readonly.
	entry.readonly = entry.readonly && readonly;
}

// Members on these owners are handled directly by createGlobalProxy /
// createDocumentProxy. Attribute traps installed on their prototypes would
// either never fire (LegacyUnforgeable own props shadow the getter) or be
// redundant with the global/document proxy. Skip them at codegen time.
const SKIP_ATTRIBUTE_OWNERS = new Set([
	"Window",
	"WorkerGlobalScope",
	"DedicatedWorkerGlobalScope",
	"SharedWorkerGlobalScope",
	"ServiceWorkerGlobalScope",
]);
const SKIP_ATTRIBUTE_PAIRS = new Set([
	"Document\0defaultView", // handled by createDocumentProxy
]);

function shouldSkipAttribute(owner, member) {
	if (SKIP_ATTRIBUTE_OWNERS.has(owner)) return true;
	if (SKIP_ATTRIBUTE_PAIRS.has(`${owner}\0${member}`)) return true;
	return false;
}

// Owners whose runtime instances are represented to user code by our
// globalProxy / documentProxy. Any method on these prototypes (and their
// supertypes / mixins) is reachable as `proxy.method(...)`, which lands in
// native code with `this === <proxy>` and trips an Illegal invocation. We
// emit an entry for every such method even when its IDL signature doesn't
// touch Window/Document/Node, so the runtime apply hook can swap `this` back
// to the underlying real object.
//
// Attributes don't need this treatment: createGlobalProxy / createDocumentProxy
// reach them via Reflect.get / Reflect.set, which run native getters/setters
// with `this` = the underlying real object already.
const THIS_UNPROXY_OWNERS = new Set([
	"Window",
	"Document",
	"Node",
	"EventTarget",
	"WorkerGlobalScope",
	"DedicatedWorkerGlobalScope",
	"SharedWorkerGlobalScope",
	"ServiceWorkerGlobalScope",
]);

function walkOwner(ownerName, kind /* "interface" | "namespace" */) {
	const ownerNeedsThisUnproxy = THIS_UNPROXY_OWNERS.has(ownerName);
	for (const member of gatherMembers(ownerName)) {
		const isStatic = kind === "namespace" ? true : member.special === "static";

		if (member.type === "operation") {
			if (!member.name) continue; // skip stringifier / indexed getter / etc.
			const argSelectors = classifyArgs(member.arguments);
			const returnKind = classifyType(member.idlType);
			// Always emit when the owner is one of the proxied globals --
			// we still need to install the apply hook to swap `this`. For
			// other owners, only emit when the signature actually touches
			// Window/Document/Node.
			if (
				argSelectors.length === 0 &&
				!returnKind &&
				!(ownerNeedsThisUnproxy && !isStatic)
			)
				continue;
			recordOperation(
				ownerName,
				member.name,
				isStatic,
				false,
				argSelectors,
				returnKind
			);
			continue;
		}

		if (member.type === "constructor") {
			const argSelectors = classifyArgs(member.arguments);
			if (argSelectors.length === 0) continue;
			recordOperation(ownerName, "", false, true, argSelectors, null);
			continue;
		}

		if (member.type === "attribute") {
			const direct = classifyType(member.idlType);
			if (!direct) continue;
			if (shouldSkipAttribute(ownerName, member.name)) continue;
			recordAttribute(
				ownerName,
				member.name,
				isStatic,
				direct,
				!!member.readonly
			);
		}
	}
}

for (const name of interfaces.keys()) walkOwner(name, "interface");
for (const name of namespaces.keys()) walkOwner(name, "namespace");

// ----- Output ----------------------------------------------------------------

function compareEntries(a, b) {
	if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
	if (a.member !== b.member) return a.member < b.member ? -1 : 1;
	if (a.isStatic !== b.isStatic) return a.isStatic ? 1 : -1;
	if ((a.isCtor ?? false) !== (b.isCtor ?? false)) return a.isCtor ? 1 : -1;
	return 0;
}

const opEntries = [...opMap.values()].sort(compareEntries);
const attrEntries = [...attrMap.values()].sort(compareEntries);

function formatSelector(sel) {
	// sel = [idx, kind, ...path]
	const [idx, kind, ...path] = sel;
	if (path.length === 0) {
		return `[${idx}, ${JSON.stringify(kind)}]`;
	}
	return `[${idx}, ${JSON.stringify(kind)}, ${path.map((p) => JSON.stringify(p)).join(", ")}]`;
}

function formatReturnKind(kinds) {
	if (kinds.size === 0) return JSON.stringify("");
	if (kinds.size === 1) return JSON.stringify([...kinds][0]);
	return JSON.stringify("*"); // mixed -> probe at runtime
}

const opLines = opEntries.map((e) => {
	const selectors = [...e.argSelectors.values()];
	const selectorsStr = selectors.length
		? `[${selectors.map(formatSelector).join(", ")}]`
		: "[]";
	return `\t[${JSON.stringify(e.owner)}, ${JSON.stringify(e.member)}, ${e.isStatic}, ${e.isCtor}, ${selectorsStr}, ${formatReturnKind(e.returnKinds)}],`;
});

const attrLines = attrEntries.map(
	(e) =>
		`\t[${JSON.stringify(e.owner)}, ${JSON.stringify(e.member)}, ${e.isStatic}, ${JSON.stringify(e.kind)}, ${e.readonly}],`
);

const banner = `// AUTO-GENERATED by tools/generate-unproxy-tables.mjs - DO NOT EDIT BY HAND.
// Source: @webref/idl @ ${webrefVersion}
// Regenerate with: ./cv core:gen-unproxy`;

const body = `${banner}

/**
 * Single character proxy "kind" tag:
 *   "w" -> Window/WindowProxy   "d" -> Document
 *   "*" -> overload disagrees, probe the value at runtime
 */
export type ProxyKind = "w" | "d" | "*";

/**
 * Selector for a Window/Document value reachable from an operation argument.
 *   [argIdx, kind]                 -- the entire argument
 *   [argIdx, kind, ...path]        -- a property path inside a dict arg
 *                                     (e.g. options.root)
 */
export type ArgSelector = readonly [
	argIdx: number,
	kind: "w" | "d",
	...path: string[],
];

/**
 * Operation/constructor table entry:
 *   [owner, member, isStatic, isCtor, argSelectors, returnKind]
 *
 * - owner is the interface/namespace name (e.g. "Document", "Window")
 * - member is the method name; "" for constructors
 * - isStatic=true patches \`Owner.member\`, false patches \`Owner.prototype.member\`
 * - isCtor=true patches the interface constructor itself
 * - returnKind=""  means no return wrapping needed
 */
export type OpEntry = readonly [
	owner: string,
	member: string,
	isStatic: boolean,
	isCtor: boolean,
	argSelectors: readonly ArgSelector[],
	returnKind: ProxyKind | "",
];

/**
 * Attribute table entry:
 *   [owner, member, isStatic, kind, readonly]
 *
 * isStatic=true patches \`Owner.member\`, false patches \`Owner.prototype.member\`.
 */
export type AttrEntry = readonly [
	owner: string,
	member: string,
	isStatic: boolean,
	kind: ProxyKind,
	readonly: boolean,
];

export const OPERATIONS: readonly OpEntry[] = [
${opLines.join("\n")}
];

export const ATTRIBUTES: readonly AttrEntry[] = [
${attrLines.join("\n")}
];
`;

mkdirSync(dirname(outFile), { recursive: true });

let prev = "";
try {
	prev = readFileSync(outFile, "utf8");
} catch {}

if (prev !== body) {
	writeFileSync(outFile, body);
	console.log(
		`[generate-unproxy-tables] wrote ${opEntries.length} operations and ${attrEntries.length} attributes to ${outFile}`
	);
} else {
	console.log(
		`[generate-unproxy-tables] up to date (${opEntries.length} operations, ${attrEntries.length} attributes)`
	);
}
