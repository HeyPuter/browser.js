import Protocol from "devtools-protocol";
import { bindCDP, CDPSession } from "..";
import { StyleManager } from "../stylemanager";

bindCDP("CSS.enable", async function () {
	for (const styleSheet of document.styleSheets) {
		if (styleSheet instanceof CSSStyleSheet) {
			this.styles.register(styleSheet);
		}
	}
	window.addEventListener("resize", () => {
		if (this.isDomainEnabled("CSS")) {
			this.emit("CSS.mediaQueryResultChanged", undefined);
		}
	});

	this.enableDomain("CSS");
});

bindCDP("CSS.disable", async function () {
	this.disableDomain("CSS");
});

bindCDP("CSS.getComputedStyleForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (node instanceof Element) {
		return {
			computedStyle: this.styles.serializeComputedStyle(getComputedStyle(node)),
		};
	} else {
		return {
			computedStyle: [],
		};
	}
});

bindCDP("CSS.getInlineStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);
	if (node instanceof HTMLElement) {
		return {
			inlineStyle: this.styles.serializeStyle(node.style, `inline-${nodeId}`),
			attributesStyle: null,
		};
	} else {
		return {
			inlineStyle: null,
			attributesStyle: null,
		};
	}
});

bindCDP("CSS.getMatchedStylesForNode", async function (params) {
	const { nodeId } = params;
	const node = this.nodes.resolveElement(nodeId);

	if (!node || !(node instanceof Element)) {
		return {
			inlineStyle: null,
			matchedCSSRules: [],
			attributesStyle: null,
			pseudoElements: [],
			inherited: [],
			cssKeyframesRules: [],
		};
	}

	const matchedCSSRules = this.styles.getMatchingRulesForNode(node);
	const inlineStyle =
		node instanceof HTMLElement
			? this.styles.serializeStyle(node.style, `inline-${nodeId}`)
			: undefined;

	// collect inherited styles
	const inheritedStyles: Protocol.CSS.InheritedStyleEntry[] = [];
	let parent = node.parentElement;
	while (parent) {
		const parentMatchedRules = this.styles.getMatchingRulesForNode(parent);
		const parentNodeId = this.nodes.getOrCreateId(parent);
		const parentInlineStyle =
			parent instanceof HTMLElement
				? this.styles.serializeStyle(parent.style, `inline-${parentNodeId}`)
				: undefined;
		inheritedStyles.push({
			inlineStyle: parentInlineStyle,
			matchedCSSRules: parentMatchedRules,
		});

		parent = parent.parentElement;
	}

	// collect animation keyframes
	const applicableAnimations = getComputedStyle(node)
		.animationName.split(",")
		.map((name) => name.trim());
	const cssKeyframesRules: Protocol.CSS.CSSKeyframesRule[] = [];
	for (const rule of document.styleSheets) {
		if (rule instanceof CSSStyleSheet) {
			for (const cssRule of rule.cssRules) {
				if (cssRule instanceof CSSKeyframesRule) {
					if (!applicableAnimations.includes(cssRule.name)) {
						continue; // skip keyframes that are not applicable to this node
					}
					const id = this.styles.getOrCreateId(rule);
					const keyframes: Protocol.CSS.CSSKeyframeRule[] = Array.from(
						cssRule.cssRules
					)
						.filter((r) => r instanceof CSSKeyframeRule)
						.map((r) => ({
							styleSheetId: id,
							keyText: { text: (r as CSSKeyframeRule).keyText },
							style: this.styles.serializeStyle(r.style, id),
							origin: "regular",
						}));
					cssKeyframesRules.push({
						animationName: { text: cssRule.name },
						keyframes: keyframes,
					});
				}
			}
		}
	}

	return {
		inlineStyle: inlineStyle,
		matchedCSSRules: matchedCSSRules,
		attributesStyle: null,
		pseudoElements: [],
		inherited: inheritedStyles,
		cssKeyframesRules: cssKeyframesRules,
	};
});

function applyStyleEdit(
	css: string,
	range: Protocol.CSS.SourceRange,
	text: string
): string {
	const lines = css?.split("\n") ?? [];
	lines.splice(
		range.startLine,
		Math.max(0, range.endLine - range.startLine + 1),
		...text.split("\n")
	);
	return lines.filter((line) => line.trim()).join("\n");
}

// editing
bindCDP("CSS.setStyleTexts", async function (params) {
	const { edits } = params;
	const results: Protocol.CSS.SetStyleTextsResponse = { styles: [] };

	for (const edit of edits) {
		const { styleSheetId, range, text } = edit;

		if (styleSheetId.startsWith("inline-")) {
			const nodeId = parseInt(styleSheetId.split("-")[1], 10);
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
	const sheet = this.styles.get(styleSheetId);

	if (!sheet) {
		throw new Error("StyleSheet not found");
	}

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
	const sheet = this.styles.get(styleSheetId);

	if (!sheet) {
		throw new Error("StyleSheet not found");
	}

	// Reconstruct raw CSS text from rules
	const text = Array.from(sheet.cssRules)
		.map((r) => r.cssText)
		.join("\n");

	return { text };
});

bindCDP("CSS.createStyleSheet", async function (params) {
	const el = document.createElement("style");
	document.head.appendChild(el);

	const sheet = el.sheet as CSSStyleSheet;
	const id = this.styles.register(sheet);

	return { id };
});

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
