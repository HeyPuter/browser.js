import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { trimUrl } from "@components/Omnibar/utils";
import { createMenu } from "@components/Menu";
import { Icon } from "@components/Icon";
import { iconLink, iconMore, iconOpen, iconSearch } from "../icons";
import { Favicon } from "@components/Favicon";
import { profileService, tabsService } from "..";

const MAX_TOP_SITES = 8;

type TopSiteEntry = {
	url: URL;
	title: string;
	displayTitle: string;
	favicon: string | null;
	fallback: string;
};

function getTopSiteFallback(title: string, url: URL) {
	const source = (title || url.hostname || trimUrl(url))
		.replace(/^www\./, "")
		.trim();

	return source.charAt(0).toUpperCase() || "?";
}

function getTopSiteTitle(title: string | null | undefined, url: URL) {
	const trimmedTitle = title?.trim();

	if (trimmedTitle && !/^https?:\/\//i.test(trimmedTitle)) {
		return trimmedTitle;
	}

	if (url.hostname) {
		const hostname = url.hostname.replace(/^www\./, "");
		const pathname = url.pathname.replace(/\/$/, "");

		return pathname && pathname !== "/" ? `${hostname}${pathname}` : hostname;
	}

	return trimUrl(url);
}

function getTopSites(): TopSiteEntry[] {
	const topSites: TopSiteEntry[] = [];
	const seen = new Set<string>();

	const addEntry = (
		url: URL | null | undefined,
		title: string | null | undefined,
		favicon: string | null | undefined
	) => {
		if (!url || seen.has(url.href) || topSites.length >= MAX_TOP_SITES) return;

		const cleanTitle = title?.trim() || trimUrl(url);
		const displayTitle = getTopSiteTitle(title, url);
		topSites.push({
			url,
			title: cleanTitle,
			displayTitle,
			favicon: favicon || null,
			fallback: getTopSiteFallback(displayTitle, url),
		});
		seen.add(url.href);
	};

	for (const entry of [...profileService.globalhistory].sort(
		(a, b) => b.timestamp - a.timestamp
	)) {
		addEntry(entry.url, entry.title, entry.favicon);
	}

	return topSites;
}

