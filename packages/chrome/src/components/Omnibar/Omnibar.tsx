import { css, type Component } from "dreamland/core";
import {
	iconBack,
	iconForwards,
	iconRefresh,
	iconExtension,
	iconDownload,
	iconMore,
	iconExit,
	iconNew,
	iconTime,
	iconInfo,
	iconSettings,
} from "../../icons";
import { createMenu, createMenuCustom } from "../Menu";
import { OmnibarButton } from "./OmnibarButton";
import { createDelegate } from "dreamland/core";
import type { Tab } from "../../Tab";
import { Omnibox } from "./Omnibox";
import { browser } from "../../Browser";
import { Icon } from "../Icon";
import { defaultFaviconUrl } from "../../assets/favicon";

import type { HistoryState } from "../../History";
import { isPuter } from "../../main";
import { DownloadsPopup } from "../DownloadsPopup";
import { CircularProgress } from "./CircularProgress";

export const animateDownloadFly = createDelegate<void>();
export const showDownloadsPopup = createDelegate<void>();

export const Spacer: Component = function (cx) {
	return <div></div>;
};
Spacer.style = css`
	:scope {
		width: 2em;
	}
`;

export const Omnibar: Component<{
	tab: Tab;
}> = function (cx) {
	const selectContent = createDelegate<void>();

	animateDownloadFly.listen(async () => {
		await new Promise((r) => setTimeout(r, 10));
		let fly: HTMLElement = cx.root.querySelector(".downloadfly")!;
		fly.addEventListener(
			"transitionend",
			() => {
				fly.style.opacity = "0";
				fly.classList.add("down");
			},
			{ once: true }
		);
		fly.style.opacity = "1";
		fly.classList.remove("down");
	});

	const historyMenu = (e: MouseEvent, states: HistoryState[]) => {
		if (states.length > 0) {
			createMenu(
				{ left: e.clientX, top: cx.root.clientTop + cx.root.clientHeight * 2 },
				[
					...states.map((s) => ({
						label: s.title || "New Tab",
						image: s.favicon || defaultFaviconUrl,
						action: () => {
							let rel =
								browser.activetab.history.states.indexOf(s) -
								browser.activetab.history.index;
							browser.activetab.history.go(rel);
						},
					})),
					"-",
					{
						icon: iconTime,
						label: "Show Full History",
						action: () => {
							browser.newTab(new URL("puter://history"));
						},
					},
				]
			);
		}
		e.preventDefault();
		e.stopPropagation();
	};

	const downloadsButton = (
		<OmnibarButton
			click={() => {
				showDownloadsPopup();
			}}
			icon={iconDownload}
		></OmnibarButton>
	);
	showDownloadsPopup.listen(() => {
		const { right } = downloadsButton.getBoundingClientRect();
		createMenuCustom(
			{
				top: cx.root.clientTop + cx.root.clientHeight * 2,
				right,
			},
			<DownloadsPopup></DownloadsPopup>
		);
	});

	return (
		<div>
			<OmnibarButton
				tooltip="Go back one page (Alt+Left Arrow)"
				active={use(this.tab.canGoBack)}
				click={() => this.tab.back()}
				icon={iconBack}
				rightclick={(e: MouseEvent) =>
					historyMenu(
						e,
						browser.activetab.history.states
							.slice(0, browser.activetab.history.index)
							.reverse()
					)
				}
			></OmnibarButton>
			<OmnibarButton
				tooltip="Go forward one page (Alt+Right Arrow)"
				active={use(this.tab.canGoForward)}
				click={() => this.tab.forward()}
				icon={iconForwards}
				rightclick={(e: MouseEvent) =>
					historyMenu(
						e,
						browser.activetab.history.states.slice(
							browser.activetab.history.index + 1,
							browser.activetab.history.states.length
						)
					)
				}
			></OmnibarButton>
			<OmnibarButton
				tooltip="Refresh current page (Ctrl+R)"
				click={() => this.tab.reload()}
				icon={iconRefresh}
			></OmnibarButton>
			<Spacer></Spacer>
			<Omnibox selectContent={selectContent} url={use(this.tab.url)}></Omnibox>
			<Spacer></Spacer>
			<OmnibarButton active={false} icon={iconExtension}></OmnibarButton>
			{use(browser.sessionDownloadHistory)
				.map((s) => s.length > 0)
				.andThen(
					<div style="position: relative">
						{downloadsButton}

						<div class="downloadfly down">
							<Icon icon={iconDownload}></Icon>
						</div>
						<CircularProgress
							progress={use(browser.downloadProgress)}
						></CircularProgress>
					</div>
				)}

			<OmnibarButton
				tooltip="More Options"
				icon={iconMore}
				click={(e: MouseEvent) => {
					createMenu(
						{ left: e.x, top: cx.root.clientTop + cx.root.clientHeight * 2 },
						[
							{
								label: "New Tab",
								action: () => {
									browser.newTab(new URL("puter://newtab"), true);
								},
								icon: iconNew,
							},
							"-",
							{
								label: "History",
								action: () => {
									browser.newTab(new URL("puter://history"));
								},
								icon: iconTime,
							},
							{
								label: "Downloads",
								action: () => {
									browser.newTab(new URL("puter://downloads"));
								},
								icon: iconDownload,
							},
							"-",
							{
								label: "About",
								action: () => {
									browser.newTab(new URL("puter://version"));
								},
								icon: iconInfo,
							},
							{
								label: "Settings",
								action: () => {
									browser.newTab(new URL("puter://settings"));
								},
								icon: iconSettings,
							},
							...(isPuter
								? [
										{
											label: "Exit",
											action: () => {
												puter.exit();
											},
											icon: iconExit,
										},
									]
								: []),
						]
					);
					e.stopPropagation();
				}}
			></OmnibarButton>
		</div>
	);
};
Omnibar.style = css`
	:scope {
		z-index: 1;
		background: var(--bg01);
		display: flex;
		padding: 0 7px 0 7px;
		height: 2.5em;
		align-items: center;
		position: relative;
		gap: 0.2em;
	}

	.downloadfly {
		position: absolute;
		top: 0;
		box-sizing: border-box;
		aspect-ratio: 1/1;
		align-items: center;
		justify-content: center;
		width: 100%;

		display: flex;
		outline: none;
		border: none;
		font-size: 1.25em;
		background: none;
		color: var(--fg);
		border-radius: 0.2em;

		transition: top 0.5s ease;
	}
	.downloadfly.down {
		top: 100vh;
	}
	.downloadfly::before {
		position: absolute;
		content: "";
		z-index: -1;
		height: 2em;
		width: 2em;
		border-radius: 50%;
		opacity: 0.5;
		background: var(--bg20);
	}
`;
