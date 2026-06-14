import { iconAdd, iconNew } from "../../icons";
import { css, type FC } from "dreamland/core";
import { OmnibarButton } from "@components/Omnibar/OmnibarButton";
import { TabHoverCard } from "@components/TabStrip/TabHoverCard";
import type { Tab } from "../../Tab/Tab";
// import html2canvas from "html2canvas";
import { setContextMenu } from "@components/Menu";
import { DragTab } from "@components/TabStrip/DragTab";
import { requestUnfocusFrames } from "@components/Shell";

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
	const PIN_MAX_SIZE = 36;
	const TAB_TRANSITION = "225ms cubic-bezier(.43,.52,0,1.15)";
	const TAB_STAGGER_STEP = 18;
	const TAB_STAGGER_MAX = 144;

	let transitioningTabs = 0;

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
	const getTabWidth = () => {
		let total = getRootWidth();
		const visibleTabCount = this.visualtabs.filter(
			(tab) => !tab.closing
		).length;
		const visiblePinnedCount = this.visualtabs.filter(
			(tab) => !tab.closing && tab.tab.pinned
		).length;

		const nonPinnedCount = visibleTabCount - visiblePinnedCount;

		// Remove the padding for every gap between tabs (pinned tabs sit in the
		// same row, so they contribute gaps too) and the fixed width of each
		// pinned tab, then split whatever is left between the non-pinned tabs.
		total -= TAB_PADDING * (visibleTabCount - 1);
		total -= PIN_MAX_SIZE * visiblePinnedCount;

		const each = total / Math.max(nonPinnedCount, 1);

		return Math.min(TAB_MAX_SIZE, Math.floor(each));
	};

	const reorderTabs = () => {
		this.visualtabs.sort((a, b) => {
			const aCenter = a.pos + a.width / 2;

			const bLeft = b.pos;
			const bRight = b.pos + b.width;

			if (a.tab.pinned && !b.tab.pinned) {
				return -1;
			}

			if (!a.tab.pinned && b.tab.pinned) {
				return 1;
			}

			const bCenter =
				Math.abs(aCenter - bLeft) > Math.abs(aCenter - bRight) ? bRight : bLeft;

			return aCenter - bCenter;
		});
	};

	const layoutTabs = (transition: boolean) => {
		const width = getTabWidth();

		reorderTabs();

		let dragpos = -1;
		let currpos = getLayoutStart();
		let staggerIndex = 0;
		let movedTabs = 0;

		for (const tab of this.visualtabs) {
			if (tab.closing) {
				const tabPos = tab.dragpos != -1 ? tab.dragpos : tab.pos;
				tab.root.style.transform = `translateX(${tabPos}px)`;
				tab.pos = tabPos;
				continue;
			}

			const tabWidth = tab.tab.pinned ? PIN_MAX_SIZE : width;
			tab.root.style.width = tabWidth + "px";

			const tabPos = tab.dragpos != -1 ? tab.dragpos : currpos;

			tab.root.style.transform = `translateX(${tabPos}px)`;

			if (transition && tab.dragpos == -1 && tab.pos != tabPos) {
				const delay = Math.min(
					staggerIndex * TAB_STAGGER_STEP,
					TAB_STAGGER_MAX
				);
				tab.root.style.transition = `transform ${TAB_TRANSITION} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}

			dragpos = Math.max(dragpos, tab.dragpos + tabWidth + TAB_PADDING);

			tab.pos = tabPos;
			tab.width = tabWidth;

			currpos += tabWidth + TAB_PADDING;
			staggerIndex++;
		}

		if (transition && movedTabs > 0) {
			const afterDelay = Math.min(
				staggerIndex * TAB_STAGGER_STEP,
				TAB_STAGGER_MAX
			);
			this.afterEl.style.transition = `transform ${TAB_TRANSITION} ${afterDelay}ms`;
		}

		const afterpos = Math.max(dragpos, currpos);
		this.afterEl.style.transform = `translateX(${afterpos}px)`;
	};

	const getMaxDragPos = () => {
		return getLayoutStart() + getRootWidth();
	};

	const calcDragPos = (e: MouseEvent, tab: VisualTab) => {
		const maxPos = getMaxDragPos() - tab.root.offsetWidth;

		const pos = e.clientX - tab.dragoffset - getAbsoluteStart();

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

		for (let index = 0; index < this.tabs.length; index++) {
			let tab = this.tabs[index];

			let visualtab = this.visualtabs.find((t) => t.tab === tab);

			if (!visualtab) {
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
					pos: getLayoutStart() + index * (getTabWidth() + TAB_PADDING),
				};
			}

			newvisualtabs.push(visualtab);
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

		let slotIndex = 0;
		const slotWidth = getTabWidth();
		for (const vt of this.visualtabs) {
			if (!vt.closing && vt.dragpos === -1) {
				vt.pos = getLayoutStart() + slotIndex * (slotWidth + TAB_PADDING);
				slotIndex++;
			}
		}

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
			{use(this.visualtabs).mapEach((tab) => tab.root)}
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
