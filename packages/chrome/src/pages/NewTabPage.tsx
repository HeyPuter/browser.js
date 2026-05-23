import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { trimUrl } from "@components/Omnibar/utils";
import { Icon } from "@components/Icon";
import { iconSearch } from "../icons";
import { TopSiteButton, type TopSiteEntry } from "@components/TopSiteButton";
import { profileService, tabsService } from "..";

const MAX_TOP_SITES = 8;

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

	return (
		<div>
			<div class="logo">
				<img src="/icon.png" alt="Browser.js Logo" width="56" height="56" />
				<h1>Browser</h1>
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
							<TopSiteButton entry={entry}></TopSiteButton>
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

	@media (max-width: 720px) {
		:scope {
			padding-top: 1.25rem;
		}

		.top-sites-list {
			grid-template-columns: repeat(auto-fit, minmax(6.25rem, 6.25rem));
		}
	}
`;
