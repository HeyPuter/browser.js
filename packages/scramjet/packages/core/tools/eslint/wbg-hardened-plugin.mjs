/**
 * Rules for the hardened wasm-bindgen glue, and nothing else: see
 * tools/wbg/eslint.config.mjs.
 *
 * The glue runs in the page's realm, so every property lookup that can reach a
 * prototype is one the page can answer. These rules don't try to tell a safe
 * lookup from an unsafe one by type - a linter can't know `x` is a string - so
 * they ban member access outright and allow back only the forms that can't
 * reach anything the page owns. harden.mjs spells every other read through a
 * call-bound native or `Own_get` from wbg-snapshot.ts.
 */

function getModuleScope(scope) {
	let s = scope;
	while (s && s.type !== "module") s = s.upper;
	return s;
}

function resolve(context, identifier) {
	let scope = context.sourceCode.getScope(identifier);
	while (scope) {
		const ref = scope.references.find((r) => r.identifier === identifier);
		if (ref) return ref.resolved;
		scope = scope.upper;
	}

	return null;
}

function staticName(member) {
	return !member.computed && member.property.type === "Identifier"
		? member.property.name
		: null;
}

function isWriteTarget(node) {
	const parent = node.parent;

	return (
		(parent.type === "AssignmentExpression" && parent.left === node) ||
		(parent.type === "UpdateExpression" && parent.argument === node) ||
		(parent.type === "UnaryExpression" && parent.operator === "delete")
	);
}

/** The module-level class a `C` or `C.prototype` names, if any. */
function classDeclarationOf(context, identifier) {
	const variable = resolve(context, identifier);
	if (!variable || getModuleScope(variable.scope) !== variable.scope)
		return null;

	const def = variable.defs[0];

	return variable.defs.length === 1 && def.type === "ClassName"
		? def.node
		: null;
}

function classMembers(classNode, predicate) {
	return classNode.body.body.filter(
		(member) =>
			!member.static &&
			!member.computed &&
			member.key.type === "Identifier" &&
			predicate(member)
	);
}

/** A module-level `const x = $x`, `$x` being a named import. */
function isImportAlias(context, variable) {
	const def = variable?.defs.length === 1 ? variable.defs[0] : null;
	if (
		def?.type !== "Variable" ||
		def.parent.kind !== "const" ||
		getModuleScope(variable.scope) !== variable.scope ||
		def.node.init?.type !== "Identifier"
	)
		return false;

	return resolve(context, def.node.init)?.defs[0]?.type === "ImportBinding";
}

