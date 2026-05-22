import { css, type FC } from "dreamland/core";
import type { Tab } from "../../Tab/Tab";
import { DragTab } from "./DragTab";
import { TabHoverCard } from "@components/TabStrip/TabHoverCard";
import { Icon } from "@components/Icon";
import { iconAdd } from "../../icons";
import { requestUnfocusFrames } from "@components/Shell";

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

	const TAB_PADDING = 6;
	const TAB_TRANSITION = "225ms cubic-bezier(.43,.52,0,1.15)";
	const TAB_STAGGER_STEP = 18;
	const TAB_STAGGER_MAX = 144;

	let transitioningTabs = 0;

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
		const firstVisible = this.visualtabs.find((tab) => !tab.closing);
		if (firstVisible) {
			const measured = firstVisible.root.offsetHeight;
			if (measured > 0) return measured;
		}

		const cssHeight = parseFloat(
			getComputedStyle(document.documentElement)
				.getPropertyValue("--tab-height")
				.trim()
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
				tab.root.style.transition = `transform ${TAB_TRANSITION} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}
			dragpos = Math.max(dragpos, tab.dragpos + height + TAB_PADDING);

			tab.pos = tabPos;
			tab.height = height;
			currpos += height + TAB_PADDING;
			staggerIndex++;
		}

		const afterpos = Math.max(dragpos, currpos);
		if (transition) {
			const afterDelay = Math.min(
				Math.max(staggerIndex, movedTabs > 0 ? staggerIndex : 1) *
					TAB_STAGGER_STEP,
				TAB_STAGGER_MAX
			);
			this.afterEl.style.transition = `transform ${TAB_TRANSITION} ${afterDelay}ms`;
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

		for (let index = 0; index < this.tabs.length; index++) {
			let tab = this.tabs[index];

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
				visualtab = {
					tab,
					root: dt,
					dragoffset: -1,
					dragpos: -1,
					startdragpos: -1,
					closing: false,
					height: 0,
					pos: getLayoutStart() + index * (getTabHeight() + TAB_PADDING),
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
		resizeObserver.observe(this.bottomEl);
		resizeObserver.observe(this.afterEl);

		// Force an initial sync for newly-mounted strips after mode switches.
		this.tabs = [...this.tabs];
	};

	return (
		<div
			id="tabstrip"
			this={use(this.container)}
			style={use(this.sidebarWidth).map(
				(width) =>
					`width: ${width}px; min-width: ${width}px; flex: 0 0 ${width}px;`
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
		display: block;
		position: relative;
		padding: var(--tab-padding) 8px;
		background: var(--frame);
		height: 100%;
		z-index: 2;
		border-right: 1px solid var(--text-15);
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
