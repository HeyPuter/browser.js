import { createDelegate, css, type ComponentContext } from "dreamland/core";
import { browser } from "../Browser";
import { forceScreenshot, popTab, pushTab } from "../Browser";
import { takeScreenshotGDM } from "../screenshot";

let locks: Symbol[] = [];
let setUnfocus = createDelegate<boolean>();
export function requestUnfocusFrames(): [() => void, () => void] {
	let lock = Symbol();
	return [
		() => {
			setUnfocus(true);
			locks.push(lock);
		},
		() => {
			locks = locks.filter((l) => l !== lock);
			if (locks.length === 0) {
				setUnfocus(false);
			}
		},
	];
}

export function Shell(_, cx: ComponentContext) {
	pushTab.listen((tab) => {
		// paint the iframes
		tab.frame.frame.classList.add(cx.id!);
		// tab.devtoolsFrame.frame.classList.add(cx.id!);

		let mouseMoveListen = (e: MouseEvent) => {
			tab.devtoolsWidth = window.innerWidth - e.clientX;
		};

		const [lock, unlock] = requestUnfocusFrames();

		cx.root.appendChild(
			<div
				class="container"
				data-tab={tab.id}
				id={"tab" + tab.id}
				class:active={use(browser.activetab).map((t) => t === tab)}
				class:showframe={use(tab.internalpage).map((t) => !t)}
			>
				<div class="mainframecontainer">
					{use(tab.internalpage)}
					{tab.frame.frame}
				</div>
				<div
					class="devtools"
					class:active={use(tab.devtoolsOpen)}
					style={use`width: ${tab.devtoolsWidth}px`}
				>
					<div
						on:mousedown={(e: MouseEvent) => {
							lock();
							document.body.style.cursor = "ew-resize";
							window.addEventListener("mousemove", mouseMoveListen);
							window.addEventListener("mouseup", () => {
								unlock();
								window.removeEventListener("mousemove", mouseMoveListen);
								document.body.style.cursor = "";
							});
						}}
						class="divider"
					></div>
					<div class="devtoolsframecontainer">
						{/*{tab.devtoolsFrame.frame}*/}
					</div>
				</div>
				<progress value={use(tab.loadProgress)}></progress>
			</div>
		);
	});
	popTab.listen((tab) => {
		const container = cx.root.querySelector(`[data-tab="${tab.id}"]`);
		if (!container) throw new Error(`No container found for tab ${tab.id}`);
		container.remove();
	});
	forceScreenshot.listen(async (tab) => {
		const container = cx.root.querySelector(
			`[data-tab="${tab.id}"]`
		) as HTMLElement;
		if (!container) throw new Error(`No container found for tab ${tab.id}`);

		let blob = await takeScreenshotGDM(container);
		if (blob) tab.screenshot = URL.createObjectURL(blob);
		else {
			// tab.screenshot = await takeScreenshotSvg(container);
		}
	});
	setUnfocus.listen((unfocus) => {
		if (unfocus) {
			cx.root
				.querySelectorAll(".mainframecontainer, .devtoolsframecontainer")
				.forEach((el) => {
					if (!(el instanceof HTMLElement)) return;
					el.style.pointerEvents = "none";
				});
		} else {
			cx.root
				.querySelectorAll(".mainframecontainer, .devtoolsframecontainer")
				.forEach((el) => {
					if (!(el instanceof HTMLElement)) return;
					el.style.pointerEvents = "";
				});
		}
	});

	return <div></div>;
}

Shell.style = css`
	:scope {
		flex: 1;
		overflow: hidden;
		width: 100%;
		position: relative;
	}
	.container {
		position: absolute;
		width: 100%;
		height: 100%;
		display: flex;
		top: 0;
		left: 0;
		z-index: -1;
		/*display: none;*/

		/*https://screen-share.github.io/element-capture/#elements-eligible-for-restriction*/
		isolation: isolate;
		transform-style: flat;

		background-color: var(--ntp_background);
	}
	.container.active {
		z-index: 0;
	}
	.container .devtools {
		position: relative;
		display: none;
		width: 20em;
	}
	.container .devtools.active {
		display: flex;
	}

	.devtoolsframecontainer {
		width: 100%;
	}

	.mainframecontainer {
		display: flex;
		width: 100%;
		flex: 1;
		background: white;
	}

	.divider {
		position: absolute;
		top: 0;
		left: -5px;
		width: 5px;
		/* background: #ccc; */
		border-right: 1px solid #ccc;
		height: 100%;
		cursor: ew-resize;
	}

	iframe {
		flex: 1;
		height: 100%;
		width: 100%;
		border: none;
		display: none;
	}
	.showframe iframe {
		display: block;
	}
	progress {
		z-index: 1;
		position: absolute;
		width: 100%;
		height: 3px;
		border: none;
	}
	progress::-webkit-progress-bar {
		background-color: transparent;
	}
	progress::-webkit-progress-value {
		background-color: var(--tab_line);
	}
`;
