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
	// Reorder/move animation for tabs and trailing controls in the strip.
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
		const count = Math.max(visibleTabCount, 1);

		// remove padding
		total -= TAB_PADDING * (count - 1);

		const each = total / count;

		return Math.min(TAB_MAX_SIZE, Math.floor(each));
	};

	const reorderTabs = () => {
		this.visualtabs.sort((a, b) => {
			const aCenter = a.pos + a.width / 2;

			const bLeft = b.pos;
			const bRight = b.pos + b.width;
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
				// Closing tabs animate their own width; keep their current transform while
				// siblings/new-tab button reflow into post-close slots.
				const tabPos = tab.dragpos != -1 ? tab.dragpos : tab.pos;
				tab.root.style.transform = `translateX(${tabPos}px)`;
				tab.pos = tabPos;
				continue;
			}

			tab.root.style.width = width + "px";

			const tabPos = tab.dragpos != -1 ? tab.dragpos : currpos;
			// Moves each tab horizontally to its computed slot.
			tab.root.style.transform = `translateX(${tabPos}px)`;
			if (transition && tab.dragpos == -1 && tab.pos != tabPos) {
				const delay = Math.min(
					staggerIndex * TAB_STAGGER_STEP,
					TAB_STAGGER_MAX
				);
				// Animates tab movement when tabs are inserted/removed/reordered.
				tab.root.style.transition = `transform ${TAB_TRANSITION} ${delay}ms`;
				transitioningTabs++;
				movedTabs++;
			}
			dragpos = Math.max(dragpos, tab.dragpos + width + TAB_PADDING);

			tab.pos = tabPos;
			tab.width = width;
			currpos += width + TAB_PADDING;
			staggerIndex++;
		}

		if (transition && movedTabs > 0) {
			const afterDelay = Math.min(
				staggerIndex * TAB_STAGGER_STEP,
				TAB_STAGGER_MAX
			);
			// Animate trailing "after" area (new-tab button container) with stagger too.
			this.afterEl.style.transition = `transform ${TAB_TRANSITION} ${afterDelay}ms`;
		}

		const afterpos = Math.max(dragpos, currpos);
		// Moves the trailing control area to stay after the last tab.
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

	window.addEventListener("mousemove", (e: MouseEvent) => {
		if (this.currentlydragging === null) return;
		calcDragPos(
			e,
			this.visualtabs.find((tab) => tab.tab.id === this.currentlydragging)!
		);
	});

	window.addEventListener("mouseup", () => {
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
		this.currentlydragging = null;
		unlock();
	});

	const mouseDown = (e: MouseEvent, tab: VisualTab) => {
		if (e.button != 0) return;
		this.currentlydragging = tab.tab.id;
		lock();

		const rect = tab.root.getBoundingClientRect();
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
		setTimeout(() => layoutTabs(true), 10);
	});

	this.cx.mount = () => {
		requestAnimationFrame(() => layoutTabs(false));
		window.addEventListener("resize", () => layoutTabs(false));

		setContextMenu(this.root, [
			{
				label: "New Tab",
				icon: iconNew,
				action: () => {
					this.addTab();
				},
			},
		]);

		this.tabs = this.tabs;
	};

	return (
		<div id="tabstrip" this={use(this.container)}>
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

	:global(#tabstrip #hovercard) {
		transition:
			opacity 0.2s ease 700ms,
			scale 0.2s cubic-bezier(0.43, 0.91, 0.34, 1.3) 700ms,
			visibility 0s,
			left 0.2s cubic-bezier(0.33, 0.22, 0.18, 1.17);
		scale: 1;
	}

	:global(
		#tabstrip:is(:has(:active), :not(:has(:hover:not(.extra, .extra *))))
			#hovercard
	) {
		visibility: hidden;
		opacity: 0;
		scale: 0.8;
		transition: none;
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
