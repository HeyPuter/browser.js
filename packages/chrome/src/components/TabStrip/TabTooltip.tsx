import { css } from "dreamland/core";
import type { Tab } from "../../Tab";
import { isFirefox } from "../../utils";

export function TabTooltip(props: { active: boolean; tab: Tab }) {
	return (
		<div class:active={use(props.active)}>
			<div class="text">
				<span class="title">{use(props.tab.title)}</span>
				<span class="hostname">{use(props.tab.url.hostname)}</span>
			</div>
			{isFirefox ? (
				<div
					style={use`background-image: -moz-element(#tab${props.tab.id})`}
					class="img"
				></div>
			) : (
				use(props.tab.screenshot).andThen(
					<img src={use(props.tab.screenshot)} class="img" />
				)
			)}
		</div>
	);
}
TabTooltip.style = css`
	:scope {
		position: absolute;
		top: 2.25em;
		left: 0;
		z-index: 1000;
		background: var(--bg);
		border: 1px solid var(--bg20);
		border-radius: 4px;
		width: 20em;
		gap: 0.25em;
		flex-direction: column;
		display: none;
		border-radius: 4px;
	}
	:scope.active {
		display: flex;
	}
	.text {
		padding: 0.5em;
		display: flex;
		flex-direction: column;
		gap: 0.1em;
	}
	.title {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.hostname {
		font-size: 12px;
	}

	.img {
		width: 100%;
		aspect-ratio: var(--viewport-ratio);
		background-size: cover;
	}
`;