export function NewTabPage(this: FC<{ tab: Tab }>) {
	const topSites = use(profileService.globalhistory).map(getTopSites);

	const openTopSiteMenu = (event: MouseEvent, entry: TopSiteEntry) => {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();

		createMenu({ left: rect.right, top: rect.bottom + 4 }, [
			{
				label: "Open",
				icon: iconLink,
				action: () => tabsService.activetab.pushNavigate(entry.url),
			},
			{
				label: "Open in New Tab",
				icon: iconOpen,
				action: () => tabsService.newTab(entry.url),
			},
		]);

		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<div>
			<div class="logo">
				<img src="/icon.png" alt="Browser.js Logo" width="56" height="56" />
				<h1>Browser.js</h1>
			</div>
			<div class="topbar">
				<div class="inputcontainercontainer">
					<div class="inputcontainer">
						<div class="icon">
							<Icon icon={iconSearch}></Icon>
						</div>
						<input
							on:keydown={(e: KeyboardEvent) => {
								if (e.key === "Enter") {
									e.preventDefault();
									tabsService.searchNavigate(
										(e.target as HTMLInputElement).value
									);
								}
							}}
							placeholder="Search Google or type A URL"
						></input>
					</div>
				</div>
				{/*<div class="clock">
					{new Date().toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</div>*/}
			</div>
			<div class="main">
				<section class="top-sites" aria-label="Favorites and frequent sites">
					<ul class="top-sites-list">
						{topSites.mapEach((entry) => (
							<li class="top-site-outer">
								<div
									class="top-site-inner"
									on:contextmenu={(e: MouseEvent) => openTopSiteMenu(e, entry)}
								>
									<button
										class="top-site-button"
										title={entry.title}
										on:click={() => tabsService.newTab(entry.url)}
									>
										<div class="tile" aria-hidden="true">
											<div
												class="icon-wrapper"
												class:has-favicon={!!entry.favicon}
											>
												{entry.favicon ? (
													<Favicon
														iconUrl={entry.favicon}
														domain={entry.url.hostname}
														size="unset"
													></Favicon>
												) : (
													<span class="fallback">{entry.fallback}</span>
												)}
											</div>
										</div>
										<div class="title">
											<span class="title-label">{entry.displayTitle}</span>
										</div>
										<button
											class="context-menu-button"
											title={`Open context menu for ${entry.title}`}
											aria-label={`Open context menu for ${entry.title}`}
											on:click={(e: MouseEvent) => openTopSiteMenu(e, entry)}
										>
											<Icon icon={iconMore} width="1rem" height="1rem"></Icon>
										</button>
									</button>
								</div>
							</li>
						))}
					</ul>
				</section>
			</div>
		</div>
	);
}
NewTabPage.style = css`
	:scope {
		--top-site-column-size: 6.3rem;
		--top-site-tile-size: 4.25rem;
		--top-site-icon-size: 48px;

		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: var(--font);
		background: var(--ntp_background);
		color: var(--ntp_text);

		padding: clamp(4rem, 5vw, 6rem) clamp(1.25rem, 4vw, 4rem) 3rem;
		overflow-y: auto;
	}

	.topbar {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
	}
	.logo {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}
	.logo h1 {
		font-size: 2.25rem;
		font-weight: 600;
		user-select: none;
	}
	.logo img {
		display: inline-block;
		user-select: none;
	}
	.clock {
		font-size: 1.5em;
		font-weight: bold;
		min-width: 4em;
		text-align: center;
	}

	.inputcontainercontainer {
		width: 100%;
		display: flex;
		justify-content: center;
	}
	.inputcontainer {
		width: min(100%, 42rem);
		min-height: 3rem;
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-20);
		border-radius: calc(var(--radius) * 2);
		display: flex;
		align-items: center;
		transition:
			border-color 0.15s ease-out,
			box-shadow 0.15s ease-out,
			background-color 0.15s ease-out;
	}

	.icon {
		font-size: 1.15rem;
		padding-left: 1rem;
		color: var(--field-text-50);
	}

	.inputcontainer:focus-within {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 2px var(--accent-20);
		outline: none;
	}
	input {
		font-size: 1.05rem;
		outline: none;
		padding: 1em;
		padding-top: 0.9em;
		padding-bottom: 0.9em;
		flex: 1;
		height: 100%;
		background: none;
		border: none;
		color: var(--toolbar_field_text);
		font-family: var(--font);
	}

	input::placeholder {
		color: var(--field-text-60);
	}

	.main {
		margin-top: 1rem;
		width: min(100%, 62rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.top-sites {
		width: 100%;
		display: flex;
		justify-content: center;
	}

	.top-sites-list {
		width: 100%;
		max-width: calc(var(--top-site-column-size) * 8 + 7 * 1rem);
		display: grid;
		grid-template-columns: repeat(
			auto-fit,
			minmax(
				min(var(--top-site-column-size), 100%),
				var(--top-site-column-size)
			)
		);
		justify-content: center;
		justify-items: center;
		gap: 1.35rem 1rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.top-site-outer {
		width: 100%;
		max-width: var(--top-site-column-size);
	}

	.top-site-inner {
		position: relative;
		width: 100%;
	}

	.top-site-button {
		width: 100%;
		min-width: 0;
		padding: 0.6rem 0.5rem;
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		justify-items: center;
		border-radius: calc(var(--radius) * 2);
		transition:
			background-color 0.12s ease-out,
			color 0.12s ease-out;
	}

	.top-site-button:hover {
		background: var(--ntp-text-5);
	}

	.top-site-button:active {
		background: var(--ntp-text-10);
	}

	.tile {
		width: var(--top-site-tile-size);
		height: var(--top-site-tile-size);
		margin: auto;
		margin-top: 0.75rem;
		align-self: end;
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-15);
		border-radius: calc(var(--radius) * 2);
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background 120ms ease-out,
			border-color 120ms ease-out;
	}

	.top-site-outer:is(:hover, :focus-within) .tile {
		background: color-mix(in srgb, var(--toolbar_field) 82%, var(--text-8));
		border-color: var(--ntp-text-20);
	}

	.top-site-button:focus-visible .tile {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 2px var(--accent-20);
		outline: none;
	}

	.icon-wrapper {
		width: var(--top-site-icon-size);
		height: var(--top-site-icon-size);
		border-radius: calc(var(--radius) * 1.5);
		background: var(--accent-15);
		color: var(--accent-tint-50);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.icon-wrapper.has-favicon {
		background: var(--text-10);
		color: inherit;
	}

	.icon-wrapper img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.fallback {
		line-height: 1;
		user-select: none;
	}

	.context-menu-button {
		position: absolute;
		top: 0.5rem;
		right: 0.3rem;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--text-20);
		border-radius: 999px;
		background: var(--toolbar_field);
		color: var(--text-60);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 100ms ease-out,
			background 100ms ease-out,
			border-color 100ms ease-out;
	}

	.top-site-outer:is(:hover, :focus-within) .context-menu-button {
		opacity: 1;
	}

	.context-menu-button:hover,
	.context-menu-button:focus-visible {
		background: var(--popup);
		border-color: var(--text-30);
		opacity: 1;
	}

	.title {
		width: 100%;
		min-width: 0;
		padding-block: 0.2rem;
		padding-inline: 0.15rem;
		display: flex;
		justify-content: center;
		text-align: center;
	}

	.title-label {
		display: block;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.88rem;
		line-height: 1.25;
		color: var(--ntp-text-70);
		user-select: none;
	}

	@media (max-width: 720px) {
		:scope {
			padding-top: 1.25rem;
		}

		.top-sites-list {
			grid-template-columns: repeat(auto-fit, minmax(6.25rem, 6.25rem));
		}

		.top-site-outer {
			max-width: 6.25rem;
		}

		.top-site-button {
			grid-template-rows: 6.25rem auto;
		}
	}
`;
