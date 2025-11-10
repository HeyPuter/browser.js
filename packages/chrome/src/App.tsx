import type { ComponentContext } from "dreamland/core";
import { TabStrip } from "./components/TabStrip/TabStrip";
import { browser } from "./Browser";
import type { Tab } from "./Tab";
import { BookmarksStrip } from "./components/BookmarksStrip";
import { Omnibar } from "./components/Omnibar/Omnibar";

export function App(props: {}, cx: ComponentContext) {
	const applyTheme = () => {
		let theme = browser.settings.theme;

		if (theme === "system") {
			const prefersDark = window.matchMedia(
				"(prefers-color-scheme: dark)"
			).matches;
			document.body.classList.toggle("light-mode", !prefersDark);
		} else {
			document.body.classList.toggle("light-mode", theme === "light");
		}
	};

	applyTheme();

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
	const handleThemeChange = () => {
		if (browser.settings.theme === "system") {
			applyTheme();
		}
	};

	mediaQuery.addEventListener("change", handleThemeChange);

	use(browser.settings.theme).listen(applyTheme);

	const theme = {
		colors: {
			frame: [81, 111, 163],
			toolbar: [145, 168, 208],
			ntp_background: [131, 156, 200],
			tab_text: [27, 43, 70],
			bookmark_text: [27, 43, 70],
			tab_background_text: [255, 255, 255],
			ntp_text: [27, 43, 70],
		},
		tints: {
			buttons: [0.6, 1, 0.2],
			frame_incognito: [0.6, 0.5, 0.25],
		},
	};

	cx.mount = () => {
		for (const [key, value] of Object.entries(theme.colors)) {
			cx.root.style.setProperty(`--${key}`, `rgb(${value.join(",")})`);
		}
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
			<div style="border-bottom: 1px solid var(--bg20)"></div>
			{cx.children}
		</div>
	);
}
