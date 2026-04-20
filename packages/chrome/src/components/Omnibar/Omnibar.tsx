import { css, createDelegate, type FC } from "dreamland/core";
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
	iconError,
} from "../../icons";
import { createMenu, createMenuCustom } from "@components/Menu";
import { OmnibarButton } from "@components/Omnibar/OmnibarButton";
import type { Tab } from "../../Tab/Tab";
import { Omnibox } from "@components/Omnibar/Omnibox";
import { Icon } from "@components/Icon";
import { defaultFaviconUrl } from "../../assets/favicon";

import type { HistoryState } from "../../Tab/History";
import { isPuter, puterBranding, tabsService, downloadsService } from "../..";
import { DownloadsPopup } from "@components/DownloadsPopup";
import { CircularProgress } from "@components/Omnibar/CircularProgress";
import { ReportBrokenSiteModal } from "@components/ReportBrokenSiteModal";
import { INTERNAL_URL_PROTOCOL } from "../../consts";

export const animateDownloadFly = createDelegate<void>();
export const showDownloadsPopup = createDelegate<void>();

export function Spacer() {
	return <div></div>;
}
Spacer.style = css`
	:scope {
		width: 2em;
	}
`;

export function Omnibar(this: FC<{ tab: Tab }>) {
	const selectContent = createDelegate<void>();

	animateDownloadFly.listen(async () => {
		await new Promise((r) => setTimeout(r, 10));
		let fly: HTMLElement = this.root.querySelector(".downloadfly")!;
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
				{
					left: e.clientX,
					top: this.root.clientTop + this.root.clientHeight * 2,
				},
				[
					...states.map((st) => ({
						label: st.title || "New Tab",
						image: st.favicon || defaultFaviconUrl,
						action: () => {
							let rel =
								browser.activetab.history.states.indexOf(st) -
								browser.activetab.history.index;
							browser.activetab.history.go(rel);
						},
					})),
					"-",
					{
						icon: iconTime,
						label: "Show Full History",
						action: () => {
							browser.newTab(new URL(`${INTERNAL_URL_PROTOCOL}//history`));
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
				top: this.root.clientTop + this.root.clientHeight * 2,
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
			{use(downloadsService.sessionDownloadHistory)
				.map((arr) => arr.length > 0)
				.and(
					<div style="position: relative">
						{downloadsButton}

						<div class="downloadfly down">
							<Icon icon={iconDownload}></Icon>
						</div>
						<CircularProgress
							progress={use(downloadsService.downloadProgress)}
						></CircularProgress>
					</div>
				)}

			<OmnibarButton
				tooltip="More Options"
				icon={iconMore}
				click={(e: MouseEvent) => {
					createMenu(
						{
							left: e.x,
							top: this.root.clientTop + this.root.clientHeight * 2,
						},
						[
							{
								label: "New Tab",
								action: () => {
									tabsService.newTab(
										new URL(`${INTERNAL_URL_PROTOCOL}//newtab`),
										true
									);
								},
								icon: iconNew,
							},
							"-",
							{
								label: "History",
								action: () => {
									tabsService.newTab(
										new URL(`${INTERNAL_URL_PROTOCOL}//history`)
									);
								},
								icon: iconTime,
							},
							{
								label: "Downloads",
								action: () => {
									tabsService.newTab(
										new URL(`${INTERNAL_URL_PROTOCOL}//downloads`)
									);
								},
								icon: iconDownload,
							},
							"-",
							{
								label: "About",
								action: () => {
									tabsService.newTab(
										new URL(`${INTERNAL_URL_PROTOCOL}//settings/about`)
									);
								},
								icon: iconInfo,
							},

							puterBranding &&
							browser.activetab.url.protocol !== INTERNAL_URL_PROTOCOL
								? {
										label: "Report Broken Site",
										action: () => {
											<ReportBrokenSiteModal onClose={() => {}} />;
										},
										icon: iconError,
									}
								: null,
							{
								label: "Settings",
								action: () => {
									tabsService.newTab(
										new URL(`${INTERNAL_URL_PROTOCOL}//settings`)
									);
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
						].filter((x) => x !== null) as any
					);
					e.stopPropagation();
				}}
			></OmnibarButton>
		</div>
	);
}
Omnibar.style = css`
	:scope {
		z-index: 1;
		background: var(--toolbar);
		display: flex;
		padding: 0 7px 0 7px;
		height: var(--omnibar-height);
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
		color: var(--toolbar_text);
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
		background: var(--text-15);
	}
`;
