import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";

// MARK: helpers
const INLINE_PREFIX = "inline-";

function serializeInlineStyle(
	session: CDPSession,
	node: Element,
	nodeId: number
) {
	return node instanceof HTMLElement
		? session.styles.serializeStyle(node.style, `${INLINE_PREFIX}${nodeId}`)
		: undefined;
}

function getSheet(session: CDPSession, styleSheetId: string): CSSStyleSheet {
	const sheet = session.styles.get(styleSheetId);
	if (!sheet) {
		throw new Error("StyleSheet not found");
	}
	return sheet;
}

// MARK: enable/disable
let onResize: (() => void) | undefined = undefined;

bindCDP("CSS.enable", async function () {
	for (const styleSheet of document.styleSheets) {
		if (styleSheet instanceof CSSStyleSheet) {
			this.styles.register(styleSheet);
		}
	}
	if (onResize) window.removeEventListener("resize", onResize);
	onResize = () => this.emit("CSS.mediaQueryResultChanged", undefined);
	window.addEventListener("resize", onResize);

	this.enableDomain("CSS");
});

bindCDP("CSS.disable", async function () {
	if (onResize) window.removeEventListener("resize", onResize);
	onResize = undefined;
	this.disableDomain("CSS");
});

// MARK: reading styles
bindCDP("CSS.getComputedStyleForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	return {
		computedStyle: this.styles.serializeComputedStyle(getComputedStyle(node)),
	};
});

bindCDP("CSS.getInlineStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	return {
		inlineStyle: serializeInlineStyle(this, node, nodeId) ?? null,
		attributesStyle: null,
	};
});

bindCDP("CSS.getMatchedStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);

	const matchedCSSRules = this.styles.getMatchingRulesForNode(node);
	const inlineStyle = serializeInlineStyle(this, node, nodeId);

	// collect inherited styles
	const inheritedStyles: Protocol.CSS.InheritedStyleEntry[] = [];
	let parent = node.parentElement;
	while (parent) {
		const parentMatchedRules = this.styles.getMatchingRulesForNode(parent);
		const parentNodeId = this.nodes.getOrCreateId(parent);
		inheritedStyles.push({
			inlineStyle: serializeInlineStyle(this, parent, parentNodeId),
			matchedCSSRules: parentMatchedRules,
		});

		parent = parent.parentElement;
	}

	// collect animation keyframes
	const applicableAnimations = getComputedStyle(node)
		.animationName.split(",")
		.map((name) => name.trim());
	const cssKeyframesRules: Protocol.CSS.CSSKeyframesRule[] = [];
	for (const sheet of document.styleSheets) {
		for (const cssRule of sheet.cssRules) {
			// skip keyframes that are not applicable to this node
			if (
				!(cssRule instanceof CSSKeyframesRule) ||
				!applicableAnimations.includes(cssRule.name)
			) {
				continue;
			}
			const id = this.styles.getOrCreateId(sheet);
			const keyframes: Protocol.CSS.CSSKeyframeRule[] = [...cssRule.cssRules]
				.filter((r): r is CSSKeyframeRule => r instanceof CSSKeyframeRule)
				.map((r) => ({
					styleSheetId: id,
					keyText: { text: r.keyText },
					style: this.styles.serializeStyle(r.style, id),
					origin: "regular",
				}));
			cssKeyframesRules.push({
				animationName: { text: cssRule.name },
				keyframes,
			});
		}
	}

	return {
		inlineStyle,
		matchedCSSRules,
		attributesStyle: null,
		pseudoElements: [],
		inherited: inheritedStyles,
		cssKeyframesRules,
	};
});

// MARK: editing
bindCDP("CSS.setStyleTexts", async function (params) {
	const { edits } = params;
	const results: Protocol.CSS.SetStyleTextsResponse = { styles: [] };

	for (const edit of edits) {
		const { styleSheetId, range, text } = edit;

		if (styleSheetId.startsWith(INLINE_PREFIX)) {
			const nodeId = parseInt(styleSheetId.slice(INLINE_PREFIX.length), 10);
			const node = this.nodes.resolveElement(nodeId);

			if (node instanceof HTMLElement) {
				node.style.cssText = text;

				const updatedStyle = this.styles.parseStyleDeclarations(text, 0, 0);
				updatedStyle.styleSheetId = styleSheetId;
				results.styles.push(updatedStyle);
			}
		} else {
			const sheet = this.styles.get(styleSheetId);
			if (sheet) {
				const rule = sheet.cssRules[range.startLine] || sheet.cssRules[0];

				if (rule instanceof CSSStyleRule) {
					rule.style.cssText = text;

					if (sheet.ownerNode instanceof HTMLStyleElement) {
						this.styles.setText(
							styleSheetId,
							sheet.ownerNode.textContent || ""
						);
					}

					const updatedStyle = this.styles.parseStyleDeclarations(
						text,
						range.startLine,
						range.startColumn
					);
					updatedStyle.styleSheetId = styleSheetId;
					results.styles.push(updatedStyle);
				}
			}
		}
	}
	return results;
});

bindCDP("CSS.addRule", async function (params) {
	const { styleSheetId, ruleText } = params;
	const sheet = getSheet(this, styleSheetId);

	const index = sheet.insertRule(ruleText, sheet.cssRules.length);
	const newRule = sheet.cssRules[index] as CSSStyleRule;

	const selectors = newRule.selectorText.split(",").map((s) => s.trim());

	return {
		rule: {
			styleSheetId,
			selectorList: {
				selectors: selectors.map((s) => ({ text: s })),
				text: newRule.selectorText,
			},
			style: this.styles.serializeStyle(newRule.style, styleSheetId),
			origin: "regular",
		},
	};
});

bindCDP("CSS.getStyleSheetText", async function (params) {
	const { styleSheetId } = params;
	const sheet = getSheet(this, styleSheetId);

	// Reconstruct raw CSS text from rules
	const text = [...sheet.cssRules].map((r) => r.cssText).join("\n");

	return { text };
});

bindCDP("CSS.createStyleSheet", async function (params) {
	const el = document.createElement("style");
	document.head.appendChild(el);

	const id = this.styles.register(el.sheet as CSSStyleSheet);

	return { id };
});

// MARK: unimplemented
// bindCDP("CSS.collectClassNames", async function (params) {
// 	const sheet = this.styles.get(params.styleSheetId);
// 	const classNames = new Set<string>();

// 	if (sheet) {
// 		for (const rule of sheet.cssRules) {
// 			if (rule instanceof CSSStyleRule) {
// 				const matches = rule.selectorText.matchAll(/\.([\w-]+)/g);
// 				for (const match of matches) {
// 					if (match[1]) {
// 						classNames.add(match[1]);
// 					}
// 				}
// 			}
// 		}
// 	}

// 	return { classNames: Array.from(classNames) };
// });
