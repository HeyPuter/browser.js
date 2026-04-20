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

	const duration = 150;
	const visible = {
		opacity: "1",
		transform: "scale(100%)",
	};
	const hidden = {
		opacity: "0",
		transform: "scale(95%)",
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
				this.root.animate([hidden, visible], {
					duration: 0,
					fill: "forwards",
				});
				this.root.animate(
					[
						{ transform: `translateX(${shift}px)` },
						{ transform: "translateX(0px)" },
					],
					{
						duration: 300,
						easing: "ease-out",
					}
				);
				this.animate = false;
			} else {
				this.root.animate([hidden, visible], {
					duration,
					fill: "forwards",
				});
			}
			lastX = x;
		} else if (!active && wasActive) {
			wasActive = false;
			isClosing = true;
			this.root.animate([visible, hidden], {
				duration,
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
		width: 17em;
		gap: 0.25em;
		flex-direction: column;
		opacity: 0;
		border-radius: var(--radius);
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
