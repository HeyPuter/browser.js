import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { iconClose, iconGlobe } from "../../icons";
import { Icon } from "@components/Icon";
export function VerticalDragTab(
	this: FC<
		{
			active: boolean;
			id: string;
			tab: Tab;
			mousedown: (e: MouseEvent) => void;
			mouseover: () => void;
			destroy: () => void;
			transitionend: () => void;
		},
		{
			tooltipActive: boolean;
			tooltipAnimate: boolean;
			tooltipHovered: boolean;
		}
	>
) {
	this.tooltipActive = false;
	this.tooltipAnimate = false;
	this.tooltipHovered = false;
	this.cx.mount = () => {
		// Animate inner content so absolute-positioned root layout is unaffected.
		requestAnimationFrame(() => {
			const dragroot = this.root.querySelector(
				".dragroot"
			) as HTMLElement | null;
			const main = this.root.querySelector(".main") as HTMLElement | null;
			if (!dragroot) return;

			const cssHeight = parseFloat(
				getComputedStyle(document.documentElement)
					.getPropertyValue("--tab-height")
					.trim()
			);
			const targetHeight =
				main?.offsetHeight || dragroot.scrollHeight || cssHeight || 36;

			dragroot.style.height = "0px";
			const anim = dragroot.animate(
				[
					{
						height: "0px",
					},
					{
						height: `${targetHeight}px`,
					},
				],
				{
					duration: 200,
					easing: "cubic-bezier(.25,.5,0,1.15)",
					fill: "forwards",
				}
			);

			anim.addEventListener(
				"finish",
				() => {
					dragroot.style.height = "";
				},
				{ once: true }
			);
		});
	};

	return (
		<div
			style="z-index: 0;"
			class={use(this.tooltipHovered).map((hovered) =>
				hovered ? "tab hovered" : "tab"
			)}
			data-id={this.id}
			on:transitionend={() => {
				// Clears programmatically assigned move transition/z-index after tab translate animation ends.
				this.root.style.transition = "";
				this.root.style.zIndex = "0";
				this.transitionend();
			}}
		>
			<div
				class="hover-area"
				on:mousedown={(e: MouseEvent) => {
					this.mousedown(e);
					e.stopPropagation();
					e.preventDefault();
				}}
				on:auxclick={(e: MouseEvent) => {
					if (e.button === 1) {
						this.destroy();
					}
				}}
				on:mouseenter={() => {
					this.tooltipHovered = true;
					this.mouseover();
				}}
				on:mouseleave={() => {
					this.tooltipHovered = false;
				}}
			></div>
			<div class="dragroot" style="position: unset;">
				<div class={use(this.active).map((x) => (x ? "main active" : "main"))}>
					<div class="favicon">
						{use(this.tab.icon)
							.and(
								<img
									alt="Tab icon"
									width="16"
									height="16"
									src={use(this.tab.icon)}
								/>
							)
							.or(<Icon class="favicon-placeholder" icon={iconGlobe} />)}
					</div>
					<span>{use(this.tab.title)}</span>
					<button
						class="close"
						on:click={(e: MouseEvent) => {
							e.stopPropagation();
							this.destroy();
						}}
						on:auxclick={(e: MouseEvent) => {
							e.stopPropagation();
							this.destroy();
						}}
						on:contextmenu={(e: MouseEvent) => {
							e.preventDefault();
							e.stopPropagation();
						}}
						on:mouseenter={(e: MouseEvent) => {
							this.mouseover();
							e.stopPropagation();
						}}
					>
						<Icon icon={iconClose} />
					</button>
				</div>
			</div>
		</div>
	);
}

VerticalDragTab.style = css`
	:scope {
		display: block;
		user-select: none;
		position: absolute;
	}

	:global(*) > :scope:has(:hover) .hover-area {
		anchor-name: --hovered-tab;
	}

	.tab {
		display: block;
	}

	.hover-area {
		position: absolute;
		top: -3px;
		left: -3px;
		right: -3px;
		bottom: -3px;
		pointer-events: auto;
	}

	.dragroot {
		overflow: hidden;
	}

	.main {
		height: var(--tab-height);
		min-width: 0;
		width: 100%;

		color: var(--tab_background_text);

		border-radius: var(--radius);
		padding: 7px 8px;

		background: var(--background_tab_inactive);

		display: flex;
		align-items: center;
		gap: 8px;
	}
	.favicon {
		width: 16px;
		height: 16px;
		color: var(--text-50);
	}
	.main span {
		flex: 1;
		font-size: 12px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-box-trim: trim-both;
		line-height: var(--tab-height);
	}
	.main .close > * {
		width: 14px;
		height: 14px;
	}
	.close {
		outline: none;
		border: none;
		background: none;
		cursor: pointer;

		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--tab_text);

		padding: 0;
		margin-left: 8px;
		position: relative;
	}
	.close:hover::before {
		background: color-mix(in srgb, currentColor 17%, transparent);
		position: absolute;
		content: "";
		width: 21px;
		height: 21px;
		top: -4px;
		left: -4px;
		border-radius: 3px;
	}

	:scope:has(.hover-area:hover) .main:not(.active),
	:scope:has(.close:hover) .main:not(.active) {
		transition: background 250ms;
		background-color: color-mix(in srgb, currentColor 7%, transparent);
		/*background: var(--background_tab);*/
		/*color: var(-);*/
	}

	.main.active {
		background: var(--toolbar);
		color: var(--tab-selected-textcolor);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);

		outline: 1px solid var(--popup_border);
		outline-offset: -1px;
	}

	.belowcontainer {
		position: relative;
	}
	.below {
		position: absolute;
		bottom: -6px;
		height: 6px;
		width: 100%;

		background: var(--toolbar);
	}

	.below::before,
	.below::after {
		content: "";
		position: absolute;
		bottom: 0;

		width: var(--tab-active-border-width);
		height: var(--tab-active-border-radius);

		background: var(--toolbar);
	}
`;
