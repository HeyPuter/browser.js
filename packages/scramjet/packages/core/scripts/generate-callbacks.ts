/**
 * Expand every Web IDL member that takes a callback into the table
 * `src/client/callbacks.generated.ts`, which `shared/callbacks.ts`
 * patches at run time.
 *
 * https://html.spec.whatwg.org/multipage/webappapis.html#backup-incumbent-settings-object-stack
 *
 * A callback records the incumbent settings object when Web IDL converts it,
 * and the host pushes that onto the backup incumbent settings object stack
 * whenever it runs the callback. Converting happens in the binding of whichever
 * member the callback is handed to, so every one of those has to be patched to
 * capture it - and there are hundreds, most of them `on*` attributes. Listing
 * them by hand would be out of date the day it was written.
 *
 * Run by the build; reads `@webref/idl`, the curated IDL of every spec.
 */

import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import idl from "@webref/idl";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../src/client/callbacks.generated.ts");
const RUST_OUT = path.join(
	__dirname,
	"../rewriter/js/src/callbacks.generated.rs"
);

async function writeIfChanged(file: string, text: string) {
	const current = await readFile(file, "utf8").catch(() => "");
	if (current !== text) await writeFile(file, text);
}

/**
 * Callback types never wrapped, and why.
 *
 * - `XPathNSResolver` is immediate: `evaluate` and `createExpression` call it
 *   while they run, with the caller's script still on the stack, and never
 *   again. The backup entry it would push is that same caller.
 * - the constructors - `CustomElementConstructor` and the worklets' - are
 *   constructed rather than called, and `customElements.get` hands the page's
 *   one back, so it has to stay the page's own function. Their lifecycle
 *   callbacks are read off the prototype, out of reach of a binding patch.
 */
const EXCLUDED_TYPES = new Set([
	"XPathNSResolver",
	// Chromium, not the spec: a queuing strategy's `size` is called as a plain
	// function, with no callback prepared, so the script that enqueued is the
	// incumbent rather than the one that handed the strategy over. Measured in
	// the runway's `incumbent-backup-strategy-size`
	"QueuingStrategySize",
	"CustomElementConstructor",
	"AudioWorkletProcessorConstructor",
	"AnimatorInstanceConstructor",
]);

/** Members whose callback is a constructor declared as a plain `VoidFunction`. */
const EXCLUDED_MEMBERS = new Set([
	"PaintWorkletGlobalScope.registerPaint",
	"LayoutWorkletGlobalScope.registerLayout",
]);

/** Callback function types Web IDL defines itself, not in any spec's IDL. */
const BUILTIN_CALLBACKS = new Set(["Function", "VoidFunction"]);

type IDLType = {
	idlType: string | IDLType[];
	union: boolean;
	generic: string;
	nullable: boolean;
};
type Def = any;

/** What a converted value is, as far as wrapping goes. */
type Shape =
	/** a callback function: wrap it if it is callable */
	| { kind: "function" }
	/**
	 * a callback interface: a callable is called as-is, any other object has
	 * `operation` looked up on it at call time
	 */
	| { kind: "interface"; operation: string }
	/** a dictionary with callback members */
	| { kind: "dictionary"; name: string };

const all = await idl.parseAll();

const defs = new Map<string, Def>();
const partials: Def[] = [];
const includes: Def[] = [];
for (const specDefs of Object.values(all) as Def[][]) {
	for (const def of specDefs) {
		if (def.type === "includes") {
			includes.push(def);
			continue;
		}
		if (def.partial) {
			partials.push(def);
			continue;
		}
		if (!defs.has(def.name)) defs.set(def.name, def);
	}
}

/**
 * Each definition's members with its partials' merged in. Kept apart from the
 * definitions themselves, whose `type` and `name` are prototype getters that
 * a copy would lose.
 */
const membersOf = new Map<string, Def[]>();
for (const def of defs.values())
	membersOf.set(def.name, [...(def.members ?? [])]);
for (const partial of partials)
	membersOf.get(partial.name)?.push(...partial.members);

/** Every shape `type` can take that needs wrapping, through typedefs and unions. */
function shapesOf(
	type: IDLType,
	seen = new Set<string>(),
	dictionaries = true
): Shape[] {
	if (type.union) {
		return (type.idlType as IDLType[]).flatMap((t) =>
			shapesOf(t, seen, dictionaries)
		);
	}
	// a sequence or record of callbacks is converted item by item, which no
	// member here takes; a Promise's callbacks are the ECMAScript job's
	if (type.generic) return [];

	const name = type.idlType as string;
	if (EXCLUDED_TYPES.has(name) || seen.has(name)) return [];
	if (BUILTIN_CALLBACKS.has(name)) return [{ kind: "function" }];

	const def = defs.get(name);
	if (!def) return [];
	seen.add(name);

	if (def.type === "typedef") return shapesOf(def.idlType, seen, dictionaries);
	if (def.type === "callback") {
		return [{ kind: "function" }];
	}
	if (def.type === "callback interface") {
		const operation = membersOf
			.get(name)!
			.find((m: Def) => m.type === "operation");
		return operation ? [{ kind: "interface", operation: operation.name }] : [];
	}
	if (
		dictionaries &&
		def.type === "dictionary" &&
		dictionaryHasCallbacks(name)
	) {
		return [{ kind: "dictionary", name }];
	}

	return [];
}

