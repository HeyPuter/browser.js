import { createDelegate, css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { isFirefox } from "../../util";

export let activeTooltips = 0;
export let lastX;

export const fastClose = createDelegate<void>();

export function TabTooltip(
	this: FC<{
		active: boolean;
		animate: boolean;
		tab: Tab;
	}>
) {
	let wasActive = this.active;

	const duration = 125;
	const curve = "cubic-bezier(.35,.15,0,1.5)";
	const visible = {
		opacity: "1",
		transform: "scaleX(100%) scaleY(100%)",
	};
	const hidden = {
		opacity: "0",
		transform: "scaleX(95%) scaleY(87%)",
	};

	let isClosing = false;
	fastClose.listen(() => {
		if (isClosing) {
			// instantly finish any current animations
			let animations = this.root.getAnimations();
			for (let anim of animations) {
				anim.finish();
			}
		}
	});

	use(this.active).listen((active) => {
		if (active && !wasActive) {
			wasActive = true;
			activeTooltips++;

			let x = this.root.getBoundingClientRect().left;

			if (this.animate) {
				let shift = lastX - x;
				// Instantly applies the hidden->visible visual state (opacity + scale) before slide alignment.
				this.root.animate([hidden, visible], {
					duration: 0,
					fill: "forwards",
				});
				// Reposition animation between adjacent tab tooltips: translateX from previous tooltip X to current X.
				this.root.animate(
					[
						{ transform: `translateX(${shift}px)` },
						{ transform: "translateX(0px)" },
					],
					{
						duration: 150,
						easing: "cubic-bezier(.45,.25,0,1.09)",
					}
				);
				this.animate = false;
			} else {
				// Standard tooltip enter animation: fades in and scales from 95% -> 100%.
				this.root.animate([hidden, visible], {
					duration,
					easing: curve,
					fill: "forwards",
				});
			}
			lastX = x;
		} else if (!active && wasActive) {
			wasActive = false;
			isClosing = true;
			// Tooltip exit animation: fades out and scales down from 100% -> 95%.
			this.root.animate([visible, hidden], {
				duration,
				easing: curve,
				fill: "forwards",
			}).onfinish = () => {
				isClosing = false;
				activeTooltips--;
			};
		}
	});
	return (
		<div>
			<div class="text">
				<span class="title">{use(this.tab.title)}</span>
				<span class="hostname">{use(this.tab.url.hostname)}</span>
			</div>
			{isFirefox ? (
				<div
					style={use`background-image: -moz-element(#tab${this.tab.id})`}
					class="img"
				></div>
			) : (
				use(this.tab.screenshot).and(
					<img src={use(this.tab.screenshot)} class="img" />
				)
			)}
		</div>
	);
}
TabTooltip.style = css`
	:scope {
		pointer-events: none;
		position: absolute;
		top: calc(var(--tab-height) + var(--tab-padding));
		left: -1px;
		z-index: 1000;
		background: var(--popup);
		border: 1px solid var(--popup_border);
		border-radius: var(--radius);
		width: 18em;
		gap: 0.25em;
		flex-direction: column;
		opacity: 0;
		border-radius: var(--radius);
	}
	.text {
		padding: 0.75em 0.67em;
		display: flex;
		flex-direction: column;
		gap: 0.25em;
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
