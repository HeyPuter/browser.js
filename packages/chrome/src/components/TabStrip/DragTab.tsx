import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { setContextMenu } from "@components/Menu";
import {
	iconClose,
	iconDuplicate,
	iconNew,
	iconRefresh,
	iconTrash,
	iconCloseCircle,
	iconGlobe,
} from "../../icons";
import { Icon } from "@components/Icon";
import { tabsService } from "../..";

type VisualTab = {
	tab: Tab;
	root: HTMLElement;
	closing: boolean;
};

export function createMiddleClickCloseHandler(
	getVisualTabs: () => VisualTab[],
	destroyTab: (tab: Tab) => void
) {
	let repeatState: { slot: number; bounds: DOMRect } | null = null;
	let resetTimeout: number | null = null;

	const resetRepeatState = () => {
		repeatState = null;
		if (resetTimeout !== null) clearTimeout(resetTimeout);
		resetTimeout = null;
	};

	return (e: MouseEvent) => {
		if (e.button !== 1) return;

		const visualTabs = getVisualTabs();
		const liveTabs = visualTabs.filter((tab) => !tab.closing);
		if (!(e.target instanceof Node)) return;

		const clickedTab = visualTabs.find(
			(tab) => tab.root === e.target || tab.root.contains(e.target as Node)
		);

		let slot =
			clickedTab && !clickedTab.closing ? liveTabs.indexOf(clickedTab) : -1;
		let bounds: DOMRect | null = null;
		const stateBounds: DOMRect | undefined = repeatState?.bounds;

		if (slot !== -1 && clickedTab) {
			bounds = clickedTab.root
				.querySelector(".hover-area")!
				.getBoundingClientRect();
		} else if (
			stateBounds &&
			stateBounds.left <= e.clientX &&
			stateBounds.right >= e.clientX &&
			stateBounds.top <= e.clientY &&
			stateBounds.bottom >= e.clientY
		) {
			slot = repeatState!.slot;
			bounds = stateBounds;
		}

		const tabToClose = liveTabs[slot];
		if (!tabToClose || !bounds) {
			resetRepeatState();
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		repeatState = { slot, bounds };
		if (resetTimeout !== null) clearTimeout(resetTimeout);
		resetTimeout = setTimeout(resetRepeatState, 800);
		destroyTab(tabToClose.tab);
	};
}

function buildTabContextMenu(tab: Tab, destroy: () => void) {
	return [
		{
			label: "New tab to the right",
			icon: iconNew,
			action: () => {
				tabsService.newTabRight(tab);
			},
		},
		{
			label: "Reload",
			icon: iconRefresh,
			action: () => {
				tab.frame.reload();
			},
		},
		{
			label: "Duplicate",
			icon: iconDuplicate,
			action: () => {
				tabsService.newTabRight(tab, tab.url);
			},
		},
		{
			label: tab.pinned ? "Unpin" : "Pin",
			action: () => {
				if (tab.pinned) {
					tabsService.unpinTab(tab);
				} else {
					tabsService.pinTab(tab);
				}
			},
		},
		{
			label: "Close",
			icon: iconClose,
			action: () => {
				destroy();
			},
		},
		{
			label: "Close other tabs",
			icon: iconTrash,
			action: () => {
				tabsService.closeOtherTabs(tab);
			},
		},
		{
			label: "Close tabs to the right",
			icon: iconCloseCircle,
			action: () => {
				tabsService.closeTabsToRight(tab);
			},
		},
	];
}

export function DragTab(
	this: FC<
		{
			active: boolean;
			id: string;
			tab: Tab;
			orientation?: "horizontal" | "vertical";
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

	const orientation = this.orientation ?? "horizontal";
	const isVertical = orientation === "vertical";

	const updateContextMenu = () => {
		setContextMenu(this.root, buildTabContextMenu(this.tab, this.destroy));
	};

	use(this.tab.pinned).listen(updateContextMenu);

	this.cx.mount = () => {
		updateContextMenu();

		if (isVertical) {
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
		} else {
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
		}
	};

	let hoverTimeout: number;

	return (
		<div
			style="z-index: 1;"
			class={use(this.tooltipHovered).map((hovered) =>
				hovered ? `tab ${orientation} hovered` : `tab ${orientation}`
			)}
			data-id={this.id}
			on:transitionend={(e: TransitionEvent) => {
				if (e.target !== this.root || e.propertyName !== "transform") return;
				// Clears programmatically assigned move transition/z-index after tab translate animation ends.
				this.root.style.transition = "";
				this.root.style.zIndex = "1";
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
					{use(this.tab.icon)
						.and(
							<div class="favicon">
								<img
									alt="Tab icon"
									width="16"
									height="16"
									src={use(this.tab.icon)}
								/>
							</div>
						)
						.or(
							use(this.orientation)
								.zip(use(this.tab.pinned))
								.map(([o, p]) => o === "vertical" || p)
								.and(
									<div class="favicon">
										<Icon class="favicon-placeholder" icon={iconGlobe} />
									</div>
								)
						)}
					{use(this.tab.pinned).or(
						<>
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
								on:mouseenter={(e: MouseEvent) => {
									this.mouseover();
									e.stopPropagation();
								}}
							>
								<Icon icon={iconClose} />
							</button>
						</>
					)}
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

	:scope.vertical {
		display: block;
	}

	:global(*) > :scope:has(:hover) .hover-area {
		anchor-name: --hovered-tab;
	}

	.hover-area {
		position: absolute;
		inset: calc(-1 * var(--space-xs));
		pointer-events: auto;
	}

	.main {
		height: var(--tab-height);
		min-width: 0;
		width: 100%;

		color: var(--tab_background_text);

		border-radius: var(--radius-md);
		padding: var(--space-md);

		background: var(--background_tab_inactive);

		display: flex;
		align-items: center;
		gap: var(--space-sm);
	}
	.favicon {
		width: 16px;
		height: 16px;
		color: var(--text-50);
	}
	.main span {
		flex: 1;
		font-size: 0.75rem;
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

/**
 * A single pinned-tab cell for the vertical/hybrid sidebar's Arc-style pin grid
 * (see {@link VerticalPinList} in Sidebar.tsx). Renders the tab favicon in a
 * square tile; left-click activates the tab, middle-click closes it, and
 * right-click opens the shared {@link buildTabContextMenu}. Horizontal layouts
 * render their pins inline via {@link DragTab}, so this tile is sidebar-only.
 */
export function VerticalPinTile(
	this: FC<{
		tab: Tab;
		active: boolean;
		dragStart: (e: MouseEvent) => void;
		destroy: () => void;
	}>
) {
	this.cx.mount = () => {
		setContextMenu(this.root, buildTabContextMenu(this.tab, this.destroy));
	};

	return (
		<div
			class="pin"
			class:active={use(this.active)}
			data-id={this.tab.id}
			title={use(this.tab.title, this.tab.url).map(
				([title, url]) => title || url.hostname || ""
			)}
			on:mousedown={(e: MouseEvent) => {
				if (e.button !== 0) return;
				e.preventDefault();
				this.dragStart(e);
			}}
			on:auxclick={(e: MouseEvent) => {
				if (e.button !== 1) return;
				e.preventDefault();
				e.stopPropagation();
				this.destroy();
			}}
		>
			<div class="pin-favicon">
				{use(this.tab.icon)
					.and(<img alt="" width="16" height="16" src={use(this.tab.icon)} />)
					.or(<Icon class="favicon-placeholder" icon={iconGlobe} />)}
			</div>
		</div>
	);
}

VerticalPinTile.style = css`
	:scope {
		border-radius: var(--radius-md);
		background: var(--background_tab_inactive);
		color: var(--tab_background_text);

		display: flex;
		align-items: center;
		justify-content: center;

		cursor: pointer;
		user-select: none;
		position: relative;
		transition: background 150ms;
		height: var(--omnibar-height);
		outline: 1px solid var(--popup_border);
		outline-offset: -1px;
	}

	:scope:hover:not(.active) {
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	:scope.active {
		background: var(--toolbar);
		color: var(--toolbar_text);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);

		outline: 1px solid var(--popup_border);
	}

	/* Lifted tile while being dragged in the pin grid. Grid items honor z-index
	   without an explicit position, so it floats above its siblings. */
	:scope.dragging {
		z-index: 20;
		pointer-events: none;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
		outline: 1px solid var(--tab_line);
	}

	.pin-favicon {
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-50);
	}

	.pin-favicon img {
		width: 16px;
		height: 16px;
		object-fit: contain;
	}

	.pin-favicon .favicon-placeholder {
		width: 18px;
		height: 18px;
	}
`;
