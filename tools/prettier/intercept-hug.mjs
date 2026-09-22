/**
 * Hug the lone class argument of a `.Intercept(...)` call.
 *
 * Prettier hugs a sole callback or object-literal argument, so `foo(() => {})`
 * keeps its braces on the call's own lines — but the heuristic that decides
 * this has no case for a class expression, and every interceptor comes out
 * broken onto its own indented line:
 *
 *   client.Intercept(
 *     class extends Element {
 *       ...
 *     }
 *   );
 *
 * That is a wasted level of indentation in files that are almost entirely
 * interceptor bodies. This narrows the hug to exactly that call, matched on the
 * `Intercept` member name — so `client.Intercept` and `this.Intercept` both
 * qualify and nothing else in the codebase changes shape:
 *
 *   client.Intercept(class extends Element {
 *     ...
 *   });
 *
 * The parser re-exports below are not decoration. Prettier picks the printer
 * off whichever plugin supplied the *parser* when that plugin also has one, and
 * its built-in proxy supplies both — so a plugin that exports only a printer is
 * never consulted. Claiming the estree parsers makes this plugin the one that
 * answers for them, and the printer below is the built-in with a single node
 * type handled differently.
 */

import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import * as babel from "prettier/plugins/babel";

const base = estree.printers.estree;

/** `<anything>.Intercept`, called as a method and not through `?.`. */
function isInterceptCallee(callee) {
	return (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		!callee.optional &&
		callee.property.type === "Identifier" &&
		callee.property.name === "Intercept"
	);
}

function isHuggableInterceptCall(node) {
	return (
		node.type === "CallExpression" &&
		!node.optional &&
		!node.typeArguments &&
		!node.typeParameters &&
		node.arguments.length === 1 &&
		node.arguments[0].type === "ClassExpression" &&
		isInterceptCallee(node.callee)
	);
}

export const parsers = {
	typescript: typescript.parsers.typescript,
	babel: babel.parsers.babel,
	"babel-ts": babel.parsers["babel-ts"],
};

export const printers = {
	estree: {
		...base,
		print(path, options, print, args) {
			if (isHuggableInterceptCall(path.node)) {
				// the class prints exactly as it would anywhere else; all this drops
				// is the indent + softline group around the argument list
				return [print("callee"), "(", print(["arguments", 0]), ")"];
			}

			return base.print(path, options, print, args);
		},
	},
};
