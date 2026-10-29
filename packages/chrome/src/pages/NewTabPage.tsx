import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { trimUrl } from "@components/Omnibar/utils";
import {
	AVAILABLE_SEARCH_ENGINES,
	resolveNavigation,
} from "@components/Omnibar/navigation";
import {
	fetchSuggestions,
	fetchTrendingSuggestions,
	type OmniboxResult,
} from "@components/Omnibar/suggestions";
import { Suggestion } from "@components/Omnibar/Suggestion";
import { Icon } from "@components/Icon";
import { iconSearch } from "../icons";
import { TopSiteButton, type TopSiteEntry } from "@components/TopSiteButton";
import { profileService, settingsService, tabsService } from "..";
import { browserIcon } from "../assets/icon";

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
		if (!url || seen.has(url.origin) || topSites.length >= MAX_TOP_SITES)
			return;

		const cleanTitle = title?.trim() || trimUrl(url);
		const displayTitle = getTopSiteTitle(title, url);
		topSites.push({
			url,
			title: cleanTitle,
			displayTitle,
			favicon: favicon || null,
			fallback: getTopSiteFallback(displayTitle, url),
		});
		seen.add(url.origin);
	};

	for (const entry of [...profileService.globalhistory].sort(
		(a, b) => b.timestamp - a.timestamp
	)) {
		addEntry(entry.url, entry.title, entry.favicon);
	}

	return topSites;
}

