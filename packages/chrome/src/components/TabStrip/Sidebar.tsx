import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import {
	createMiddleClickCloseHandler,
	DragTab,
	VerticalPinTile,
} from "./DragTab";
import { TabHoverCard } from "@components/TabStrip/TabHoverCard";
import { Icon } from "@components/Icon";
import { iconAdd } from "../../icons";
import { requestUnfocusFrames } from "@components/Shell";
import { settingsService, tabsService } from "../..";
import { easing } from "../../easing";

type VisualTab = {
	tab: Tab;
	root: HTMLElement;
	dragoffset: number;
	dragpos: number;
	startdragpos: number;
	closing: boolean;
	height: number;
	pos: number;
};

export function Sidebar(
	this: FC<
		{
			layout: "horizontal" | "bottom" | "hybrid" | "vertical" | "compact";
			justify: "left" | "right";
			tabs: Tab[];
			activetab: Tab;
			destroyTab: (tab: Tab) => void;
			addTab: () => void;
			sidebarWidth: number;
			setSidebarWidth: (width: number) => void;
			topContent?: any;
			bottomContent?: any;
		},
		{
			visualtabs: VisualTab[];
			container: HTMLElement;
			topEl: HTMLElement;
			bottomEl: HTMLElement;
			afterEl: HTMLElement;
			currentlydragging: string | null;
			currentlyHovered: Tab | null;
		}
	>
) {
	this.currentlydragging = null;
	this.currentlyHovered = this.tabs[0] ?? null;
	this.visualtabs = [];

	const [lock, unlock] = requestUnfocusFrames();
	const SIDEBAR_MIN_WIDTH = this.layout === "vertical" ? 190 : 48;
	const SIDEBAR_MAX_WIDTH = 520;

	const TAB_TRANSITION = () => `225ms ${easing("--ease-tab-move")}`;
	const TAB_STAGGER_STEP = 18;
	const TAB_STAGGER_MAX = 144;

	let transitioningTabs = 0;

	const getRemAbsoluteSize = (size: number) =>
		size * parseFloat(getComputedStyle(document.documentElement).fontSize);

	const getRootHeight = () => {
		const style = getComputedStyle(this.container);
		const padding =
			parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		const border =
			parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
		const top = this.topEl.offsetHeight;
		const bottom = this.bottomEl.offsetHeight;
		const after = this.afterEl.offsetHeight;

		return (
			this.container.offsetHeight - padding - border - top - bottom - after
		);
	};

	const getRootWidth = () => {
		const style = getComputedStyle(this.container);
		const padding =
			parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
		const border =
			parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);

		return this.container.offsetWidth - padding - border;
	};

	const getAbsoluteStart = () => {
		const rect = this.container.getBoundingClientRect();
		const style = getComputedStyle(this.container);

		return (
			rect.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)
		);
	};

	const getLayoutStart = () => {
		return this.topEl.offsetHeight;
	};
	const getTabPadding = () => {
		return getRemAbsoluteSize(
			parseFloat(
				getComputedStyle(document.documentElement).getPropertyValue(
					"--space-xxs"
				)
			)
		);
	};

	const getTabHeight = () => {
		// Measure the inner `.main` row rather than the tab root. When a tab
		// opens (notably a freshly-unpinned tab, which `unpinTab` inserts at the
		// front of the list so it becomes `firstVisible`), its `.dragroot`
		// wrapper is height-animated from 0 with `overflow: hidden`, so the root
		// briefly reports a near-zero height. `.main` keeps its `--tab-height`
		// throughout that animation, so measuring it avoids reading a transient
		// height and collapsing the spacing of every tab.
		const firstVisible = this.visualtabs.find((tab) => !tab.closing);
		if (firstVisible) {
			const main = firstVisible.root.querySelector(
				".main"
			) as HTMLElement | null;
			const measured = main?.offsetHeight ?? 0;
			if (measured > 0) return measured;
		}

		const cssHeight = getRemAbsoluteSize(
			parseFloat(
				getComputedStyle(document.documentElement).getPropertyValue(
					"--space-xs"
				)
			)
		);
		return Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 36;
	};

	const reorderTabs = () => {
		this.visualtabs.sort((a, b) => {
			const aCenter = a.pos + a.height / 2;

			const bTop = b.pos;
			const bBottom = b.pos + b.height;
			const bCenter =
				Math.abs(aCenter - bTop) > Math.abs(aCenter - bBottom) ? bBottom : bTop;

			return aCenter - bCenter;
		});
	};

	const layoutTabs = (transition: boolean) => {
		const height = getTabHeight();
		const width = getRootWidth();
		const tabPadding = getTabPadding();
		console.log(height, width, tabPadding);

		reorderTabs();

		let dragpos = -1;
		let currpos = getLayoutStart();
		let staggerIndex = 0;
		let movedTabs = 0;
		for (const tab of this.visualtabs) {
			if (tab.closing) {
				const tabPos = tab.dragpos != -1 ? tab.dragpos : tab.pos;
				tab.root.style.transform = `translateY(${tabPos}px)`;
				tab.pos = tabPos;
				continue;
			}

			tab.root.style.width = width + "px";
			tab.root.style.height = height + "px";

			const tabPos = tab.dragpos != -1 ? tab.dragpos : currpos;
			tab.root.style.transform = `translateY(${tabPos}px)`;
			if (transition && tab.dragpos == -1 && tab.pos != tabPos) {
				const delay = Math.min(
					staggerIndex * TAB_STAGGER_STEP,
					TAB_STAGGER_MAX
				);
				tab.root.style.transition = `transform ${TAB_TRANSITION()} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}
			dragpos = Math.max(dragpos, tab.dragpos + height + tabPadding);

			tab.pos = tabPos;
			tab.height = height;
			currpos += height + tabPadding;
			staggerIndex++;
		}

		const afterpos = Math.max(dragpos, currpos);
		if (transition) {
			const afterDelay = Math.min(
				Math.max(staggerIndex, movedTabs > 0 ? staggerIndex : 1) *
					TAB_STAGGER_STEP,
				TAB_STAGGER_MAX
			);
			this.afterEl.style.transition = `transform ${TAB_TRANSITION()} ${afterDelay}ms`;
		}
		this.afterEl.style.transform = `translateY(${afterpos}px)`;
	};

	const getMaxDragPos = () => {
		return getLayoutStart() + getRootHeight();
	};

	const calcDragPos = (e: MouseEvent, tab: VisualTab) => {
		const maxPos = getMaxDragPos() - tab.root.offsetHeight;

		const pos = e.clientY - tab.dragoffset - getAbsoluteStart();

		tab.dragpos = Math.min(Math.max(getLayoutStart(), pos), maxPos);
		layoutTabs(true);
	};

	const mouseMoveHandler = (e: MouseEvent) => {
		if (this.currentlydragging === null) return;
		calcDragPos(
			e,
			this.visualtabs.find((tab) => tab.tab.id === this.currentlydragging)!
		);
	};

	const mouseUpHandler = () => {
		if (this.currentlydragging === null) return;
		const tab = this.visualtabs.find(
			(tab) => tab.tab.id === this.currentlydragging
		)!;
		const dragroot = tab.root.querySelector(".dragroot") as HTMLElement;

		dragroot.style.width = "";
		dragroot.style.position = "unset";
		tab.dragoffset = -1;
		tab.dragpos = -1;
		layoutTabs(true);
		if (!tab.root.style.transition) {
			tab.root.style.zIndex = "0";
		}
		this.currentlydragging = null;
		unlock();
		window.removeEventListener("mousemove", mouseMoveHandler);
		window.removeEventListener("mouseup", mouseUpHandler);
	};

	const mouseDown = (e: MouseEvent, tab: VisualTab) => {
		if (e.button != 0) return;
		this.currentlydragging = tab.tab.id;
		lock();

		const rect = tab.root.getBoundingClientRect();
		tab.root.style.transition = "";
		tab.root.style.zIndex = "100";
		const dragroot = tab.root.querySelector(".dragroot") as HTMLElement;
		dragroot.style.width = rect.width + "px";
		dragroot.style.position = "absolute";
		tab.dragoffset = e.clientY - rect.top;
		tab.startdragpos = rect.top;

		if (tab.dragoffset < 0) throw new Error("dragoffset must be positive");

		calcDragPos(e, tab);

		if (this.activetab != tab.tab) {
			this.activetab = tab.tab;
		}

		window.addEventListener("mousemove", mouseMoveHandler);
		window.addEventListener("mouseup", mouseUpHandler);
	};

	const clampSidebarWidth = (width: number) => {
		const viewportMax = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - 140);
		return Math.min(
			Math.max(Math.round(width), SIDEBAR_MIN_WIDTH),
			Math.min(SIDEBAR_MAX_WIDTH, viewportMax)
		);
	};

	const sidebarResizeMouseDown = (e: MouseEvent) => {
		if (e.button !== 0) return;

		lock();
		document.body.style.cursor = "ew-resize";

		const mouseMoveHandler = (moveEvent: MouseEvent) => {
			const { left } = this.container.getBoundingClientRect();
			if (this.justify === "right") {
				this.setSidebarWidth(
					clampSidebarWidth(
						left + this.container.offsetWidth - moveEvent.clientX
					)
				);
			} else {
				this.setSidebarWidth(clampSidebarWidth(moveEvent.clientX - left));
			}
		};

		const mouseUpHandler = () => {
			unlock();
			document.body.style.cursor = "";
			window.removeEventListener("mousemove", mouseMoveHandler);
			window.removeEventListener("mouseup", mouseUpHandler);
		};

		window.addEventListener("mousemove", mouseMoveHandler);
		window.addEventListener("mouseup", mouseUpHandler);

		e.preventDefault();
		e.stopPropagation();
	};

	const transitionend = () => {
		transitioningTabs = Math.max(transitioningTabs - 1, 0);
		if (transitioningTabs == 0) {
			this.afterEl.style.transition = "";
		}
	};

	use(this.tabs).listen(() => {
		let newvisualtabs: VisualTab[] = [];

		// Both sidebar layouts render pinned tabs in the Arc-style grid
		// (VerticalPinList) instead of the linear list, so skip them here.
		const usesPinnedGrid =
			this.layout === "vertical" || this.layout === "hybrid";
		for (let index = 0; index < this.tabs.length; index++) {
			let tab = this.tabs[index];

			if (tab.pinned && usesPinnedGrid) continue;

			let visualtab = this.visualtabs.find((t) => t.tab === tab);

			if (!visualtab) {
				let dt = (
					<DragTab
						id={tab.id}
						tab={tab}
						orientation="vertical"
						active={use(this.activetab).map((x) => x === tab)}
						mousedown={(e) => mouseDown(e, visualtab!)}
						mouseover={() => {
							this.currentlyHovered = tab;
						}}
						destroy={() => {
							this.destroyTab(tab);
						}}
						transitionend={transitionend}
					/>
				);
				const tabHeight = getTabHeight();
				const previousTab = newvisualtabs[newvisualtabs.length - 1];
				const nextTab = this.visualtabs.find(
					(candidate) =>
						!candidate.closing && !newvisualtabs.includes(candidate)
				);
				const initialPos = previousTab
					? previousTab.pos + previousTab.height + getTabPadding()
					: (nextTab?.pos ?? getLayoutStart());

				// Absolute-positioned tabs need their slot before the mount animation runs.
				dt.style.transform = `translateY(${initialPos}px)`;
				visualtab = {
					tab,
					root: dt,
					dragoffset: -1,
					dragpos: -1,
					startdragpos: -1,
					closing: false,
					height: tabHeight,
					pos: initialPos,
				};
			}

			newvisualtabs.push(visualtab);
		}

		for (let vtab of this.visualtabs) {
			if (!newvisualtabs.includes(vtab)) {
				let indexof = this.visualtabs.indexOf(vtab);
				vtab.closing = true;
				newvisualtabs.splice(indexof, 0, vtab);
				let anim = vtab.root.animate(
					[
						{},
						{
							height: "0px",
						},
					],
					{
						duration: 150,
						easing: easing("--ease-tab-close"),
						fill: "forwards",
					}
				);
				anim.addEventListener(
					"finish",
					() => {
						this.visualtabs = this.visualtabs.filter((t) => t !== vtab);
						layoutTabs(false);
					},
					{ once: true }
				);
			}
		}

		this.visualtabs = newvisualtabs;
		setTimeout(() => layoutTabs(true), 10);
	});

	// force sync when density profile changes
	use(settingsService.settings.uiProfile).listen(() => {
		this.tabs = [...this.tabs];
		layoutTabs(true);
	});

	this.cx.mount = () => {
		if (
			this.sidebarWidth < SIDEBAR_MIN_WIDTH ||
			this.sidebarWidth > SIDEBAR_MAX_WIDTH
		) {
			this.setSidebarWidth(
				Math.min(
					Math.max(this.sidebarWidth, SIDEBAR_MIN_WIDTH),
					Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 140)
				)
			);
		}

		requestAnimationFrame(() => layoutTabs(false));
		let resizeObserver: ResizeObserver | null = new ResizeObserver(() => {
			if (!this.root.isConnected) {
				resizeObserver?.disconnect();
				resizeObserver = null;
				return;
			}
			layoutTabs(false);
		});
		resizeObserver.observe(this.container);
		resizeObserver.observe(this.topEl);
		resizeObserver.observe(this.bottomEl);
		resizeObserver.observe(this.afterEl);

		// Force an initial sync for newly-mounted strips after mode switches.
		this.tabs = [...this.tabs];
	};

	return (
		<div
			id="tabstrip"
			this={use(this.container)}
			on:auxclick={createMiddleClickCloseHandler(
				() => this.visualtabs,
				(tab) => this.destroyTab(tab)
			)}
			style={use(this.sidebarWidth).map(
				(width) =>
					`--sidebar-width: ${width}px; min-width: ${width}px; flex: 0 0 ${width}px;`
			)}
		>
			<div class="extra top" this={use(this.topEl)}>
				{this.topContent}
			</div>
			{use(this.visualtabs).mapEach((tab) => tab.root)}
			<div class="extra after" this={use(this.afterEl)}>
				<button class="new-tab" on:click={this.addTab}>
					<Icon icon={iconAdd} />
				</button>
			</div>
			<div class="extra bottom" this={use(this.bottomEl)}>
				{this.bottomContent}
			</div>
			<div
				class="sidebar-resizer"
				on:mousedown={(e: MouseEvent) => sidebarResizeMouseDown(e)}
			></div>
			<TabHoverCard hoveredTab={use(this.currentlyHovered)} />
		</div>
	);
}

Sidebar.style = css`
	:scope {
		--sidebar-width: 250px;
		display: block;
		position: relative;
		padding: var(--space-md);
		background: var(--frame);
		height: 100%;
		z-index: 2;
		border-right: 1px solid var(--text-15);
		width: var(--sidebar-width);
	}

	:global(.sidebar-right *) > :scope {
		border-right: none;
		border-left: 1px solid var(--text-15);
	}

	.extra {
		left: 0;
		width: 100%;
		position: absolute;
	}

	.top,
	.bottom,
	.after {
		display: flex;
	}

	.top,
	.bottom {
		padding-inline: var(--space-md);
		padding-top: var(--space-md);
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		gap: var(--space-md);
	}

	.top {
		top: 0;
	}

	.top:empty,
	.bottom:empty {
		padding: 0;
	}

	.bottom {
		bottom: 0;
	}

	.after {
		align-items: center;
		justify-content: center;
	}

	.new-tab {
		border: none;
		color: var(--toolbar_text);
		border-radius: var(--radius-md);
		height: var(--tab-height);
		width: calc(100% - calc(var(--space-md) * 2));
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: var(--space-xs);
	}

	.new-tab:is(:hover, :active, :focus) {
		background: var(--toolbar);
	}

	.sidebar-resizer {
		position: absolute;
		top: 0;
		right: -4px;
		width: 8px;
		height: 100%;
		cursor: ew-resize;
		z-index: 3;
	}

	:global(.sidebar-right *) > :scope .sidebar-resizer {
		left: -4px;
		right: auto;
	}
`;

/**
 * Arc-style grid of pinned tabs for the vertical and hybrid sidebars. Renders
 * each pinned tab as a square favicon tile ({@link VerticalPinTile}) in a
 * responsive grid. Clicking a tile activates that tab.
 *
 * Rendered by App (between the omnibar and bookmarks in the vertical header, and
 * at the top of the hybrid sidebar) rather than by {@link Sidebar} itself, so it
 * can sit inside the vertical header between those two pieces. The horizontal
 * tab strip has its own pin rendering, so this list is sidebar-only.
 */
export function VerticalPinList(
	this: FC<{
		tabs: Tab[];
		activetab: Tab;
		destroyTab: (tab: Tab) => void;
	}>
) {
	// Cache tile elements per-tab so reordering/repinning doesn't recreate DOM
	// nodes (which would reset their context menus and favicon listeners).
	const tiles = new Map<Tab, HTMLElement>();

	const getTile = (tab: Tab) => {
		let cached = tiles.get(tab);
		if (cached) return cached;

		const tile = (
			<VerticalPinTile
				tab={tab}
				active={use(this.activetab).map((active) => active === tab)}
				dragStart={(e: MouseEvent) => beginPointerTracking(tab, e)}
				destroy={() => this.destroyTab(tab)}
			/>
		) as HTMLElement;

		tiles.set(tab, tile);
		return tile;
	};

	// --- Drag-to-reorder for pinned tabs -----------------------------------
	//
	// The pin grid is a 2D auto-fit grid, so we drag with manual pointer events
	// (matching the rest of the tab UI, which avoids the native HTML5 DnD API).
	// During a drag the underlying `tabsService.tabs` is left untouched and the
	// reflow is done purely with CSS transforms computed from the tiles' initial
	// layout rects; the real reorder is committed once on drop. This keeps the
	// drag self-contained (no reactive churn in the other tab strips) and lets us
	// position siblings deterministically without re-measuring after each move.

	const [lock, unlock] = requestUnfocusFrames();
	const DRAG_THRESHOLD = 4;
	const REFLOW_TRANSITION = () =>
		`transform 200ms ${easing("--ease-tab-move")}`;

	type DragState = {
		tab: Tab;
		tile: HTMLElement;
		pointerStart: { x: number; y: number };
		grabOffset: { x: number; y: number };
		order: Tab[];
		rects: DOMRect[];
		fromIndex: number;
		targetIndex: number;
		started: boolean;
	};
	let drag: DragState | null = null;

	const beginPointerTracking = (tab: Tab, e: MouseEvent) => {
		// Activate on press (also makes a plain click select the tab, matching the
		// tab strips). The actual drag only starts once the pointer moves past the
		// threshold.
		this.activetab = tab;

		drag = {
			tab,
			tile: getTile(tab),
			pointerStart: { x: e.clientX, y: e.clientY },
			grabOffset: { x: 0, y: 0 },
			order: [],
			rects: [],
			fromIndex: -1,
			targetIndex: -1,
			started: false,
		};

		window.addEventListener("mousemove", onPointerMove);
		window.addEventListener("mouseup", onPointerUp);
	};

	const startDrag = () => {
		if (!drag) return;
		const pinned = this.tabs.filter((t) => t.pinned);
		drag.order = pinned;
		drag.rects = pinned.map((t) => getTile(t).getBoundingClientRect());
		drag.fromIndex = pinned.indexOf(drag.tab);
		drag.targetIndex = drag.fromIndex;

		const startRect = drag.rects[drag.fromIndex];
		drag.grabOffset = {
			x: drag.pointerStart.x - startRect.left,
			y: drag.pointerStart.y - startRect.top,
		};

		drag.started = true;
		lock();
		document.body.style.cursor = "grabbing";
		drag.tile.classList.add("dragging");
		drag.tile.style.transition = "transform 0s";
	};

	// Nearest tile-center wins; reliable for a small, uniform icon grid.
	const computeTargetIndex = (e: MouseEvent) => {
		if (!drag) return 0;
		let best = 0;
		let bestDist = Infinity;
		for (let i = 0; i < drag.rects.length; i++) {
			const r = drag.rects[i];
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const dist = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
			if (dist < bestDist) {
				bestDist = dist;
				best = i;
			}
		}
		return best;
	};

	// Slide every non-dragged tile from its original slot to the slot it would
	// occupy if the dragged tab were dropped at `targetIndex`.
	const applyReflow = () => {
		if (!drag) return;
		const visual = drag.order.filter((t) => t !== drag!.tab);
		visual.splice(drag.targetIndex, 0, drag.tab);

		for (let slot = 0; slot < visual.length; slot++) {
			const tab = visual[slot];
			if (tab === drag.tab) continue;
			const el = getTile(tab);
			const fromRect = drag.rects[drag.order.indexOf(tab)];
			const toRect = drag.rects[slot];
			const dx = toRect.left - fromRect.left;
			const dy = toRect.top - fromRect.top;
			el.style.transition = REFLOW_TRANSITION();
			el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : "";
		}
	};

	const followCursor = (e: MouseEvent) => {
		if (!drag) return;
		const base = drag.rects[drag.fromIndex];
		const tx = e.clientX - drag.grabOffset.x - base.left;
		const ty = e.clientY - drag.grabOffset.y - base.top;
		drag.tile.style.transform = `translate(${tx}px, ${ty}px)`;
	};

	const onPointerMove = (e: MouseEvent) => {
		if (!drag) return;
		if (!drag.started) {
			const dist = Math.hypot(
				e.clientX - drag.pointerStart.x,
				e.clientY - drag.pointerStart.y
			);
			if (dist < DRAG_THRESHOLD) return;
			startDrag();
		}

		const target = computeTargetIndex(e);
		if (target !== drag.targetIndex) {
			drag.targetIndex = target;
			applyReflow();
		}
		followCursor(e);
	};

	const onPointerUp = () => {
		window.removeEventListener("mousemove", onPointerMove);
		window.removeEventListener("mouseup", onPointerUp);
		if (!drag) return;

		if (drag.started) {
			const { tab, fromIndex, targetIndex } = drag;
			// Clear all inline drag styling, then commit the reorder in the same
			// synchronous tick so the reactive re-render lands without a flash.
			for (const t of drag.order) {
				const el = getTile(t);
				el.style.transition = "";
				el.style.transform = "";
			}
			drag.tile.classList.remove("dragging");
			document.body.style.cursor = "";
			unlock();

			if (targetIndex !== fromIndex) {
				const pinned = this.tabs.filter((t) => t.pinned);
				const from = pinned.indexOf(tab);
				const to = Math.max(0, Math.min(targetIndex, pinned.length - 1));
				// Guard against the dragged tab having been unpinned/closed mid-drag
				// (from === -1) and against a no-op move (from === to). Either way we
				// still fall through to `drag = null` below so drag state is cleared.
				if (from !== -1 && from !== to) {
					pinned.splice(from, 1);
					pinned.splice(to, 0, tab);
					tabsService.tabs = [...pinned, ...this.tabs.filter((t) => !t.pinned)];
					tabsService.markDirty();
				}
			}
		}

		drag = null;
	};

	// Drop cached tiles for tabs that are no longer pinned or were closed.
	use(this.tabs).listen((tabs) => {
		const pinned = new Set(tabs.filter((tab) => tab.pinned));
		for (const tab of [...tiles.keys()]) {
			if (!pinned.has(tab)) tiles.delete(tab);
		}
	});

	return (
		<div
			class="pinned-tabs"
			class:empty={use(this.tabs).map((tabs) => !tabs.some((t) => t.pinned))}
		>
			{use(this.tabs)
				.map((tabs) => tabs.filter((tab) => tab.pinned))
				.mapEach((tab) => getTile(tab))}
		</div>
	);
}

VerticalPinList.style = css`
	:scope {
		display: grid;
		grid-template-columns: repeat(
			auto-fit,
			minmax(calc(var(--omnibar-height) + var(--space-xs)), 1fr)
		);
		gap: var(--space-sm);
	}

	:scope.empty {
		display: none;
	}
`;
