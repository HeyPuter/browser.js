import type { FC } from "dreamland/core";
import { css } from "dreamland/core";
import { TabStrip } from "@components/TabStrip/TabStrip";
import { Tab } from "./Tab/Tab";
import { BookmarksStrip } from "@components/BookmarksStrip";
import { Omnibar } from "@components/Omnibar/Omnibar";
import { getTheme } from "./themes";
import { contexts } from "./proxy/scramjet";
import { INTERNAL_URL_PROTOCOL } from "./consts";
import { Shell } from "@components/Shell";
import { settingsService, tabsService } from ".";

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

	this.cx.mount = () => {
		applyTheme();
	};

	return (
		<div id="app">
			<TabStrip
				tabs={use(tabsService.tabs)}
				activetab={use(tabsService.activetab)}
				addTab={() => {
					tabsService.newTab(new URL(`${INTERNAL_URL_PROTOCOL}//newtab`), true);
				}}
				destroyTab={(tab: Tab) => {
					tabsService.destroyTab(tab);
				}}
			/>
			<Omnibar tab={use(tabsService.activetab)} />
			{use(tabsService.activetab.url, settingsService.settings.showBookmarksBar)
				.map(
					([u, pinned]) =>
						pinned || u.href === `${INTERNAL_URL_PROTOCOL}//newtab`
				)
				.and(<BookmarksStrip />)}
			<div class="separator"></div>
			{this.children}
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