/** A dictionary's members in conversion order: inherited first, each sorted. */
function dictionaryMembers(name: string): { name: string; type: IDLType }[] {
	const def = defs.get(name);
	if (!def || def.type !== "dictionary") return [];

	const own = membersOf
		.get(name)!
		.filter((m: Def) => m.type === "field")
		.map((m: Def) => ({ name: m.name, type: m.idlType }))
		.sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	return [
		...(def.inheritance ? dictionaryMembers(def.inheritance) : []),
		...own,
	];
}

function dictionaryHasCallbacks(name: string): boolean {
	return dictionaryMembers(name).some((m) => memberShape(m.type) !== null);
}

/** The one shape a dictionary member is wrapped as, or null. Nested dictionaries are not followed. */
function memberShape(type: IDLType): Shape | null {
	const shapes = shapesOf(type, new Set(), false);
	if (!shapes.length) return null;

	return shapes.find((s) => s.kind === "interface") ?? shapes[0];
}

/** Merge the shapes an argument position takes across overloads. */
function argumentCode(shapes: Shape[]): string | null {
	if (!shapes.length) return null;

	// an interface shape is only safe to apply to a non-callable object when
	// no overload takes some other object there - which overloads that merge
	// here never do, since Web IDL would not be able to tell them apart
	const iface = shapes.find((s) => s.kind === "interface");
	if (iface && iface.kind === "interface") return `i:${iface.operation}`;
	// a union of a callback and a dictionary takes a function as the callback,
	// where a dictionary alone would take it as a callable dictionary
	const dict = shapes.find((s) => s.kind === "dictionary");
	if (dict && dict.kind === "dictionary") {
		const fn = shapes.some((s) => s.kind === "function");
		return `${fn ? "fd" : "d"}:${dict.name}`;
	}

	return "f";
}

type Entry = {
	iface: string;
	global: boolean;
	member: string;
	kind: "o" | "s" | "c" | "a" | "r";
	args: [number, string][];
	reg?: "add" | "remove";
};

const entries: Entry[] = [];

function interfaceMembers(def: Def): Def[] {
	const members = [...membersOf.get(def.name)!];
	for (const inc of includes) {
		if (inc.target !== def.name) continue;
		members.push(...(membersOf.get(inc.includes) ?? []));
	}

	return members;
}

for (const def of defs.values()) {
	if (def.type !== "interface" && def.type !== "namespace") continue;
	if (def.extAttrs?.some((e: Def) => e.name === "LegacyNoInterfaceObject"))
		continue;

	const global = def.extAttrs?.some((e: Def) => e.name === "Global") ?? false;
	const byOperation = new Map<
		string,
		{ kind: "o" | "s"; positions: Map<number, Shape[]> }
	>();
	const constructorPositions = new Map<number, Shape[]>();

	for (const member of interfaceMembers(def)) {
		if (EXCLUDED_MEMBERS.has(`${def.name}.${member.name}`)) continue;
		if (member.type === "operation" && member.name) {
			const kind =
				member.special === "static" || def.type === "namespace" ? "s" : "o";
			const key = `${kind}:${member.name}`;
			let op = byOperation.get(key);
			if (!op) {
				op = { kind, positions: new Map() };
				byOperation.set(key, op);
			}
			member.arguments.forEach((arg: Def, i: number) => {
				const shapes = shapesOf(arg.idlType);
				if (!shapes.length) return;
				op!.positions.set(i, [...(op!.positions.get(i) ?? []), ...shapes]);
			});
		} else if (member.type === "constructor") {
			member.arguments.forEach((arg: Def, i: number) => {
				const shapes = shapesOf(arg.idlType);
				if (shapes.length)
					constructorPositions.set(i, [
						...(constructorPositions.get(i) ?? []),
						...shapes,
					]);
			});
		} else if (member.type === "attribute" && member.special !== "static") {
			const code = argumentCode(shapesOf(member.idlType));
			if (!code) continue;
			entries.push({
				iface: def.name,
				global,
				member: member.name,
				kind: member.readonly ? "r" : "a",
				args: [[0, code]],
			});
		}
	}

	const names = new Set([...byOperation.keys()]);
	for (const [key, op] of byOperation) {
		if (!op.positions.size) continue;
		const name = key.slice(2);
		const args = [...op.positions]
			.map(([i, shapes]) => [i, argumentCode(shapes)!] as [number, string])
			.sort((a, b) => a[0] - b[0]);

		// an add/remove pair keeps one stand-in per callback and receiver, so
		// the remove finds what the add registered and a second add is the
		// no-op it is natively
		let reg: Entry["reg"];
		const add = /^add(.+)$/.exec(name);
		const remove = /^remove(.+)$/.exec(name);
		if (add && names.has(`${op.kind}:remove${add[1]}`)) reg = "add";
		else if (remove && names.has(`${op.kind}:add${remove[1]}`)) reg = "remove";

		entries.push({
			iface: def.name,
			global,
			member: name,
			kind: op.kind,
			args,
			reg,
		});
	}

	if (constructorPositions.size) {
		entries.push({
			iface: def.name,
			global: false,
			member: "constructor",
			kind: "c",
			args: [...constructorPositions]
				.map(([i, shapes]) => [i, argumentCode(shapes)!] as [number, string])
				.sort((a, b) => a[0] - b[0]),
		});
	}
}