const rules = {
	/**
	 * Every import is read exactly once, into a module-level const alias, and
	 * only the alias is used. Not a safety rule: a bundler turns each use of an
	 * import binding into a getter call on the module-exports object, and in
	 * the glue's per-character loops that cost ~15x.
	 */
	"alias-imports": {
		meta: {
			type: "suggestion",
			schema: [],
			messages: {
				direct:
					"`{{name}}` is an import binding used directly; alias it to a module-level const (bundlers make every use a getter call).",
			},
		},
		create(context) {
			return {
				ImportSpecifier(node) {
					const [variable] = context.sourceCode.getDeclaredVariables(node);
					for (const ref of variable.references) {
						const parent = ref.identifier.parent;
						const aliased =
							parent.type === "VariableDeclarator" &&
							parent.init === ref.identifier &&
							isImportAlias(
								context,
								context.sourceCode.getDeclaredVariables(parent)[0]
							);
						if (!aliased)
							context.report({
								node: ref.identifier,
								messageId: "direct",
								data: { name: ref.identifier.name },
							});
					}
				},
			};
		},
	},

	/**
	 * No reference may leave the module, `undefined` aside (a non-writable
	 * global). Stricter than scramjet-core/no-globals, which lets through
	 * anything the scope manager resolved - and under espree, ESLint resolves
	 * every ES builtin (`Object`, `Uint8Array`, ...) to a global variable of its
	 * own.
	 */
	"no-globals": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				global:
					"Global `{{name}}`. The page can replace it; import the snapshot of it from wbg-snapshot.ts.",
			},
		},
		create(context) {
			return {
				"Program:exit"(node) {
					let global = context.sourceCode.getScope(node);
					while (global.upper) global = global.upper;

					const references = [...global.through];
					for (const variable of global.variables)
						references.push(...variable.references);

					for (const reference of references) {
						if (reference.identifier.name === "undefined") continue;
						context.report({
							node: reference.identifier,
							messageId: "global",
							data: { name: reference.identifier.name },
						});
					}
				},
			};
		},
	},

	/**
	 * A member expression is allowed only as one of:
	 *
	 *   wasm.name              `wasm` is the instance's exports object: frozen,
	 *                          with a null prototype, so a read resolves on the
	 *                          object or not at all. Never written.
	 *   this.field             in a class declaring `field` as an instance field
	 *                          (DefineField creates it as an own data property,
	 *                          so later reads and writes stop there)
	 *   this.method            read, in a class declaring `method`: it resolves
	 *                          on the class's own prototype
	 *   C.prototype            on a class declared in this module: a
	 *                          non-writable own property
	 *   C.prototype.method     a method declared in C's own body
	 */
	"no-unvetted-member": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				member:
					"Unvetted member access `{{text}}`. A property lookup here can reach a prototype the page controls: harden.mjs must rewrite it onto wbg-snapshot.ts (a call-bound native, or Own_get for an own data property).",
				write:
					"Write through `{{text}}`. [[Set]] consults setters up the prototype chain; only instance fields may be assigned.",
			},
		},
		create(context) {
			function isExports(object) {
				if (object.type !== "Identifier" || object.name !== "wasm")
					return false;
				const variable = resolve(context, object);

				return !!variable && getModuleScope(variable.scope) === variable.scope;
			}

			function isOwnField(node) {
				const name = staticName(node);
				if (node.object.type !== "ThisExpression" || !name) return false;

				let fn = node.parent;
				while (fn && fn.type !== "MethodDefinition") fn = fn.parent;
				// `this` has to be the instance: not a static method, and not
				// inside a plain function nested in the method
				if (!fn || fn.static) return false;
				for (let n = node.parent; n !== fn; n = n.parent) {
					if (
						(n.type === "FunctionExpression" ||
							n.type === "FunctionDeclaration") &&
						n !== fn.value
					)
						return false;
				}

				const classNode = fn.parent.parent;
				const declared = (type) =>
					classMembers(
						classNode,
						(m) =>
							m.type === type &&
							(type !== "MethodDefinition" || m.kind === "method") &&
							m.key.name === name
					).length === 1;

				// a field is written as well as read; a method is only read, and
				// resolves on the class's own prototype
				return (
					declared("PropertyDefinition") ||
					(declared("MethodDefinition") && !isWriteTarget(node))
				);
			}

			function prototypeOf(node) {
				if (
					node.type !== "MemberExpression" ||
					staticName(node) !== "prototype" ||
					node.object.type !== "Identifier"
				)
					return null;

				return classDeclarationOf(context, node.object);
			}

			return {
				MemberExpression(node) {
					const text = context.sourceCode.getText(node);
					const write = isWriteTarget(node);

					if (isOwnField(node)) return;
					if (write) {
						context.report({ node, messageId: "write", data: { text } });
						return;
					}

					if (staticName(node) && isExports(node.object)) return;
					if (prototypeOf(node)) return;

					const classNode = prototypeOf(node.object);
					const name = staticName(node);
					if (
						classNode &&
						name &&
						classMembers(
							classNode,
							(m) =>
								m.type === "MethodDefinition" &&
								m.kind === "method" &&
								m.key.name === name
						).length === 1
					)
						return;

					context.report({ node, messageId: "member", data: { text } });
				},
			};
		},
	},

	/**
	 * Every object literal starts with `__proto__: null`. A literal with
	 * `Object.prototype` behind it answers any key it lacks from the page: a
	 * dictionary handed to a native (`{ fatal: true }`) reads its absent members
	 * through the chain, and so does the imports object WebAssembly.Instance
	 * walks.
	 */
	"null-proto-literals": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				literal:
					"Object literal without a leading `__proto__: null`; its absent keys resolve on the page's Object.prototype.",
			},
		},
		create(context) {
			return {
				ObjectExpression(node) {
					const first = node.properties[0];
					const ok =
						first &&
						first.type === "Property" &&
						first.kind === "init" &&
						!first.computed &&
						!first.shorthand &&
						!first.method &&
						((first.key.type === "Identifier" &&
							first.key.name === "__proto__") ||
							(first.key.type === "Literal" &&
								first.key.value === "__proto__")) &&
						first.value.type === "Literal" &&
						first.value.value === null;
					if (!ok) context.report({ node, messageId: "literal" });
				},
			};
		},
	},

	/** Named imports, from the one module listed, and nothing dynamic. */
	"only-snapshot-imports": {
		meta: {
			type: "problem",
			schema: [
				{
					type: "object",
					properties: { source: { type: "string" } },
					required: ["source"],
					additionalProperties: false,
				},
			],
			messages: {
				source:
					"Import from '{{source}}'. The glue may only import from '{{allowed}}'.",
				specifier: "Only named imports are allowed.",
				dynamic: "Dynamic import and import.meta are not allowed.",
				exportFrom: "Re-exports are not allowed.",
			},
		},
		create(context) {
			const allowed = context.options[0].source;

			return {
				ImportDeclaration(node) {
					if (node.source.value !== allowed)
						context.report({
							node,
							messageId: "source",
							data: { source: node.source.value, allowed },
						});
					for (const specifier of node.specifiers) {
						if (specifier.type !== "ImportSpecifier")
							context.report({ node: specifier, messageId: "specifier" });
					}
				},
				ImportExpression(node) {
					context.report({ node, messageId: "dynamic" });
				},
				MetaProperty(node) {
					context.report({ node, messageId: "dynamic" });
				},
				"ExportAllDeclaration, ExportNamedDeclaration[source]"(node) {
					context.report({ node, messageId: "exportFrom" });
				},
			};
		},
	},

	/**
	 * `new` only on an imported (snapshotted) constructor. `new X` on anything
	 * else constructs through whatever `X` is at the time.
	 */
	"new-only-snapshot": {
		meta: {
			type: "problem",
			schema: [],
			messages: {
				callee:
					"`new` on `{{text}}`, which is not a snapshot import (or a module-level const alias of one).",
			},
		},
		create(context) {
			return {
				NewExpression(node) {
					const variable =
						node.callee.type === "Identifier"
							? resolve(context, node.callee)
							: null;
					if (!isImportAlias(context, variable))
						context.report({
							node,
							messageId: "callee",
							data: { text: context.sourceCode.getText(node.callee) },
						});
				},
			};
		},
	},
};

export default { rules };
