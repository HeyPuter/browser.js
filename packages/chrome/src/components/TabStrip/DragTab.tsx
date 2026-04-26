import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { setContextMenu } from "@components/Menu";
import { iconClose, iconDuplicate, iconNew, iconRefresh } from "../../icons";
import { Icon } from "@components/Icon";
import {
	activeTooltips,
	fastClose,
	TabTooltip,
} from "@components/TabStrip/TabTooltip";
import { tabsService } from "../..";

export function DragTab(
	this: FC<
		{
			active: boolean;
			id: string;
			tab: Tab;
			mousedown: (e: MouseEvent) => void;
			destroy: () => void;
			transitionend: () => void;
		},
		{
			tooltipActive: boolean;
			tooltipAnimate: boolean;
		}
	>
) {
	this.tooltipActive = false;
	this.cx.mount = () => {
		setContextMenu(this.root, [
			{
				label: "New tab to the right",
				icon: iconNew,
				action: () => {
					tabsService.newTabRight(this.tab);
				},
			},
			{
				label: "Reload",
				icon: iconRefresh,
				action: () => {
					this.tab.frame.reload();
				},
			},
			{
				label: "Duplicate",
				icon: iconDuplicate,
				action: () => {
					tabsService.newTabRight(this.tab, this.tab.url);
				},
			},
			{
				label: "Close Tab",
				icon: iconClose,
				action: () => {
					this.destroy();
				},
			},
		]);

		// Open-tab animation: expands the tab container from width 0 to full computed width.
		this.root.animate(
			[
				{
					width: "0px",
				},
				{},
			],
			{
				duration: 200,
				easing: "cubic-bezier(.25,.5,0,1.15)",
				fill: "forwards",
			}
		);
	};

	let hoverTimeout: number;

	return (
		<div
			style="z-index: 0;"
			class="tab"
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
				on:contextmenu={() => {
					if (hoverTimeout) clearTimeout(hoverTimeout);
					this.tooltipActive = false;
				}}
				on:mouseenter={() => {
					if (hoverTimeout) clearTimeout(hoverTimeout);

					if (activeTooltips > 0) {
						// skip delay
						fastClose();
						this.tooltipAnimate = true;
						this.tooltipActive = true;
					} else {
						hoverTimeout = window.setTimeout(() => {
							this.tooltipActive = true;
						}, 500);
					}
				}}
				on:mouseleave={(e: MouseEvent) => {
					if (hoverTimeout) clearTimeout(hoverTimeout);
					// really short timeout to allow transitioning from close button to main tab region.
					// see the listeners on the close button for details
					hoverTimeout = setTimeout(() => {
						this.tooltipActive = false;
					}, 2);
				}}
			></div>
			<TabTooltip
				tab={this.tab}
				active={use(this.tooltipActive)}
				animate={use(this.tooltipAnimate)}
			/>
			<div class="dragroot" style="position: unset;">
				<div class={use(this.active).map((x) => `main ${x ? "active" : ""}`)}>
					{use(this.tab.icon).and(<img src={use(this.tab.icon)} />)}
					<span>{use(this.tab.title)}</span>
					<button
						class="close"
						on:click={(e: MouseEvent) => {
							e.stopPropagation();
							this.destroy();
						}}
						on:contextmenu={(e: MouseEvent) => {
							e.preventDefault();
							e.stopPropagation();
						}}
						// part that prevents the tooltip from closing when hovering over the close button
						on:mouseleave={(e: MouseEvent) => {
							e.stopPropagation();
							// set a really short timeout to prevent the tooltip from closing immediately.
							// if going from close button to main tab region, it should stay open for a bit. see line 124
							hoverTimeout = window.setTimeout(() => {
								this.tooltipActive = false;
							}, 2);
						}}
						on:mouseenter={(e: MouseEvent) => {
							e.stopPropagation();
							if (hoverTimeout) clearTimeout(hoverTimeout);
							// set tooltip to active.
							//
							// unfortunately whenever you hover over the close button before
							// the 500ms timeout (L117) it'll just instantly show the tooltip
							//
							// it's really icky but its the best thing i could think of that
							// doesn't bring back the "stuck tooltips" bug
							this.tooltipActive = true;
						}}
					>
						<Icon icon={iconClose} />
					</button>
				</div>
			</div>
		</div>
	);
}
DragTab.style = css`
	:scope {
		display: inline-block;
		user-select: none;
		position: absolute;

		--tab-active-border-width: 11px;
		--tab-active-border-radius: 10px;
		--tab-active-border-radius-neg: -10px;

		--tab-selected-textcolor: var(--toolbar_text);
	}

	.hover-area {
		position: absolute;
		top: -3px;
		left: -3px;
		right: -3px;
		bottom: -3px;
		pointer-events: auto;
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
	.main img {
		width: 16px;
		height: 16px;
	}
	.main span {
		flex: 1;
		font-size: 12px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
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