export function NewTabPage(
	this: FC<
		{ tab: Tab },
		{
			input: HTMLInputElement;
			active: boolean;
			focusindex: number;
			suggestions: OmniboxResult[];
		}
	>
) {
	const topSites = use(profileService.globalhistory).map(getTopSites);
	const listId = `${this.tab.id}-newtab-suggestions`;
	this.active = false;
	this.focusindex = -1;
	this.suggestions = [];
	let cancelSuggestions = () => {};
	let composing = false;

	const dismiss = () => {
		cancelSuggestions();
		this.active = false;
		this.focusindex = -1;
		this.suggestions = [];
	};
	const refreshSuggestions = () => {
		cancelSuggestions();
		this.focusindex = -1;
		if (!this.active || composing) return;
		const setResults = (results: OmniboxResult[]) => {
			const selected = this.suggestions[this.focusindex];
			this.suggestions = results.slice(0, 8);
			this.focusindex = selected
				? this.suggestions.findIndex(
						(item) => item.url.href === selected.url.href
					)
				: -1;
		};
		cancelSuggestions = this.input.value.trim()
			? fetchSuggestions(this.input.value, false, setResults)
			: fetchTrendingSuggestions(setResults);
	};
	const navigate = (url: URL, newTab = false) => {
		dismiss();
		if (newTab) tabsService.newTab(url);
		else this.tab.pushNavigate(url);
	};
	const expanded = use(this.active, this.suggestions).map(
		([active, suggestions]) => active && suggestions.length > 0
	);

	use(
		settingsService.settings.defaultSearchEngine,
		settingsService.settings.searchSuggestionsEnabled
	)
		.constrain(this)
		.listen(refreshSuggestions);
	use(this.tab.url.href, tabsService.activetab).constrain(this).listen(dismiss);

	return (
		<div>
			<div class="logo">
				<img src={browserIcon} alt="Browser.js Logo" width="56" height="56" />
				<h1>Browser</h1>
			</div>
			<div class="topbar">
				<div class="inputcontainercontainer" class:expanded={expanded}>
					<div class="inputcontainer">
						<div class="icon">
							<Icon icon={iconSearch}></Icon>
						</div>
						<input
							this={use(this.input)}
							aria-label="Search or enter address"
							role="combobox"
							aria-autocomplete="list"
							aria-expanded={expanded.map(String)}
							aria-controls={listId}
							aria-activedescendant={use(this.focusindex).map((index) =>
								index >= 0 ? `${listId}-${index}` : undefined
							)}
							autocomplete="off"
							spellcheck="false"
							on:focus={() => {
								this.active = true;
								refreshSuggestions();
							}}
							on:blur={dismiss}
							on:input={(e: InputEvent) => {
								if (e.isComposing || composing) return;
								this.active = true;
								refreshSuggestions();
							}}
							on:compositionstart={() => {
								composing = true;
								dismiss();
							}}
							on:compositionend={() => {
								composing = false;
								if (document.activeElement !== this.input) return;
								this.active = true;
								refreshSuggestions();
							}}
							on:keydown={(e: KeyboardEvent) => {
								if (e.isComposing || composing) return;
								if (e.key === "Escape") {
									e.preventDefault();
									dismiss();
								} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
									if (!this.active) {
										this.active = true;
										refreshSuggestions();
									}
									const length = this.suggestions.length;
									if (!length) return;
									e.preventDefault();
									this.focusindex =
										e.key === "ArrowDown"
											? (this.focusindex + 1) % length
											: (this.focusindex <= 0 ? length : this.focusindex) - 1;
									this.root
										.querySelector(`#${listId}-${this.focusindex}`)
										?.scrollIntoView({ block: "nearest" });
								} else if (e.key === "Enter") {
									e.preventDefault();
									const url =
										this.suggestions[this.focusindex]?.url ??
										resolveNavigation(
											this.input.value,
											settingsService.settings.defaultSearchEngine
										);
									if (url) navigate(url, e.altKey);
								}
							}}
							placeholder={use(
								settingsService.settings.defaultSearchEngine
							).map(
								(engine) =>
									`Search ${AVAILABLE_SEARCH_ENGINES[engine].name} or type a URL`
							)}
						></input>
					</div>
					{expanded.and(
						<div
							class="suggestions"
							id={listId}
							role="listbox"
							aria-label="Address suggestions"
							on:mousedown={(e: MouseEvent) => e.preventDefault()}
						>
							{use(this.suggestions)
								.map((items) => items.some((item) => item.kind === "trending"))
								.and(<div class="suggestions-heading">Trending searches</div>)}
							{use(this.suggestions).mapEach((item, index) => (
								<div
									id={`${listId}-${index}`}
									role="option"
									aria-selected={use(this.focusindex).map((selected) =>
										String(selected === index)
									)}
								>
									<Suggestion
										item={item}
										input={this.input}
										focused={use(this.focusindex).map(
											(selected) => selected === index
										)}
										onClick={(e: MouseEvent) =>
											navigate(item.url, e.ctrlKey || e.metaKey)
										}
									/>
								</div>
							))}
						</div>
					)}
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
		width: min(100%, 42rem);
		position: relative;
	}
	.inputcontainer {
		width: 100%;
		min-height: 3rem;
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-20);
		border-radius: var(--radius-xl);
		display: flex;
		align-items: center;
		transition:
			border-color 0.15s ease-out,
			box-shadow 0.15s ease-out,
			background-color 0.15s ease-out;
	}

	.icon {
		font-size: 1.15rem;
		padding-left: var(--space-xl);
		color: var(--field-text-50);
	}

	.inputcontainercontainer.expanded .inputcontainer {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		outline: none;
	}
	input {
		font-size: 1.05rem;
		outline: none;
		padding: var(--space-xl);
		flex: 1;
		height: 100%;
		background: none;
		border: none;
		color: var(--toolbar_field_text);
		font-family: var(--font);
		min-width: 0;
	}

	.suggestions {
		position: absolute;
		top: calc(100% - 1px);
		left: 0;
		width: 100%;
		z-index: 2;
		max-height: min(26rem, 50vh);
		overflow-y: auto;
		padding-top: var(--space-sm);
		padding-bottom: var(--space-md);
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-20);
		border-radius: 0 0 var(--radius-xl) var(--radius-xl);
		box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
	}

	.suggestions-heading {
		padding: var(--space-sm) var(--space-xl);
		color: var(--field-text-60);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	input::placeholder {
		color: var(--field-text-60);
	}

	.main {
		margin-top: var(--space-xl);
		width: min(100%, 62rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-xl);
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

	:global(.roundness-round *) > :scope .tile {
		border-radius: 50%;
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
