import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { DragTab } from "./DragTab";
import { TabHoverCard } from "@components/TabStrip/TabHoverCard";
import { Icon } from "@components/Icon";
import { iconAdd } from "../../icons";
import { requestUnfocusFrames } from "@components/Shell";
import { tabsService } from "../..";

type VisualTab = {
	tab: Tab;
	root: HTMLElement;
	dragoffsetx: number;
	dragoffsety: number;
	dragx: number;
	dragy: number;
	startdragx: number;
	startdragy: number;
	closing: boolean;
	width: number;
	height: number;
	x: number;
	y: number;
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
			topContent?: any | ((pinnedTabs: any) => any);
			bottomContent?: any;
		},
		{
			visualtabs: VisualTab[];
			container: HTMLElement;
			topEl: HTMLElement;
			pinnedEl: HTMLElement;
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

	const TAB_PADDING = 6;
	const OPEN_TAB_TRANSITION = "200ms cubic-bezier(.25,.5,0,1.15)";
	const TAB_TRANSITION = "225ms cubic-bezier(.43,.52,0,1.15)";
	const TAB_STAGGER_STEP = 18;
	const TAB_STAGGER_MAX = 144;
	const PIN_GAP = 6;
	const PIN_MIN_WIDTH = 32;
	const PIN_MAX_WIDTH = 56;
	const PIN_MIN_HEIGHT = 32;
	const PIN_MAX_HEIGHT = 44;

	let transitioningTabs = 0;
	let openingTabs = new Set<VisualTab>();

	const getVisibleTabs = () => {
		return this.visualtabs.filter((tab) => !tab.closing);
	};

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

	const getTabHeight = () => {
		const firstVisible = getVisibleTabs().find((tab) => !tab.tab.pinned);
		if (firstVisible) {
			const dragroot = firstVisible.root.querySelector(
				".dragroot"
			) as HTMLElement | null;
			const main = firstVisible.root.querySelector(
				".main"
			) as HTMLElement | null;
			const measured = Math.max(
				main?.offsetHeight ?? 0,
				dragroot?.scrollHeight ?? 0
			);
			if (measured > 0) return measured;
			if (firstVisible.height > 0) return firstVisible.height;
		}

		const cssHeight = parseFloat(
			getComputedStyle(document.documentElement)
				.getPropertyValue("--tab-height")
				.trim()
		);
		return Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 36;
	};

	const getPinnedGridMetrics = (
		count = getVisibleTabs().filter((tab) => tab.tab.pinned).length
	) => {
		const availableWidth =
			this.pinnedEl?.offsetWidth || Math.max(getRootWidth() - 16, 0);
		const maxColumns = Math.min(4, Math.max(1, count));
		let columns = 1;
		for (let candidate = maxColumns; candidate >= 1; candidate--) {
			const minRequiredWidth =
				PIN_MIN_WIDTH * candidate + PIN_GAP * (candidate - 1);
			if (availableWidth >= minRequiredWidth) {
				columns = candidate;
				break;
			}
		}
		const rowWidth = Math.floor(
			(availableWidth - PIN_GAP * (columns - 1)) / columns
		);
		const width = Math.max(
			PIN_MIN_WIDTH,
			Math.min(columns >= 4 ? PIN_MAX_WIDTH : rowWidth, rowWidth)
		);
		const height = Math.min(PIN_MAX_HEIGHT, Math.max(PIN_MIN_HEIGHT, width));
		const gridWidth = width * columns + PIN_GAP * (columns - 1);
		const rows = count === 0 ? 0 : Math.ceil(count / columns);

		return {
			columns,
			gap: PIN_GAP,
			width,
			height,
			offsetX: Math.max(0, Math.floor((availableWidth - gridWidth) / 2)),
			totalHeight: rows === 0 ? 0 : rows * height + (rows - 1) * PIN_GAP,
		};
	};

	const setTabTransform = (tab: VisualTab, x: number, y: number) => {
		tab.root.style.transform = tab.tab.pinned
			? `translate(${x}px, ${y}px)`
			: `translateY(${y}px)`;
	};

	const getPinnedInsertIndex = (
		tab: VisualTab,
		group: VisualTab[],
		metrics = getPinnedGridMetrics(group.length)
	) => {
		const peers = group.filter((peer) => peer !== tab);
		const stepX = metrics.width + metrics.gap;
		const stepY = metrics.height + metrics.gap;
		const centerX = tab.dragx + metrics.width / 2 - metrics.offsetX;
		const centerY = tab.dragy + metrics.height / 2;
		const column = Math.min(
			metrics.columns - 1,
			Math.max(0, Math.floor((centerX + metrics.gap / 2) / stepX))
		);
		const row = Math.max(0, Math.floor((centerY + metrics.gap / 2) / stepY));
		const insertIndex = row * metrics.columns + column;

		return Math.min(peers.length, Math.max(0, insertIndex));
	};

	const getRegularInsertIndex = (
		tab: VisualTab,
		group: VisualTab[],
		height: number,
		start: number
	) => {
		const peers = group.filter((peer) => peer !== tab);
		const centerY = tab.dragy + (tab.height || height) / 2;

		for (const [index, peer] of peers.entries()) {
			const peerY =
				peer.dragy != -1
					? peer.dragy
					: peer.y || start + index * (height + TAB_PADDING);
			const peerMidpoint = peerY + (peer.height || height) / 2;

			if (centerY < peerMidpoint) {
				return index;
			}
		}

		return peers.length;
	};

	const getOrderedGroup = (
		group: VisualTab[],
		metrics: ReturnType<typeof getPinnedGridMetrics>,
		height: number,
		start: number
	) => {
		const draggingTab =
			this.currentlydragging === null
				? null
				: (group.find((tab) => tab.tab.id === this.currentlydragging) ?? null);
		if (!draggingTab) return group;

		const peers = group.filter((tab) => tab !== draggingTab);
		const insertIndex = draggingTab.tab.pinned
			? getPinnedInsertIndex(draggingTab, group, metrics)
			: getRegularInsertIndex(draggingTab, group, height, start);

		peers.splice(insertIndex, 0, draggingTab);
		return peers;
	};

	const getOrderedTabs = (
		metrics: ReturnType<typeof getPinnedGridMetrics>,
		height: number,
		start: number
	) => {
		const visibleTabs = getVisibleTabs();
		const pinnedTabs = visibleTabs.filter((tab) => tab.tab.pinned);
		const regularTabs = visibleTabs.filter((tab) => !tab.tab.pinned);
		const orderedPinnedTabs = getOrderedGroup(
			pinnedTabs,
			metrics,
			height,
			start
		);
		const orderedRegularTabs = getOrderedGroup(
			regularTabs,
			metrics,
			height,
			start
		);

		return {
			pinned: orderedPinnedTabs,
			regular: orderedRegularTabs,
			all: [...orderedPinnedTabs, ...orderedRegularTabs],
		};
	};

	const getStaticOrderedTabs = (visualTabs: VisualTab[]) => {
		const visibleTabs = visualTabs.filter((tab) => !tab.closing);
		return {
			pinned: visibleTabs.filter((tab) => tab.tab.pinned),
			regular: visibleTabs.filter((tab) => !tab.tab.pinned),
		};
	};

	const syncVisualOrder = (orderedVisibleTabs: VisualTab[]) => {
		const nextVisualTabs = [...orderedVisibleTabs];

		for (const [index, visualtab] of this.visualtabs.entries()) {
			if (!visualtab.closing) continue;
			nextVisualTabs.splice(
				Math.min(index, nextVisualTabs.length),
				0,
				visualtab
			);
		}

		const changed =
			nextVisualTabs.length !== this.visualtabs.length ||
			nextVisualTabs.some((tab, index) => this.visualtabs[index] !== tab);
		if (!changed) return;

		this.visualtabs.splice(0, this.visualtabs.length, ...nextVisualTabs);
	};

	const primeNewVisualTabs = (
		visualTabs: VisualTab[],
		newTabs: Set<VisualTab>
	) => {
		if (newTabs.size === 0) return;

		const orderedTabs = getStaticOrderedTabs(visualTabs);
		const pinnedMetrics = getPinnedGridMetrics(orderedTabs.pinned.length);
		const height = getTabHeight();
		const width = getRootWidth();
		const start = getLayoutStart();

		for (const [index, tab] of orderedTabs.pinned.entries()) {
			if (!newTabs.has(tab)) continue;

			const column = index % pinnedMetrics.columns;
			const row = Math.floor(index / pinnedMetrics.columns);
			const x =
				pinnedMetrics.offsetX +
				column * (pinnedMetrics.width + pinnedMetrics.gap);
			const y = row * (pinnedMetrics.height + pinnedMetrics.gap);
			tab.root.style.width = pinnedMetrics.width + "px";
			tab.root.style.height = pinnedMetrics.height + "px";
			setTabTransform(tab, x, y);
			tab.width = pinnedMetrics.width;
			tab.height = pinnedMetrics.height;
			tab.x = x;
			tab.y = y;
		}

		let currpos = start;
		for (const tab of orderedTabs.regular) {
			if (newTabs.has(tab)) {
				tab.root.style.width = width + "px";
				tab.root.style.height = height + "px";
				setTabTransform(tab, 0, currpos);
				tab.width = width;
				tab.height = height;
				tab.x = 0;
				tab.y = currpos;
			}

			currpos += height + TAB_PADDING;
		}
	};

	const layoutTabs = (transition: boolean) => {
		if (!this.pinnedEl) return;

		const pinnedMetrics = getPinnedGridMetrics();
		this.pinnedEl.style.height = `${pinnedMetrics.totalHeight}px`;

		const height = getTabHeight();
		const width = getRootWidth();
		const start = getLayoutStart();
		const orderedTabs = getOrderedTabs(pinnedMetrics, height, start);
		syncVisualOrder(orderedTabs.all);
		const hasOpeningTabs = orderedTabs.all.some((tab) => openingTabs.has(tab));
		const tabTransition = hasOpeningTabs ? OPEN_TAB_TRANSITION : TAB_TRANSITION;

		let staggerIndex = 0;
		let movedTabs = 0;
		for (const [index, tab] of orderedTabs.pinned.entries()) {
			const column = index % pinnedMetrics.columns;
			const row = Math.floor(index / pinnedMetrics.columns);
			const tabX =
				tab.dragx != -1
					? tab.dragx
					: pinnedMetrics.offsetX +
						column * (pinnedMetrics.width + pinnedMetrics.gap);
			const tabY =
				tab.dragy != -1
					? tab.dragy
					: row * (pinnedMetrics.height + pinnedMetrics.gap);

			tab.root.style.width = pinnedMetrics.width + "px";
			tab.root.style.height = pinnedMetrics.height + "px";
			setTabTransform(tab, tabX, tabY);
			if (
				transition &&
				tab.dragx == -1 &&
				tab.dragy == -1 &&
				(tab.x != tabX || tab.y != tabY)
			) {
				const delay = hasOpeningTabs
					? 0
					: Math.min(staggerIndex * TAB_STAGGER_STEP, TAB_STAGGER_MAX);
				tab.root.style.transition = `transform ${tabTransition} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}
			tab.width = pinnedMetrics.width;
			tab.height = pinnedMetrics.height;
			tab.x = tabX;
			tab.y = tabY;
			staggerIndex++;
		}

		let afterpos = start;
		let currpos = start;
		for (const tab of orderedTabs.regular) {
			tab.root.style.width = width + "px";
			tab.root.style.height = height + "px";

			const tabY = tab.dragy != -1 ? tab.dragy : currpos;
			setTabTransform(tab, 0, tabY);
			if (transition && tab.dragy == -1 && (tab.x != 0 || tab.y != tabY)) {
				const delay = hasOpeningTabs
					? 0
					: Math.min(staggerIndex * TAB_STAGGER_STEP, TAB_STAGGER_MAX);
				tab.root.style.transition = `transform ${tabTransition} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}

			tab.width = width;
			tab.height = height;
			tab.x = 0;
			tab.y = tabY;
			afterpos = Math.max(afterpos, tabY + height + TAB_PADDING);
			currpos += height + TAB_PADDING;
			staggerIndex++;
		}

		afterpos = Math.max(afterpos, currpos);
		if (transition) {
			const afterDelay = hasOpeningTabs
				? 0
				: Math.min(
						Math.max(staggerIndex, movedTabs > 0 ? staggerIndex : 1) *
							TAB_STAGGER_STEP,
						TAB_STAGGER_MAX
					);
			this.afterEl.style.transition = `transform ${tabTransition} ${afterDelay}ms`;
		}
		this.afterEl.style.transform = `translateY(${afterpos}px)`;

		for (const tab of this.visualtabs) {
			if (!tab.closing) continue;
			const tabX = tab.dragx != -1 ? tab.dragx : tab.x;
			const tabY = tab.dragy != -1 ? tab.dragy : tab.y;
			tab.root.style.width = tab.width + "px";
			tab.root.style.height = tab.height + "px";
			setTabTransform(tab, tabX, tabY);
			tab.x = tabX;
			tab.y = tabY;
		}
	};

	const calcDragPos = (e: MouseEvent, tab: VisualTab) => {
		if (tab.tab.pinned) {
			const metrics = getPinnedGridMetrics();
			this.pinnedEl.style.height = `${metrics.totalHeight}px`;
			const rect = this.pinnedEl.getBoundingClientRect();
			const posX = e.clientX - tab.dragoffsetx - rect.left;
			const posY = e.clientY - tab.dragoffsety - rect.top;
			const maxX = Math.max(0, rect.width - metrics.width);
			const maxY = Math.max(0, metrics.totalHeight - metrics.height);

			tab.dragx = Math.min(Math.max(0, posX), maxX);
			tab.dragy = Math.min(Math.max(0, posY), maxY);
		} else {
			const tabHeight = tab.root.offsetHeight || getTabHeight();
			const maxPos = getLayoutStart() + getRootHeight() - tabHeight;
			const posY = e.clientY - tab.dragoffsety - getAbsoluteStart();

			tab.dragx = 0;
			tab.dragy = Math.min(Math.max(getLayoutStart(), posY), maxPos);
		}

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

		const pinnedMetrics = getPinnedGridMetrics();
		this.pinnedEl.style.height = `${pinnedMetrics.totalHeight}px`;
		const orderedTabs = getOrderedTabs(
			pinnedMetrics,
			getTabHeight(),
			getLayoutStart()
		);
		syncVisualOrder(orderedTabs.all);

		const tab = this.visualtabs.find(
			(tab) => tab.tab.id === this.currentlydragging
		)!;
		const nextOrder = orderedTabs.all.map((visualtab) => visualtab.tab);
		const dragroot = tab.root.querySelector(".dragroot") as HTMLElement;

		this.currentlydragging = null;
		dragroot.style.width = "";
		dragroot.style.height = "";
		dragroot.style.position = "unset";
		tab.dragoffsetx = -1;
		tab.dragoffsety = -1;
		tab.dragx = -1;
		tab.dragy = -1;
		layoutTabs(true);
		if (!tab.root.style.transition) {
			tab.root.style.zIndex = "1";
		}
		tabsService.reorderTabs(nextOrder);
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
		dragroot.style.height = rect.height + "px";
		dragroot.style.position = "absolute";
		tab.dragoffsetx = e.clientX - rect.left;
		tab.dragoffsety = e.clientY - rect.top;
		tab.startdragx = rect.left;
		tab.startdragy = rect.top;

		if (tab.dragoffsetx < 0 || tab.dragoffsety < 0) {
			throw new Error("drag offset must be positive");
		}

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
		const createdVisualTabs = new Set<VisualTab>();

		for (let index = 0; index < this.tabs.length; index++) {
			let tab = this.tabs[index];

			let visualtab = this.visualtabs.find((t) => t.tab === tab);

			if (!visualtab) {
				use(tab.pinned)
					.constrain(this)
					.listen(() => {
						this.visualtabs = [...this.visualtabs];
						requestAnimationFrame(() => layoutTabs(false));
					});

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
				visualtab = {
					tab,
					root: dt,
					dragoffsetx: -1,
					dragoffsety: -1,
					dragx: -1,
					dragy: -1,
					startdragx: -1,
					startdragy: -1,
					closing: false,
					width: 0,
					height: 0,
					x: 0,
					y: tab.pinned
						? 0
						: getLayoutStart() + index * (getTabHeight() + TAB_PADDING),
				};
				createdVisualTabs.add(visualtab);
			}

			newvisualtabs.push(visualtab);
		}

		primeNewVisualTabs(newvisualtabs, createdVisualTabs);
		if (createdVisualTabs.size > 0) {
			createdVisualTabs.forEach((tab) => openingTabs.add(tab));
			window.setTimeout(() => {
				createdVisualTabs.forEach((tab) => openingTabs.delete(tab));
			}, 220);
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
						easing: "cubic-bezier(.29,.44,.3,.94)",
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
		resizeObserver.observe(this.pinnedEl);
		resizeObserver.observe(this.bottomEl);
		resizeObserver.observe(this.afterEl);

		// Force an initial sync for newly-mounted strips after mode switches.
		this.tabs = [...this.tabs];
	};

	const pinnedTabs = (
		<div class="pins" this={use(this.pinnedEl)}>
			{use(this.visualtabs)
				.map((t) => t.filter((f) => f.tab.pinned))
				.mapEach((tab) => tab.root)}
		</div>
	);

	return (
		<div
			id="tabstrip"
			this={use(this.container)}
			style={use(this.sidebarWidth).map(
				(width) =>
					`--sidebar-width: ${width}px; min-width: ${width}px; flex: 0 0 ${width}px;`
			)}
		>
			<div class="extra top" this={use(this.topEl)}>
				{typeof this.topContent === "function" ? (
					this.topContent(pinnedTabs)
				) : (
					<>
						{this.topContent}
						{pinnedTabs}
					</>
				)}
			</div>
			{use(this.visualtabs)
				.map((t) => t.filter((f) => !f.tab.pinned))
				.mapEach((tab) => tab.root)}
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
		padding: var(--tab-padding) 8px;
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
		z-index: 0;
	}

	.top,
	.bottom,
	.after {
		display: flex;
	}

	.top,
	.bottom {
		padding: 0 8px;
		padding-top: 8px;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		gap: 8px;
	}

	.top {
		top: 0;
	}

	.pins {
		position: relative;
		width: 100%;
		min-height: 0;
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
		background: var(--toolbar);
		color: var(--toolbar_text);
		border-radius: var(--radius);
		height: var(--tab-height);
		width: calc(100% - 16px);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
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
