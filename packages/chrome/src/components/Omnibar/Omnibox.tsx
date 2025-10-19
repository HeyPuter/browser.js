import {
	createDelegate,
	createState,
	css,
	type ComponentContext,
	type Delegate,
} from "dreamland/core";
import { iconSearch, iconForwards, iconTrendingUp } from "../../icons";
import { Icon } from "../Icon";
import { OmnibarButton } from "./OmnibarButton";
import { setContextMenu } from "../Menu";
import { defaultFaviconUrl } from "../../assets/favicon";
import { browser } from "../../Browser";
import { emToPx, splitUrl } from "../../utils";
import {
	fetchGoogleTrending,
	fetchSuggestions,
	trendingCached,
	type OmniboxResult,
	type TrendingQuery,
} from "./suggestions";
import { trimUrl } from "./utils";
import { BookmarkButton } from "./BookmarkButton";
import { SiteOptionsButton } from "./SiteOptionsButton";
import { Favicon } from "../Favicon";
import { UrlInput } from "./UrlInput";
import { Suggestion } from "./Suggestion";
import { CircularProgress } from "./CircularProgress";

export const focusOmnibox = createDelegate<void>();

export function InactiveBar(s: { subtle: boolean; active: boolean }) {
	return <div class:subtle={use(s.subtle)} class:active={use(s.active)}></div>;
}
InactiveBar.style = css`
	:scope {
		background: var(--bg);
		width: 100%;
		border: none;
		outline: none;
		border-radius: 4px;
		margin: 0.25em;
	}

	:scope.subtle.active {
		border: 1px solid var(--accent);
	}
`;

export function Omnibox(
	this: {
		value: string;
		active: boolean;
		justselected: boolean;
		subtleinput: boolean;
		focusindex: number;
		searchSuggestions: OmniboxResult[];
		trendingSuggestions: OmniboxResult[];
		input: HTMLInputElement;
	},
	s: {
		url: URL;
		selectContent: Delegate<void>;
	},
	cx: ComponentContext
) {
	this.focusindex = 0;
	this.searchSuggestions = [];
	this.value = "";
	this.trendingSuggestions = [];

	cx.mount = () => {
		setContextMenu(cx.root, [
			{
				label: "Select All",
				action: () => {
					s.selectContent();
				},
			},
		]);

		fetchGoogleTrending();
		setTimeout(() => {
			fetchGoogleTrending();
		}, 1000);
	};

	focusOmnibox.listen(() => {
		setTimeout(() => {
			activate();
			this.subtleinput = true;
		}, 10);
	});

	let timeout: number | null = null;
	use(this.value).listen(() => {
		if (!this.value) {
			this.searchSuggestions = [];
			return;
		}

		// if the user is actually trying to search something we can kill the trending suggestions
		this.trendingSuggestions = [];

		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(
			() =>
				fetchSuggestions(this.value, (results) => {
					this.searchSuggestions = results;
				}),
			100
		);
	});

	const activate = () => {
		this.subtleinput = false;
		this.active = true;
	};

	const deactivate = () => {
		this.active = false;
		this.subtleinput = false;
	};

	const doSearch = () => {
		// If nothing in input, do nothing
		if (!this.value) return;

		let url: URL;
		try {
			url = new URL(this.value);
		} catch {
			// Treat as search
			url = new URL(
				"https://www.google.com/search?q=" + encodeURIComponent(this.value)
			);
		}

		browser.newTab(url);
		deactivate();
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.stopPropagation();
			e.preventDefault();
			doSearch();
		} else if (e.key === "Escape") {
			deactivate();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			this.focusindex = Math.min(
				this.focusindex + 1,
				Math.max(0, this.searchSuggestions.length - 1)
			);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.focusindex = Math.max(this.focusindex - 1, 0);
		}
	};

	const onKeyUp = (e: KeyboardEvent) => {
		// noop for now
	};

	const onInput = (e: InputEvent) => {
		this.value = (e.target as HTMLInputElement).value;
	};

	const handleFocus = (inputEl: HTMLInputElement) => {
		this.input = inputEl;
	};

	// Render helpers
	const renderLeft = () => {
		return (
			<div class="left">
				<div class="left-inner">
					{use(this.value).map((v) =>
						!v ? (
							<Icon icon={iconSearch} />
						) : (
							<OmnibarButton
								icon={iconForwards}
								click={() => {
									doSearch();
								}}
							></OmnibarButton>
						)
					)}
				</div>
			</div>
		);
	};

	return (
		<div class={`omnibox ${use(this.active).map((a) => (a ? "active" : ""))}`}>
			<div class="center">
				<InactiveBar subtle={use(this.subtleinput)} active={use(this.active)} />
				<UrlInput
					active={use(this.active)}
					favicon={use(s.url).map((u) => (u ? u.icon || null : null))}
					url={use(s.url)}
					value={use(this.value)}
					input={use(this.input)}
					onkeydown={onKeyDown}
					onkeyup={onKeyUp}
					oninput={onInput}
					doSearch={doSearch}
				></UrlInput>
				<div class="controls">
					{use(this.active)
						.map((a) => !a)
						.andThen(<BookmarkButton url={use(s.url)}></BookmarkButton>)}
					{use(this.active).andThen(
						<OmnibarButton
							click={(e: MouseEvent) => {
								doSearch();
								e.stopPropagation();
								e.preventDefault();
							}}
							icon={iconForwards}
						></OmnibarButton>
					)}
				</div>
			</div>

			{use(this.searchSuggestions).map((list) =>
				list.length ? (
					<div class="suggestions">
						{use(this.searchSuggestions).mapEach((item, i) => (
							<Suggestion
								item={item}
								input={use(this.input)}
								focused={use(this.focusindex).map((f) => f === i)}
								onClick={() => {
									if (item.kind === "search") {
										this.value = item.text;
									} else {
										browser.newTab(item.url);
										deactivate();
									}
								}}
							></Suggestion>
						))}
					</div>
				) : null
			)}

			{use(this.trendingSuggestions).map((list) =>
				list.length ? (
					<div class="trending">
						<div class="header">
							<Icon icon={iconTrendingUp} />
							<span>Trending</span>
						</div>
						{use(this.trendingSuggestions).mapEach((item) => (
							<div class="trend" on:click={() => browser.newTab(item.url)}>
								<Favicon url={item.favicon || defaultFaviconUrl}></Favicon>
								<span class="trend-text">{item.title}</span>
							</div>
						))}
					</div>
				) : null
			)}
		</div>
	);
}
Omnibox.style = css`
	:scope {
		position: relative;
		font-family: var(--font);
	}
	.center {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.omnibox {
		width: 100%;
	}
	.controls {
		position: absolute;
		right: 0.5em;
		display: flex;
		gap: 0.5em;
		align-items: center;
	}
	.suggestions {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: var(--bg02);
		border: 1px solid var(--fg4);
		border-radius: 4px;
		margin-top: 0.5em;
		z-index: 10;
	}
	.trending {
		margin-top: 0.5em;
	}
	.trending .header {
		display: flex;
		align-items: center;
		gap: 0.5em;
		padding: 0.5em;
		border-bottom: 1px solid var(--fg4);
	}
	.trend {
		display: flex;
		align-items: center;
		gap: 0.5em;
		padding: 0.5em;
		cursor: pointer;
	}
`;
