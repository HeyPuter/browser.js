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
import { TabStrip } from "@components/TabStrip/TabStrip";

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

export function Omnibar(
	this: FC<{
		tab: Tab;
		layout?: "horizontal" | "vertical" | "compact";
	}>
) {
	const selectContent = createDelegate<void>();
	const layout = this.layout ?? "horizontal";

	const getPopupPosition = (
		target: EventTarget | null,
		align: "left" | "right" = "left"
	) => {
		const element = target instanceof HTMLElement ? target : null;
		if (!element) return { left: 0, top: 0 };

		const rect = element.getBoundingClientRect();
		return align === "right"
			? { right: rect.right, top: rect.bottom + 6 }
			: { left: rect.left, top: rect.bottom + 6 };
	};

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
			createMenu(getPopupPosition(e.currentTarget), [
				...states.map((st) => ({
					label: st.title || "New Tab",
					image: st.favicon || defaultFaviconUrl,
					action: () => {
						let rel =
							tabsService.activetab.history.states.indexOf(st) -
							tabsService.activetab.history.index;
						tabsService.activetab.history.go(rel);
					},
				})),
				"-",
				{
					icon: iconTime,
					label: "Show Full History",
					action: () => {
						tabsService.newTab(new URL(`${INTERNAL_URL_PROTOCOL}//history`));
					},
				},
			]);
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
		createMenuCustom(
			getPopupPosition(downloadsButton, "right"),
			<DownloadsPopup></DownloadsPopup>
		);
	});

	const navigationControls = (
		<>
			<OmnibarButton
				tooltip="Go back one page (Alt+Left Arrow)"
				active={use(this.tab.canGoBack)}
				click={() => this.tab.back()}
				icon={iconBack}
				rightclick={(e: MouseEvent) =>
					historyMenu(
						e,
						tabsService.activetab.history.states
							.slice(0, tabsService.activetab.history.index)
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
						tabsService.activetab.history.states.slice(
							tabsService.activetab.history.index + 1,
							tabsService.activetab.history.states.length
						)
					)
				}
			></OmnibarButton>
			<OmnibarButton
				tooltip="Refresh current page (Ctrl+R)"
				click={() => this.tab.reload()}
				icon={iconRefresh}
			></OmnibarButton>
		</>
	);

	const utilityControls = (
		<>
			<OmnibarButton active={false} icon={iconExtension}></OmnibarButton>
			{use(downloadsService.sessionDownloadHistory)
				.map((arr) => arr.length > 0)
				.and(
					<div class="download-container">
						{downloadsButton}

						<div class="downloadfly down">
							<Icon icon={iconDownload}></Icon>
						</div>
						<CircularProgress
							progress={use(downloadsService.current).map(
								(x) => x?.progress || 0
							)}
						></CircularProgress>
					</div>
				)}
			<OmnibarButton
				tooltip="More Options"
				icon={iconMore}
				click={(e: MouseEvent) => {
					createMenu(
						getPopupPosition(e.currentTarget, "right"),
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
							tabsService.activetab.url.protocol !== INTERNAL_URL_PROTOCOL
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
		</>
	);

	if (layout === "vertical") {
		return (
			<div class="vertical">
				<div class="top-row">
					<div class="button-group nav">{navigationControls}</div>
					<div class="button-group utilities">{utilityControls}</div>
				</div>
				<div class="omnibox-row">
					<Omnibox
						selectContent={selectContent}
						layout="vertical"
						url={use(this.tab.url)}
					></Omnibox>
				</div>
			</div>
		);
	}

	if (layout === "compact") {
		return (
			<div class="compact">
				<div class="button-group nav">{navigationControls}</div>
				<div class="compact-center">
					<div class="compact-omnibox">
						<Omnibox
							selectContent={selectContent}
							layout="horizontal"
							url={use(this.tab.url)}
						></Omnibox>
					</div>
					<div class="compact-tabs">
						<TabStrip
							inline
							tabs={use(tabsService.tabs)}
							activetab={use(tabsService.activetab)}
							addTab={() => {
								tabsService.newTab(
									new URL(`${INTERNAL_URL_PROTOCOL}//newtab`),
									true
								);
							}}
							destroyTab={(tab: Tab) => {
								tabsService.destroyTab(tab);
							}}
						/>
					</div>
				</div>
				<div class="button-group utilities">{utilityControls}</div>
			</div>
		);
	}

	return (
		<div class="horizontal">
			{navigationControls}
			<Spacer></Spacer>
			<Omnibox
				selectContent={selectContent}
				layout="horizontal"
				url={use(this.tab.url)}
			></Omnibox>
			<Spacer></Spacer>
			{utilityControls}
		</div>
	);
}
Omnibar.style = css`
	:scope.horizontal,
	:scope.compact {
		z-index: 1;
		background: var(--toolbar);
		display: flex;
		padding: 0 7px 0 7px;
		height: var(--omnibar-height);
		align-items: center;
		position: relative;
		gap: 0.2em;
	}

	:scope.compact {
		gap: 0.45rem;
	}

	:scope {
		width: 100%;
	}

	:scope.vertical {
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		position: relative;
	}

	.top-row,
	.button-group,
	.omnibox-row {
		display: flex;
		align-items: center;
	}

	.top-row {
		justify-content: space-between;
		gap: 0.5rem;
	}

	.button-group {
		gap: 0.2em;
	}

	.button-group.utilities {
		margin-left: auto;
	}

	.compact-center,
	.compact-omnibox,
	.compact-tabs {
		display: flex;
		align-items: stretch;
		min-width: 0;
	}

	.compact-center {
		flex: 1;
		gap: 0.45rem;
	}

	.compact-omnibox {
		flex: 0 1 40rem;
		width: clamp(14rem, 36vw, 40rem);
	}

	.compact-tabs {
		flex: 1;
	}

	:scope.compact .button-group.utilities {
		margin-left: 0;
	}

	.omnibox-row {
		height: var(--omnibar-height);
		position: relative;
		overflow: visible;
		z-index: 0;
	}

	.omnibox-row:has(> .active) {
		z-index: 4;
	}

	.download-container {
		position: relative;
		display: flex;
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
