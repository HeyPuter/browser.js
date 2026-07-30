import type { FC } from "dreamland/core";
import { css } from "dreamland/core";
import { TabStrip } from "@components/TabStrip/TabStrip";
import { Sidebar, VerticalPinList } from "@components/TabStrip/Sidebar";
import { Tab } from "./Tab/Tab";
import { BookmarksStrip } from "@components/BookmarksStrip";
import { Omnibar } from "@components/Omnibar/Omnibar";
import { getTheme } from "./themes";
import { setIconSet } from "./icons";
import { TWEAKS, TWEAK_KEYS, tweakClass } from "./tweaks";
import { contexts } from "./proxy/scramjet";
import { INTERNAL_URL_PROTOCOL } from "./consts";
import { Shell } from "@components/Shell";
import { settingsService, tabsService } from ".";

const DEFAULT_HYBRID_SIDEBAR_WIDTH = 225;
const DEFAULT_VERTICAL_SIDEBAR_WIDTH = 280;

function getSidebarWidth(
	layout: "horizontal" | "bottom" | "hybrid" | "vertical" | "compact",
	savedWidth: number | null
) {
	if (savedWidth !== null) return savedWidth;
	return layout === "vertical"
		? DEFAULT_VERTICAL_SIDEBAR_WIDTH
		: DEFAULT_HYBRID_SIDEBAR_WIDTH;
}

