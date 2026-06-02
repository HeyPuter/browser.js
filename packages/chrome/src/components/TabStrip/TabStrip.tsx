import { iconAdd, iconNew } from "../../icons";
import { css, type FC } from "dreamland/core";
import { OmnibarButton } from "@components/Omnibar/OmnibarButton";
import { TabHoverCard } from "@components/TabStrip/TabHoverCard";
import type { Tab } from "../../Tab/Tab";
// import html2canvas from "html2canvas";
import { setContextMenu } from "@components/Menu";
import { DragTab } from "@components/TabStrip/DragTab";
import { requestUnfocusFrames } from "@components/Shell";
import { tabsService } from "../..";

type VisualTab = {
	tab: Tab;
	root: HTMLElement;
	dragoffset: number;
	dragpos: number;
	startdragpos: number;
	closing: boolean;

	width: number;
	pos: number;
};
export function TabStrip(
	this: FC<
		{
			tabs: Tab[];
			activetab: Tab;
			destroyTab: (tab: Tab) => void;
			addTab: () => void;
			inline?: boolean;
		},
		{
			visualtabs: VisualTab[];
			container: HTMLElement;
			leftEl: HTMLElement;
			rightEl: HTMLElement;
			afterEl: HTMLElement;

			currentlydragging: string | null;
			currentlyHovered: Tab | null;
		}
	>
) {
	this.currentlydragging = null;
	this.currentlyHovered = this.tabs[0];
	this.visualtabs = [];

	const [lock, unlock] = requestUnfocusFrames();

	const TAB_PADDING = 6;
	const TAB_MAX_SIZE = 231;
	const PINNED_TAB_MIN_SIZE = 24;
	const PINNED_TAB_MAX_SIZE = 48;
	const OPEN_TAB_TRANSITION = "200ms cubic-bezier(.25,.5,0,1.15)";
	// Reorder/move animation for tabs and trailing controls in the strip.
	const TAB_TRANSITION = "225ms cubic-bezier(.43,.52,0,1.15)";
	const TAB_STAGGER_STEP = 18;
	const TAB_STAGGER_MAX = 144;

	let transitioningTabs = 0;
	let openingTabs = new Set<VisualTab>();

	const getRootWidth = () => {
		const style = getComputedStyle(this.container);
		const padding =
			parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
		const border =
			parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
		const left = this.leftEl.offsetWidth;
		const right = this.rightEl.offsetWidth;
		const after = this.afterEl.offsetWidth;

		return this.container.offsetWidth - padding - border - left - right - after;
	};
	const getAbsoluteStart = () => {
		const rect = this.container.getBoundingClientRect();
		const style = getComputedStyle(this.container);

		return (
			rect.left +
			getLayoutStart() +
			parseFloat(style.paddingLeft) +
			parseFloat(style.borderLeftWidth)
		);
	};
	const getLayoutStart = () => {
		return this.leftEl.offsetWidth;
	};

	const getVisibleTabs = () => {
		return this.visualtabs.filter((tab) => !tab.closing);
	};

	const getMeasuredTabHeight = () => {
		const firstVisible = getVisibleTabs()[0];
		const measured = firstVisible?.root.offsetHeight ?? 0;
		return measured > 0 ? measured : 36;
	};

	const getLayoutMetrics = (visibleTabs = getVisibleTabs()) => {
		const pinnedCount = visibleTabs.filter((tab) => tab.tab.pinned).length;
		const regularCount = visibleTabs.length - pinnedCount;
		const totalPadding = TAB_PADDING * Math.max(visibleTabs.length - 1, 0);
		const availableWidth = Math.max(0, getRootWidth() - totalPadding);
		const preferredPinnedWidth = Math.min(
			PINNED_TAB_MAX_SIZE,
			Math.max(PINNED_TAB_MIN_SIZE, Math.round(getMeasuredTabHeight() + 8))
		);
		const pinnedWidth =
			pinnedCount === 0
				? 0
				: Math.min(
						preferredPinnedWidth,
						Math.max(
							PINNED_TAB_MIN_SIZE,
							Math.floor(availableWidth / Math.max(pinnedCount, 1))
						)
					);
		const remainingWidth = Math.max(
			0,
			availableWidth - pinnedCount * pinnedWidth
		);
		const regularWidth =
			regularCount === 0
				? 0
				: Math.min(TAB_MAX_SIZE, Math.floor(remainingWidth / regularCount));

		return {
			pinnedCount,
			pinnedWidth,
			regularWidth,
			getTabWidth: (pinned: boolean) => (pinned ? pinnedWidth : regularWidth),
			getSectionStart: (pinned: boolean) =>
				getLayoutStart() +
				(pinned
					? 0
					: pinnedCount > 0
						? pinnedCount * pinnedWidth + (pinnedCount - 1) * TAB_PADDING
						: 0),
			getSectionSize: (count: number, pinned: boolean) => {
				const width = pinned ? pinnedWidth : regularWidth;
				return count > 0 ? count * width + (count - 1) * TAB_PADDING : 0;
			},
		};
	};

	const getStaticOrderedTabs = (visualTabs: VisualTab[]) => {
		const visibleTabs = visualTabs.filter((tab) => !tab.closing);
		return [
			...visibleTabs.filter((tab) => tab.tab.pinned),
			...visibleTabs.filter((tab) => !tab.tab.pinned),
		];
	};

	const getInsertIndex = (
		tab: VisualTab,
		group: VisualTab[],
		metrics = getLayoutMetrics()
	) => {
		const peers = group.filter((peer) => peer !== tab);
		const width = metrics.getTabWidth(tab.tab.pinned);
		const sectionStart = metrics.getSectionStart(tab.tab.pinned);
		const center = tab.dragpos + width / 2;
		const offset = center - sectionStart;
		const step = width + TAB_PADDING;
		const insertIndex = Math.floor((offset + TAB_PADDING / 2) / step);

		return Math.min(peers.length, Math.max(0, insertIndex));
	};

	const getOrderedGroup = (
		group: VisualTab[],
		metrics = getLayoutMetrics()
	) => {
		const draggingTab =
			this.currentlydragging === null
				? null
				: (group.find((tab) => tab.tab.id === this.currentlydragging) ?? null);
		if (!draggingTab) return group;

		const peers = group.filter((tab) => tab !== draggingTab);
		peers.splice(getInsertIndex(draggingTab, group, metrics), 0, draggingTab);
		return peers;
	};

	const getOrderedVisibleTabs = (metrics = getLayoutMetrics()) => {
		const visibleTabs = getVisibleTabs();
		const pinnedTabs = visibleTabs.filter((tab) => tab.tab.pinned);
		const regularTabs = visibleTabs.filter((tab) => !tab.tab.pinned);

		return [
			...getOrderedGroup(pinnedTabs, metrics),
			...getOrderedGroup(regularTabs, metrics),
		];
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
		const metrics = getLayoutMetrics(orderedTabs);
		let currpos = getLayoutStart();

		for (const tab of orderedTabs) {
			const width = metrics.getTabWidth(tab.tab.pinned);
			if (newTabs.has(tab)) {
				tab.root.style.width = width + "px";
				tab.root.style.transform = `translateX(${currpos}px)`;
				tab.width = width;
				tab.pos = currpos;
			}

			currpos += width + TAB_PADDING;
		}
	};

	const layoutTabs = (transition: boolean) => {
		const metrics = getLayoutMetrics();
		const orderedTabs = getOrderedVisibleTabs(metrics);
		syncVisualOrder(orderedTabs);
		const hasOpeningTabs = orderedTabs.some((tab) => openingTabs.has(tab));
		const tabTransition = hasOpeningTabs ? OPEN_TAB_TRANSITION : TAB_TRANSITION;

		let dragpos = -1;
		let currpos = getLayoutStart();
		let staggerIndex = 0;
		let movedTabs = 0;
		for (const tab of orderedTabs) {
			const width = metrics.getTabWidth(tab.tab.pinned);
			tab.root.style.width = width + "px";

			const tabPos = tab.dragpos != -1 ? tab.dragpos : currpos;
			// Moves each tab horizontally to its computed slot.
			tab.root.style.transform = `translateX(${tabPos}px)`;
			if (transition && tab.dragpos == -1 && tab.pos != tabPos) {
				const delay = hasOpeningTabs
					? 0
					: Math.min(staggerIndex * TAB_STAGGER_STEP, TAB_STAGGER_MAX);
				// Animates tab movement when tabs are inserted/removed/reordered.
				tab.root.style.transition = `transform ${tabTransition} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}
			dragpos = Math.max(
				dragpos,
				tab.dragpos == -1 ? -1 : tab.dragpos + width + TAB_PADDING
			);

			tab.pos = tabPos;
			tab.width = width;
			currpos += width + TAB_PADDING;
			staggerIndex++;
		}

		if (transition && movedTabs > 0) {
			const afterDelay = hasOpeningTabs
				? 0
				: Math.min(staggerIndex * TAB_STAGGER_STEP, TAB_STAGGER_MAX);
			// Animate trailing "after" area (new-tab button container) with stagger too.
			this.afterEl.style.transition = `transform ${tabTransition} ${afterDelay}ms`;
		}

		const afterpos = Math.max(dragpos, currpos);
		// Moves the trailing control area to stay after the last tab.
		this.afterEl.style.transform = `translateX(${afterpos}px)`;

		for (const tab of this.visualtabs) {
			if (!tab.closing) continue;
			const tabPos = tab.dragpos != -1 ? tab.dragpos : tab.pos;
			tab.root.style.width = tab.width + "px";
			tab.root.style.transform = `translateX(${tabPos}px)`;
			tab.pos = tabPos;
		}
	};

	const calcDragPos = (e: MouseEvent, tab: VisualTab) => {
		const metrics = getLayoutMetrics();
		const width = metrics.getTabWidth(tab.tab.pinned);
		const visibleTabs = getVisibleTabs();
		const count = visibleTabs.filter(
			(candidate) => candidate.tab.pinned === tab.tab.pinned
		).length;
		const minPos = metrics.getSectionStart(tab.tab.pinned);
		const maxPos =
			minPos + metrics.getSectionSize(count, tab.tab.pinned) - width;

		const pos = e.clientX - tab.dragoffset - getAbsoluteStart();

		tab.dragpos = Math.min(Math.max(minPos, pos), Math.max(minPos, maxPos));
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

		const metrics = getLayoutMetrics();
		const orderedVisibleTabs = getOrderedVisibleTabs(metrics);
		syncVisualOrder(orderedVisibleTabs);

		const tab = this.visualtabs.find(
			(tab) => tab.tab.id === this.currentlydragging
		)!;
		const nextOrder = orderedVisibleTabs.map((visualtab) => visualtab.tab);
		const dragroot = tab.root.querySelector(".dragroot") as HTMLElement;

		this.currentlydragging = null;
		dragroot.style.width = "";
		dragroot.style.position = "unset";
		tab.dragoffset = -1;
		tab.dragpos = -1;
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
		dragroot.style.position = "absolute";
		tab.dragoffset = e.clientX - rect.left;
		tab.startdragpos = rect.left;

		if (tab.dragoffset < 0) throw new Error("dragoffset must be positive");

		calcDragPos(e, tab);

		if (this.activetab != tab.tab) {
			this.activetab = tab.tab;
			// markDirty();
		}

		window.addEventListener("mousemove", mouseMoveHandler);
		window.addEventListener("mouseup", mouseUpHandler);
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
					width: 0,
					pos: getLayoutStart() + index * (TAB_MAX_SIZE + TAB_PADDING),
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
				// Close-tab animation: collapses tab width to 0 before removal from DOM list.
				let anim = vtab.root.animate(
					[
						{},
						{
							width: "0px",
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
		requestAnimationFrame(() => layoutTabs(false));
		const resizeHandler = () => {
			if (!this.root.isConnected) {
				window.removeEventListener("resize", resizeHandler);
				return;
			}
			layoutTabs(false);
		};
		window.addEventListener("resize", resizeHandler);

		setContextMenu(this.root, [
			{
				label: "New Tab",
				icon: iconNew,
				action: () => {
					this.addTab();
				},
			},
		]);

		// Force an initial sync for newly-mounted strips after mode switches.
		this.tabs = [...this.tabs];
	};

	return (
		<div
			id="tabstrip"
			class:inline={this.inline ?? false}
			this={use(this.container)}
		>
			<div class="extra left" this={use(this.leftEl)}></div>
			{use(this.visualtabs)
				.map((tabs) => [
					...tabs.filter((tab) => tab.tab.pinned),
					...tabs.filter((tab) => !tab.tab.pinned),
				])
				.mapEach((tab) => tab.root)}
			<div
				class="extra after"
				this={use(this.afterEl)}
				on:contextmenu={(e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
				}}
			>
				<OmnibarButton icon={iconAdd} click={this.addTab}></OmnibarButton>
			</div>
			<div class="extra right" this={use(this.rightEl)}></div>
			<TabHoverCard hoveredTab={use(this.currentlyHovered)} />
		</div>
	);
}
TabStrip.style = css`
	:scope {
		background: var(--frame);
		padding: var(--tab-padding) 12px;
		height: calc(var(--tab-height) + calc(var(--tab-padding) * 2));
		z-index: 2;
		position: relative;
	}

	:scope.inline {
		background: none;
		padding: calc((var(--omnibar-height) - var(--tab-height)) / 2) 0;
		height: var(--omnibar-height);
		width: 100%;
		min-width: 0;
		flex: 1;
	}

	:global(.layout-bottom) :scope {
		border-top: 1px solid var(--popup_border);
	}

	:global(.layout-bottom) :scope.inline {
		border-top: none;
	}

	.extra {
		top: 0px;
		height: 100%;
		position: absolute;
		display: flex;
		align-items: center;
		z-index: 0;
	}

	.left {
		left: 0;
	}
	.right {
		right: 0;
	}
`;

function updateAspectRatio() {
	const ratio = window.innerWidth / window.innerHeight;
	document.documentElement.style.setProperty("--viewport-ratio", String(ratio));
}

updateAspectRatio();
window.addEventListener("resize", updateAspectRatio);
