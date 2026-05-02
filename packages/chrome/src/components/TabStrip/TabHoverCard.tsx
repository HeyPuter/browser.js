import { createDelegate, css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { isFirefox } from "../../util";

export function TabHoverCard(
	this: FC<{
		hoveredTab: Tab | null;
	}>
) {
	return (
		<div id="hovercard">
			{use(this.hoveredTab).and((tab) => (
				<span>{tab.title}</span>
			))}
		</div>
	);
}

TabHoverCard.style = css`
	:global(*) > :scope {
		position: absolute;
		position-anchor: --hovered-tab;
		position-visibility: anchors-valid;
		top: anchor(bottom);
		left: anchor(left);
	}
	:scope {
		background: var(--toolbar_bg);
	}
`;
