import type { ComponentContext } from "dreamland/core";
import { css } from "dreamland/core";
import { TabStrip } from "./components/TabStrip/TabStrip";
import { browser } from "./Browser";
import { Tab } from "./Tab";
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
		frame: "#1c1b22",
		tab_selected: "#42414d",
		tab_background_text: "white",
		toolbar: "#2b2a33",
		toolbar_text: "white",
		toolbar_field: "#1C1B22",
		toolbar_field_text: "white",
		icons: "white",
		ntp_background: "#121117",
		ntp_text: "white",

		// toolbar_text: "rgb(236, 191, 189)",
		// frame: "rgb(30, 30, 40)",
		// tab_background_text: "rgb(215, 218, 224)",
		// toolbar_field: "rgb(30, 30, 40)",
		// toolbar_field_text: "rgb(236, 191, 189)",
		// tab_line: "rgb(236, 191, 189)",
		// popup: "rgb(30, 30, 40)",
		// popup_text: "rgb(236, 191, 189)",
		// icons: "rgb(198, 170, 232)",
		// ntp_background: "rgb(21, 18, 28)",
		// ntp_text: "rgb(164, 185, 239)",
		// popup_border: "rgb(236, 191, 189)",
		// toolbar_top_separator: "rgb(30, 30, 40)",
		// tab_loading: "rgb(236, 191, 189)",
	};

	cx.mount = () => {
		for (const [key, value] of Object.entries(theme)) {
			document.body.style.setProperty(`--${key}`, value);
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
			<div class="separator"></div>
			{cx.children}
		</div>
	);
}
App.style = css`
	:scope {
		background-color: var(--toolbar);
		--separator-color: color-mix(in srgb, currentColor 10%, transparent);
	}
	.separator {
		color: var(--toolbar);
		/*border-bottom: 1px solid var(--separator-color);*/
	}
`;
