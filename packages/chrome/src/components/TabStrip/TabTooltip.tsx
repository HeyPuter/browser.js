import { createDelegate, css, type ComponentContext } from "dreamland/core";
import type { Tab } from "../../Tab";
import { isFirefox } from "../../utils";

export let activeTooltips = 0;
export let lastX;

export const fastClose = createDelegate<void>();

export function TabTooltip(
	props: {
		active: boolean;
		animate: boolean;
		tab: Tab;
	},
	cx: ComponentContext
) {
	let wasActive = props.active;

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
			let animations = cx.root.getAnimations();
			for (let anim of animations) {
				anim.finish();
			}
		}
	});

	use(props.active).listen((active) => {
		if (active && !wasActive) {
			wasActive = true;
			activeTooltips++;

			let x = cx.root.getBoundingClientRect().left;

			if (props.animate) {
				let shift = lastX - x;
				cx.root.animate([hidden, visible], {
					duration: 0,
					fill: "forwards",
				});
				cx.root.animate(
					[
						{ transform: `translateX(${shift}px)` },
						{ transform: "translateX(0px)" },
					],
					{
						duration: 300,
						easing: "ease-out",
					}
				);
				props.animate = false;
			} else {
				cx.root.animate([hidden, visible], {
					duration,
					fill: "forwards",
				});
			}
			lastX = x;
		} else if (!active && wasActive) {
			wasActive = false;
			isClosing = true;
			cx.root.animate([visible, hidden], {
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
		pointer-events: none;
		position: absolute;
		top: calc(var(--tab-height) + 0.25em);
		left: 0;
		z-index: 1000;
		background: var(--popup);
		border: 1px solid var(--popup_border);
		border-radius: 4px;
		width: 17em;
		gap: 0.25em;
		flex-direction: column;
		opacity: 0;
		border-radius: 4px;
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
