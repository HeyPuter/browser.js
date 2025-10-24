import { css, type ComponentContext } from "dreamland/core";
import type { Tab } from "../../Tab";
import { setContextMenu } from "../Menu";
import { iconClose, iconDuplicate, iconNew, iconRefresh } from "../../icons";
import { browser, forceScreenshot } from "../../Browser";
import { Icon } from "../Icon";
import { TabTooltip } from "./TabTooltip";

export function DragTab(
	this: { tooltipActive: boolean },
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
			on:mousedown={(e: MouseEvent) => {
				props.mousedown(e);
				e.stopPropagation();
				e.preventDefault();
			}}
			on:contextmenu={() => {
				if (hoverTimeout) clearTimeout(hoverTimeout);
				this.tooltipActive = false;
			}}
			on:transitionend={() => {
				cx.root.style.transition = "";
				cx.root.style.zIndex = "0";
				props.transitionend();
			}}
			on:mouseenter={() => {
				forceScreenshot(props.tab);
				if (hoverTimeout) clearTimeout(hoverTimeout);
				hoverTimeout = window.setTimeout(() => {
					this.tooltipActive = true;
				}, 500);
			}}
			on:mouseleave={() => {
				if (hoverTimeout) clearTimeout(hoverTimeout);
				this.tooltipActive = false;
			}}
		>
			<TabTooltip tab={props.tab} active={this.tooltipActive} />
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
	}

	.main {
		height: 28px;
		min-width: 0;
		width: 100%;

		color: var(--fg);

		border-radius: 4px;
		padding: 7px 8px;

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
		height: 100%;
		vertical-align: center;
		line-height: 1.2;
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
		color: var(--fg);

		padding: 0;
		margin-left: 8px;
	}
	.close:hover {
		background: var(--bg20);
		border-radius: 0.5em;
	}

	.main:not(.active):hover {
		transition: background 250ms;

		background: var(--bg01);
		color: var(--fg);
	}

	.main.active {
		background: var(--bg02);
		color: var(--fg);
	}

	.belowcontainer {
		position: relative;
	}
	.below {
		position: absolute;
		bottom: -6px;
		height: 6px;
		width: 100%;

		background: var(--bg);
	}

	.below::before,
	.below::after {
		content: "";
		position: absolute;
		bottom: 0;

		width: var(--tab-active-border-width);
		height: var(--tab-active-border-radius);

		background: var(--bg01);
	}
`;
