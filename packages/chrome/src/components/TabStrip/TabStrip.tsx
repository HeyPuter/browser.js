import { iconAdd, iconNew } from "../../icons";
import { css, type FC } from "dreamland/core";
import { OmnibarButton } from "@components/Omnibar/OmnibarButton";
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
		}
	>
) {
	this.currentlydragging = null;
	this.visualtabs = [];

	const [lock, unlock] = requestUnfocusFrames();

	const TAB_PADDING = 6;
	const TAB_MAX_SIZE = 231;
	const TAB_TRANSITION = "250ms ease";

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

		// remove padding
		total -= TAB_PADDING * (this.visualtabs.length - 1);

		const each = total / this.visualtabs.length;

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
		for (const tab of this.visualtabs) {
			tab.root.style.width = width + "px";

			const tabPos = tab.dragpos != -1 ? tab.dragpos : currpos;
			tab.root.style.transform = `translateX(${tabPos}px)`;
			if (transition && tab.dragpos == -1 && tab.pos != tabPos) {
				tab.root.style.transition = `transform ${TAB_TRANSITION}`;
				this.afterEl.style.transition = `transform ${TAB_TRANSITION}`;
				transitioningTabs++;
			}
			dragpos = Math.max(dragpos, tab.dragpos + width + TAB_PADDING);

			tab.pos = tabPos;
			tab.width = width;
			currpos += width + TAB_PADDING;
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
		transitioningTabs--;
		if (transitioningTabs == 0) {
			this.tabs = this.tabs;
		}

		this.afterEl.style.transition = "";
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
					width: 0,
					pos: getLayoutStart() + index * (getTabWidth() + TAB_PADDING),
				};
			}

			newvisualtabs.push(visualtab);
		}

		for (let vtab of this.visualtabs) {
			if (!newvisualtabs.includes(vtab)) {
				let indexof = this.visualtabs.indexOf(vtab);
				newvisualtabs.splice(indexof, 0, vtab);
				let anim = vtab.root.animate(
					[
						{},
						{
							width: "0px",
						},
					],
					{
						duration: 100,
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
		<div this={use(this.container)}>
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
