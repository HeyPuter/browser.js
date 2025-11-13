import { css, type ComponentContext } from "dreamland/core";
import type { Tab } from "../../Tab";
import { setContextMenu } from "../Menu";
import { iconClose, iconDuplicate, iconNew, iconRefresh } from "../../icons";
import { browser, forceScreenshot } from "../../Browser";
import { Icon } from "../Icon";
import { activeTooltips, fastClose, TabTooltip } from "./TabTooltip";

export function DragTab(
	this: {
		tooltipActive: boolean;
		tooltipAnimate: boolean;
	},
	props: {
		active: boolean;
		id: number;
		tab: Tab;
		mousedown: (e: MouseEvent) => void;
		destroy: () => void;
		transitionend: () => void;
	},
	cx: ComponentContext
) {
	this.tooltipActive = false;
	cx.mount = () => {
		setContextMenu(cx.root, [
			{
				label: "New tab to the right",
				icon: iconNew,
				action: () => {
					browser.newTabRight(props.tab);
				},
			},
			{
				label: "Reload",
				icon: iconRefresh,
				action: () => {
					props.tab.frame.reload();
				},
			},
			{
				label: "Duplicate",
				icon: iconDuplicate,
				action: () => {
					browser.newTabRight(props.tab, props.tab.url);
				},
			},
			{
				label: "Close Tab",
				icon: iconClose,
				action: () => {
					props.destroy();
				},
			},
		]);

		cx.root.animate(
			[
				{
					width: "0px",
				},
				{},
			],
			{
				duration: 100,
				fill: "forwards",
			}
		);
	};

	let hoverTimeout: number;

	return (
		<div
			style="z-index: 0;"
			class="tab"
			data-id={props.id}
			on:transitionend={() => {
				cx.root.style.transition = "";
				cx.root.style.zIndex = "0";
				props.transitionend();
			}}
		>
			<div
				class="hover-area"
				on:mousedown={(e: MouseEvent) => {
					props.mousedown(e);
					e.stopPropagation();
					e.preventDefault();
				}}
				on:contextmenu={() => {
					if (hoverTimeout) clearTimeout(hoverTimeout);
					this.tooltipActive = false;
				}}
				on:mouseenter={() => {
					forceScreenshot(props.tab);
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
					const relatedTarget = e.relatedTarget as Node | null;
					if (relatedTarget && cx.root.contains(relatedTarget)) {
						// don't dismiss if hovering over the close button, even though that takes focus away from hover-area
						return;
					}
					if (hoverTimeout) clearTimeout(hoverTimeout);
					this.tooltipActive = false;
				}}
			></div>
			<TabTooltip
				tab={props.tab}
				active={use(this.tooltipActive)}
				animate={use(this.tooltipAnimate)}
			/>
			<div
				class="dragroot"
				style="position: unset;"
				on:auxclick={(e: MouseEvent) => {
					if (e.button === 1) {
						props.destroy();
					}
				}}
			>
				<div class={use(props.active).map((x) => `main ${x ? "active" : ""}`)}>
					{use(props.tab.icon).andThen(<img src={use(props.tab.icon)} />)}
					<span>{use(props.tab.title)}</span>
					<button
						class="close"
						on:click={(e: MouseEvent) => {
							e.stopPropagation();
							props.destroy();
						}}
						on:contextmenu={(e: MouseEvent) => {
							e.preventDefault();
							e.stopPropagation();
						}}
					>
						<Icon icon={iconClose} />
					</button>
				</div>
				{/* <div class="belowcontainer">
						{use(s.active).andThen(<div class="below"></div>)}
					</div> */}
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

		border-radius: 4px;
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
