import type { ComponentContext } from "dreamland/core";
import { css } from "dreamland/core";
import { TabStrip } from "./components/TabStrip/TabStrip";
import { browser } from "./Browser";
import { Tab } from "./Tab";
import { BookmarksStrip } from "./components/BookmarksStrip";
import { Omnibar } from "./components/Omnibar/Omnibar";
import { getTheme } from "./themes";
import { contexts } from "./proxy/scramjet";

export function App(props: {}, cx: ComponentContext) {
	const applyTheme = () => {
		const appearance = browser.settings.appearance;
		const themeId = browser.settings.themeId;
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

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleThemeChange = () => {
		if (browser.settings.appearance === "system") {
			applyTheme();
		}
	};

	mediaQuery.addEventListener("change", handleThemeChange);

	use(browser.settings.appearance).listen(applyTheme);
	use(browser.settings.themeId).listen(applyTheme);

	cx.mount = () => {
		applyTheme();
	};

	return (
		<div id="app">
			<TabStrip
				tabs={use(browser.tabs)}
				activetab={use(browser.activetab)}
				addTab={() => {
					browser.newTab(new URL("puter://newtab"), true);
				}}
				destroyTab={(tab: Tab) => {
					browser.destroyTab(tab);
				}}
			/>
			<Omnibar tab={use(browser.activetab)} />
			{use(browser.activetab.url, browser.settings.showBookmarksBar)
				.map(([u, pinned]) => pinned || u.href === "puter://newtab")
				.andThen(<BookmarksStrip />)}
			<div class="separator"></div>
			{cx.children}
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
`;