export function App(
	this: FC<
		{},
		{
			children: any;
		}
	>
) {
	const applyTheme = () => {
		const appearance = settingsService.settings.appearance;
		const themeId = settingsService.settings.themeId;
		const theme = getTheme(themeId);

		// Determine if we should use light mode
		let isLight = false;
		if (appearance === "system") {
			const prefersDark = window.matchMedia(
				"(prefers-color-scheme: dark)"
			).matches;
			isLight = !prefersDark;
		} else {
			isLight = appearance === "light";
		}

		document.body.classList.toggle("light-mode", isLight);

		// Apply theme tokens
		for (const [key, value] of Object.entries(theme.tokens)) {
			document.body.style.setProperty(`--${key}`, value);
		}

		for (const context of contexts) {
			context.rpc.call("updateTheme", theme);
		}
	};

	applyTheme();

	const applyProfile = () => {
		const profile = settingsService.settings.uiProfile;
		document.body.classList.toggle("ui-compact", profile === "compact");
		document.body.classList.toggle("ui-touch", profile === "touch");
		document.body.classList.toggle("ui-default", profile === "default");
	};

	applyProfile();

	// Style tweaks ("Tweaks" in settings): the shape, motion and iconography of
	// UI elements, independent of the colors. Each axis contributes exactly one
	// body class, `<slug>-<value>`, which style.css and the component
	// stylesheets key off; see tweaks.ts. Icons are the one axis CSS can't
	// express, so it's pushed into icons.ts instead.
	const applyTweaks = () => {
		for (const key of TWEAK_KEYS) {
			const active = settingsService.settings[key];
			for (const option of TWEAKS[key].options) {
				document.body.classList.toggle(
					tweakClass(key, option.id),
					option.id === active
				);
			}
		}
		setIconSet(settingsService.settings.iconSet);
	};

	applyTweaks();

	const applyLayout = () => {
		const layout = settingsService.settings.tabLayout;
		document.body.classList.toggle(
			"layout-horizontal",
			layout === "horizontal"
		);
		document.body.classList.toggle("layout-bottom", layout === "bottom");
		document.body.classList.toggle("layout-compact", layout === "compact");
		const verticalTabs = layout === "hybrid" || layout === "vertical";
		document.body.classList.toggle("vertical-tabs", verticalTabs);
		document.body.classList.toggle("full-vertical-tabs", layout === "vertical");
		document.body.classList.toggle(
			"sidebar-left",
			settingsService.settings.verticalTabJustify === "left"
		);
		document.body.classList.toggle(
			"sidebar-right",
			settingsService.settings.verticalTabJustify === "right"
		);
	};

	applyLayout();

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleThemeChange = () => {
		if (settingsService.settings.appearance === "system") {
			applyTheme();
		}
	};

	mediaQuery.addEventListener("change", handleThemeChange);

	use(settingsService.settings.appearance).listen(applyTheme);
	use(settingsService.settings.themeId).listen(applyTheme);

	use(settingsService.settings.uiProfile).listen(applyProfile);
	use(settingsService.settings.roundness).listen(applyTweaks);
	use(settingsService.settings.tabStyle).listen(applyTweaks);
	use(settingsService.settings.iconSet).listen(applyTweaks);
	use(settingsService.settings.animations).listen(applyTweaks);
	use(settingsService.settings.tabLayout).listen(applyLayout);
	use(settingsService.settings.verticalTabJustify).listen(applyLayout);

	this.cx.mount = () => {
		applyTheme();
	};

	return (
		<div
			id="app"
			class={use(settingsService.settings.tabLayout).map((layout) =>
				[
					layout === "hybrid" || layout === "vertical" ? "vertical-tabs" : "",
					`layout-${layout}`,
				]
					.filter(Boolean)
					.join(" ")
			)}
		>
			{use(settingsService.settings.tabLayout).map((layout) =>
				layout === "hybrid" || layout === "vertical" ? (
					<Sidebar
						layout={layout}
						justify={use(settingsService.settings.verticalTabJustify)}
						tabs={use(tabsService.tabs)}
						activetab={use(tabsService.activetab)}
						sidebarWidth={use(
							settingsService.settings.tabLayout,
							settingsService.settings.sidebarWidth
						).map(([currentLayout, sidebarWidth]) =>
							getSidebarWidth(currentLayout, sidebarWidth)
						)}
						setSidebarWidth={(width: number) => {
							settingsService.settings.sidebarWidth = Math.round(width);
						}}
						addTab={() => {
							tabsService.newTab(
								new URL(`${INTERNAL_URL_PROTOCOL}//newtab`),
								true
							);
						}}
						destroyTab={(tab: Tab) => {
							tabsService.destroyTab(tab);
						}}
						topContent={
							layout === "hybrid" ? (
								<VerticalPinList
									tabs={use(tabsService.tabs)}
									activetab={use(tabsService.activetab)}
									destroyTab={(tab: Tab) => tabsService.destroyTab(tab)}
								/>
							) : (
								<div class="vertical-sidebar-header">
									<Omnibar tab={use(tabsService.activetab)} layout="vertical" />
									<VerticalPinList
										tabs={use(tabsService.tabs)}
										activetab={use(tabsService.activetab)}
										destroyTab={(tab: Tab) => tabsService.destroyTab(tab)}
									/>
									<div class="vertical-sidebar-bookmarks">
										<BookmarksStrip orientation="vertical" />
									</div>
								</div>
							)
						}
					/>
				) : layout === "compact" ? null : (
					<TabStrip
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
				)
			)}
			<div id="main">
				{use(settingsService.settings.tabLayout).map((layout) =>
					layout === "vertical" ? null : (
						<>
							<Omnibar
								tab={use(tabsService.activetab)}
								layout={layout === "compact" ? "compact" : "horizontal"}
							/>
							{use(
								tabsService.activetab.url,
								settingsService.settings.showBookmarksBar
							)
								.map(
									([u, pinned]) =>
										pinned || u.href === `${INTERNAL_URL_PROTOCOL}//newtab`
								)
								.and(<BookmarksStrip />)}
							<div class="separator"></div>
						</>
					)
				)}
				{this.children}
			</div>
		</div>
	);
}
App.style = css`
	:scope {
		background-color: var(--frame);
		--separator-color: color-mix(in srgb, currentColor 10%, transparent);
	}

	.separator {
		color: var(--toolbar);
		position: relative;
		top: -1px;

		/*box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);*/
		border-top: 1px solid var(--text-15);
	}

	:global(.vertical-sidebar-header) {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	:global(.vertical-sidebar-bookmarks) {
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--text-15);
	}
`;

const app = document.getElementById("app")!;

export let mountedResolve!: () => void;
export const mountedPromise = new Promise<void>((resolve) => {
	mountedResolve = resolve;
}).then(() => {
	mountedResolve = null!;
});

export async function mount(): Promise<HTMLElement> {
	try {
		let shell = <Shell />;
		let built = <App>{shell}</App>;
		app.replaceWith(built);

		built.addEventListener("contextmenu", (e) => {
			e.preventDefault();
		});

		mountedResolve();

		return built;
	} catch (e) {
		let err = e as any;
		app.replaceWith(
			document.createTextNode(
				`Error mounting: ${"message" in err ? err.message : err}`
			)
		);
		console.error(err);
		throw e;
	}
}
