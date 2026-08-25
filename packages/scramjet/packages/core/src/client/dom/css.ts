import { rewriteCss, unrewriteCss } from "@rewriters/css";
import { ScramjetClient } from "@client/index";
import {
	Object_getOwnPropertyDescriptor,
	Object_hasOwn,
	Reflect_apply,
	Reflect_defineProperty,
	Reflect_get,
	Reflect_set,
	Number_isInteger,
} from "@/shared/snapshot";
import { Arguments, Returns, Type, idlDOMString } from "@client/webidl";

export default function (client: ScramjetClient, self: Self) {
	const rewrite = (css: string) => rewriteCss(css, client.context, client.meta);
	const unrewrite = (css: string) => unrewriteCss(css, client.context);

	// https://drafts.csswg.org/cssom/#the-cssstyledeclaration-interface
	client.Intercept(class extends CSSStyleDeclaration {
		@Arguments("CSSOMString")
		@Returns("CSSOMString")
		getPropertyValue(property: string): string {
			const value = super.getPropertyValue(property);

			return value ? unrewrite(value) : value;
		}

		// needs the unrewrite - it returns the value it removed
		@Arguments("CSSOMString")
		@Returns("CSSOMString")
		removeProperty(property: string): string {
			const removed = super.removeProperty(property);

			return removed ? unrewrite(removed) : removed;
		}

		// the empty string is not a value to rewrite, it is the spec's signal
		// to remove the property, so it has to pass through untouched.
		// `priority` defaults to "" in the IDL; the parser discards defaults, so
		// spelling it out here would only pick a fight between prettier and the
		// quotes rule
		@Arguments(
			"CSSOMString",
			"[LegacyNullToEmptyString] CSSOMString",
			"optional [LegacyNullToEmptyString] CSSOMString priority"
		)
		@Returns("undefined")
		setProperty(property: string, value: string, priority?: string): void {
			super.setProperty(property, value ? rewrite(value) : value, priority);
		}

		@Type("[LegacyNullToEmptyString] CSSOMString")
		get cssText(): string {
			return unrewrite(super.cssText);
		}

		@Type("[LegacyNullToEmptyString] CSSOMString")
		set cssText(value: string) {
			super.cssText = rewrite(value);
		}
	});

	// https://drafts.csswg.org/cssom/#the-cssstylesheet-interface
	client.Intercept(class extends CSSStyleSheet {
		@Arguments("CSSOMString", "optional unsigned long index = 0")
		@Returns("unsigned long")
		insertRule(rule: string, index?: number): number {
			return super.insertRule(rewrite(rule), index);
		}

		// `async` so `Intercept` mints the promise in the caller's realm
		@Arguments("USVString")
		@Returns("Promise<CSSStyleSheet>")
		async replace(text: string): Promise<CSSStyleSheet> {
			return super.replace(rewrite(text));
		}

		@Arguments("USVString")
		@Returns("undefined")
		replaceSync(text: string): void {
			super.replaceSync(rewrite(text));
		}
	});

	client.Intercept(class extends CSSRule {
		@Type("CSSOMString")
		get cssText(): string {
			return unrewrite(super.cssText);
		}
	});

	client.Proxy("CSSStyleValue.parse", {
		apply(ctx) {
			if (!ctx.args[1]) return;
			ctx.args[1] = rewrite(ctx.args[1]);
		},
	});

	/**
	 * Blink installs the ~740 CSS property attributes as own properties of every
	 * declaration - `CSSStyleDeclaration.prototype` has ten own keys and not one
	 * of them is a CSS property. There is no shared accessor to intercept, so a
	 * declaration handed to the page has to be wrapped per instance.
	 *
	 * What the wrapper must not be is a guess. The classification below is
	 * exact: a key names a CSS attribute iff the declaration reports it as its
	 * own and it is not an array index. That is the browser's own installation
	 * answering the question, so it covers camelCase, the dashed spelling and
	 * both vendor-prefix casings with no list to keep in sync, and it excludes
	 * page-set expandos, which the previous `in CSSStyleDeclaration.prototype`
	 * test silently ran through the CSS un-rewriter.
	 */
	const isIndex = (prop: string) => {
		const n = +prop;

		return Number_isInteger(n) && n >= 0 && `${n}` === prop;
	};

	const isCssAttribute = (decl: object, prop: string | symbol) =>
		typeof prop === "string" && !isIndex(prop) && Object_hasOwn(decl, prop);

	const toCssValue = (value: unknown) =>
		value === null ? "" : idlDOMString(value);

	const wrapStyleDeclaration = (style: CSSStyleDeclaration) =>
		new Proxy(style, {
			get(target, prop) {
				if (isCssAttribute(target, prop)) {
					const value = Reflect_get(target, prop);

					return value ? unrewrite(value) : value;
				}

				const value = Reflect_get(target, prop);
				if (typeof value === "function") {
					return new Proxy(value, {
						apply: (fn, _that, args) => Reflect_apply(fn, target, args),
					});
				}

				return value;
			},

			set(target, prop, value) {
				if (!isCssAttribute(target, prop)) {
					return Reflect_set(target, prop, value);
				}

				const css = toCssValue(value);

				// the empty string is the spec's signal to remove the property,
				// not something to rewrite
				return Reflect_set(target, prop, css ? rewrite(css) : css);
			},

			getOwnPropertyDescriptor(target, prop) {
				const desc = Object_getOwnPropertyDescriptor(target, prop);
				if (!desc || !isCssAttribute(target, prop)) return desc;

				if (desc.value) desc.value = unrewrite(desc.value);

				return desc;
			},

			defineProperty(target, prop, desc) {
				if (!isCssAttribute(target, prop) || !("value" in desc)) {
					return Reflect_defineProperty(target, prop, desc);
				}

				const css = toCssValue(desc.value);

				return Reflect_defineProperty(target, prop, {
					...desc,
					value: css ? rewrite(css) : css,
				});
			},
		});

	/**
	 *   correct but extremely expensive proxy
	 *
	 *   client.Intercept(class extends GlobalScope {
	 *     @Arguments("Element", "optional CSSOMString?")
	 *     @Returns("CSSStyleDeclaration")
	 *     static getComputedStyle(elt: Element, pseudoElt?: string | null) {
	 *       return wrapStyleDeclaration(nGlobal.getComputedStyle(elt, pseudoElt));
	 *     }
	 *   });
	 */

	// `style` comes from the ElementCSSInlineStyle mixin and from four rule
	// interfaces, each with its own accessor - wrapping only HTMLElement left
	// `rule.style.backgroundImage` and the SVG/MathML inline styles uncovered.
	// `Trap` rather than `Intercept` because several of these are not universal,
	// and it skips a missing target instead of throwing on the heritage.
	for (const iface of [
		"HTMLElement",
		"SVGElement",
		"MathMLElement",
		"CSSStyleRule",
		"CSSPageRule",
		"CSSKeyframeRule",
		"CSSFontFaceRule",
		"CSSPositionTryRule",
	]) {
		client.Trap(`${iface}.prototype.style`, {
			get(ctx) {
				return wrapStyleDeclaration(ctx.get() as CSSStyleDeclaration);
			},
			set(ctx, value: string) {
				// this will actually run the trap for cssText. don't rewrite it here
				ctx.set(value);
			},
		});
	}
}
