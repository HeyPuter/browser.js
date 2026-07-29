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
				<>
					<div class="text">
						<span class="title">{tab.title}</span>
						<span class="hostname">{tab.url.hostname}</span>
					</div>
					{isFirefox ? (
						<div
							style={use`background-image: -moz-element(#tab${tab.id})`}
							alt="Tab screenshot"
							class="img"
						></div>
					) : (
						use(tab.screenshot).and(
							<img alt="Tab screenshot" src={tab.screenshot} class="img" />
						)
					)}
				</>
			))}
		</div>
	);
}

TabHoverCard.style = css`
	:global(*) > :scope {
		position: absolute;
		position-anchor: --hovered-tab;
		position-visibility: anchors-valid;
		top: calc(anchor(bottom) + 2px);
		left: anchor(left);
		/* transitions and some other styles are defined in ./TabStrip.tsx */
	}
	:global(.vertical-tabs *) > :scope {
		left: anchor(right);
		top: calc(anchor(top) + 2px);
	}
	:global(body.sidebar-right.vertical-tabs *) > :scope {
		left: auto;
		right: anchor(left);
	}
	:scope {
		pointer-events: none;
		z-index: 1000;
		background: var(--popup);
		border: 1px solid var(--popup_border);
		border-radius: var(--radius-md);
		width: 18em;
		gap: var(--space-xs);
		flex-direction: column;
		opacity: 1;
		border-radius: var(--radius-md);
	}
	.text {
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}
	.title {
		overflow: clip visible;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 0.9em;
		font-weight: 500;
	}
	.hostname {
		font-size: 0.7em;
		color: var(--text-60);
	}

	.img {
		width: 100%;
		aspect-ratio: var(--viewport-ratio);
		background-size: cover;
	}
`;