entries.sort((a, b) =>
	a.iface === b.iface
		? a.member < b.member
			? -1
			: 1
		: a.iface < b.iface
			? -1
			: 1
);

// only the dictionaries something takes
const dictionaries = new Map<string, [string, string | null][]>();
for (const entry of entries) {
	for (const [, code] of entry.args) {
		if (!code.startsWith("d:") && !code.startsWith("fd:")) continue;
		const name = code.slice(code.indexOf(":") + 1);
		if (dictionaries.has(name)) continue;
		dictionaries.set(
			name,
			dictionaryMembers(name).map((m) => {
				const shape = memberShape(m.type);
				const c = shape ? argumentCode([shape]) : null;
				return [m.name, c];
			})
		);
	}
}

const q = JSON.stringify;
const lines = [
	"// generated by scripts/generate-callbacks.ts from @webref/idl - do not edit",
	"",
	"/**",
	" * `[interface, global, member, kind, arguments, registration]`",
	" *",
	" * - kind: `o` operation, `s` static operation, `c` constructor, `a` attribute",
	" *   (the setter wraps, the getter unwraps), `r` readonly attribute (the",
	" *   getter unwraps)",
	" * - arguments: `[index, shape]`, where shape is `f` a callback function,",
	" *   `i:<operation>` a callback interface, `d:<dictionary>` a dictionary with",
	" *   callback members, `fd:<dictionary>` a union of a callback and such a",
	" *   dictionary",
	" * - registration: `add` / `remove` for a listener pair",
	" */",
	"export type CallbackEntry = [",
	"\tstring,",
	"\t0 | 1,",
	"\tstring,",
	'\t"o" | "s" | "c" | "a" | "r",',
	"\t[number, string][],",
	'\t("add" | "remove")?,',
	"];",
	"",
	"export const CALLBACK_MEMBERS: CallbackEntry[] = [",
	...entries.map(
		(e) =>
			`\t[${q(e.iface)}, ${e.global ? 1 : 0}, ${q(e.member)}, ${q(e.kind)}, ${q(e.args)}${e.reg ? `, ${q(e.reg)}` : ""}],`
	),
	"];",
	"",
	"/** The dictionaries above, as `[member, shape | null]` in conversion order. */",
	"export const CALLBACK_DICTIONARIES: Record<string, [string, string | null][]> = {",
	...[...dictionaries].map(([name, members]) => `\t${q(name)}: ${q(members)},`),
	"};",
	"",
];

await writeIfChanged(OUT, lines.join("\n"));

// the rewriter's half: what `lazystamp` stamps, so that a conversion made from
// a lazily stamped script still has its realm recorded. Names only - the
// rewriter cannot tell which interface a call reaches, so a name some other
// method shares is stamped too, which costs a call through `callfn` and
// nothing else
const sorted = (names: Iterable<string>) => [...new Set(names)].sort();
const calls = sorted(
	entries
		.filter((e) => (e.kind === "o" || e.kind === "s") && e.reg !== "remove")
		.map((e) => e.member)
);
const constructors = sorted(
	entries.filter((e) => e.kind === "c").map((e) => e.iface)
);
const attributes = sorted(
	entries.filter((e) => e.kind === "a").map((e) => e.member)
);
const rust = (name: string, doc: string, values: string[]) =>
	[
		`/// ${doc}`,
		`pub const ${name}: &[&str] = &[`,
		...values.map((v) => `\t${q(v)},`),
		"];",
	].join("\n");
await writeIfChanged(
	RUST_OUT,
	[
		"// generated by packages/core/scripts/generate-callbacks.ts from @webref/idl - do not edit",
		"//",
		"// Every list is sorted, for `binary_search`.",
		"",
		rust("CALLBACK_CALLS", "methods that convert a callback", calls),
		"",
		rust(
			"CALLBACK_CONSTRUCTORS",
			"interfaces whose constructor converts one",
			constructors
		),
		"",
		rust(
			"CALLBACK_ATTRIBUTES",
			"attributes whose setter converts one",
			attributes
		),
		"",
	].join("\n")
);
console.log(
	`${entries.length} callback members, ${dictionaries.size} dictionaries`
);
