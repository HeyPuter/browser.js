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

export const focusOmnibox = createDelegate<void>();

function InactiveBar(props: { subtle: boolean; active: boolean }) {
	return (
		<div
			class:subtle={use(props.subtle)}
			class:active={use(props.active)}
		></div>
	);
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
		realvalue: string;
		active: boolean;
		justselected: boolean;
		subtleinput: boolean;
		focusindex: number;
		searchSuggestions: OmniboxResult[];
		trendingSuggestions: OmniboxResult[];
		input: HTMLInputElement;

		suggestionDenied: boolean;
	},
	props: {
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
					props.selectContent();
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

	use(this.realvalue).listen(() => {
		if (!this.realvalue) {
			this.searchSuggestions = [];
			return;
		}

		// if the user is actually trying to search something we can kill the trending suggestions
		this.trendingSuggestions = [];

		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => {
			fetchSuggestions(this.realvalue, this.suggestionDenied, (results) => {
				this.searchSuggestions = results;

				const firstResult = results[0];
				if (!firstResult) return;
				if (firstResult.kind === "search") {
					if (!firstResult.title) return;
					if (this.realvalue.length >= firstResult.title.length) return;
					if (
						!firstResult.title
							.toLowerCase()
							.startsWith(this.realvalue.toLowerCase())
					)
						return;

					let currentCursor = this.input.selectionStart || 0;

					this.input.setSelectionRange(
						currentCursor,
						currentCursor + firstResult.title.length
					);
					this.value = firstResult.title;
					this.input.setSelectionRange(
						currentCursor,
						currentCursor + firstResult.title.length
					);
				} else {
					if (!firstResult.url) return;

					// todo support http:example.com
					const normalizedUrl =
						this.realvalue.startsWith("http://") ||
						this.realvalue.startsWith("https://")
							? firstResult.url.href
							: trimUrl(firstResult.url);
					if (this.realvalue.length >= normalizedUrl.length) return;
					if (
						!normalizedUrl
							.toLowerCase()
							.startsWith(this.realvalue.toLowerCase())
					)
						return;

					let currentCursor = this.input.selectionStart || 0;

					this.input.setSelectionRange(
						currentCursor,
						currentCursor + normalizedUrl.length
					);
					this.value = normalizedUrl;
					this.input.setSelectionRange(
						currentCursor,
						currentCursor + normalizedUrl.length
					);
				}
			});
			this.suggestionDenied = false;
		}, 100);
	});

	const activate = () => {
		this.subtleinput = false;
		this.active = true;
		browser.unfocusframes = true;

		const handleClickOutside = (e: MouseEvent) => {
			this.active = false;
			browser.unfocusframes = false;
			e.preventDefault();

			document.body.removeEventListener("click", handleClickOutside);
			document.body.removeEventListener("auxclick", handleClickOutside);
		};

		document.body.addEventListener("click", handleClickOutside);
		document.body.addEventListener("auxclick", handleClickOutside);

		if (props.url.href == "puter://newtab") {
			this.value = "";
		} else {
			this.value = trimUrl(props.url);
		}

		this.input.focus();
		this.input.select();
		this.justselected = true;
		this.input.scrollLeft = 0;

		fetchGoogleTrending().then(() => {
			// pick a random 3 from the cache
			this.trendingSuggestions = trendingCached!
				.sort(() => 0.5 - Math.random())
				.slice(0, 3)
				.map((t) => ({
					kind: "trending",
					title: t.title,
					url: new URL(
						`https://www.google.com/search?q=${encodeURIComponent(t.title)}`
					),
					favicon: "https://www.google.com/favicon.ico",
				}));
		});
	};

	const navTo = (url: URL) => {
		browser.activetab.pushNavigate(url);
		this.active = false;
		this.input.blur();
	};

	const doSearch = () => {
		const selected =
			this.focusindex < this.searchSuggestions.length
				? this.searchSuggestions[this.focusindex]
				: this.trendingSuggestions[
						this.focusindex - this.searchSuggestions.length
					];
		navTo(selected.url);
	};

	props.selectContent.listen(() => {
		activate();
	});

	const overflowlength = () =>
		this.searchSuggestions.length + this.trendingSuggestions.length;

	const updateValue = () => {
		const focused =
			this.focusindex < this.searchSuggestions.length
				? this.searchSuggestions[this.focusindex]
				: this.trendingSuggestions[
						this.focusindex - this.searchSuggestions.length
					];
		this.value =
			focused.kind === "search" ||
			focused.kind === "trending" ||
			focused.kind === "directsearch"
				? focused.title!
				: focused.url!.href;
	};

	return (
		<div
			on:click={(e: MouseEvent) => {
				if (this.active) {
					e.preventDefault();
					e.stopPropagation();
					return;
				}
				activate();
				e.stopPropagation();
			}}
			class:subtle={use(this.subtleinput)}
			class:active={use(this.active)}
		>
			<InactiveBar
				subtle={use(this.subtleinput)}
				active={use(this.active)}
			></InactiveBar>
			<div
				class="overflow"
				class:active={use(this.active, this.subtleinput).map(
					([a, s]) => a && !s
				)}
			>
				<div class="spacer"></div>
				{use(this.searchSuggestions).mapEach((item) => (
					<Suggestion
						onClick={() => navTo(item.url)}
						input={this.input}
						item={item}
						focused={use(this.focusindex).map(
							(i) => i === this.searchSuggestions.indexOf(item)
						)}
					></Suggestion>
				))}
				{use(this.trendingSuggestions)
					.map((s) => s.length > 0)
					.andThen(<div class="spacertext">Trending Searches</div>)}
				{use(this.trendingSuggestions).mapEach((item) => (
					<Suggestion
						item={item}
						input={this.input}
						onClick={() => navTo(item.url)}
						focused={use(this.focusindex).map(
							(i) =>
								i ===
								this.searchSuggestions.length +
									this.trendingSuggestions.indexOf(item)
						)}
					></Suggestion>
				))}
			</div>

			<UrlInput
				active={use(this.active)}
				input={use(this.input)}
				url={use(props.url)}
				value={use(this.value)}
				favicon={use(this.focusindex, this.searchSuggestions).map(() =>
					this.focusindex > 0 &&
					this.searchSuggestions.length > 0 &&
					this.focusindex < this.searchSuggestions.length
						? this.searchSuggestions[this.focusindex].favicon
						: null
				)}
				doSearch={doSearch}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						let idx = this.focusindex + 1;
						if (idx >= overflowlength()) {
							idx = 0;
						}
						this.focusindex = idx;
						updateValue();
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						let idx = this.focusindex - 1;
						if (idx < 0) {
							idx = overflowlength() - 1;
						}
						this.focusindex = idx;
						updateValue();
					}
					if (e.key === "Enter") {
						e.preventDefault();
						doSearch();
					}
				}}
				onkeyup={(e: KeyboardEvent) => {
					if (!this.justselected) return;

					// if the user didn't modify anything
					if (this.input.value == trimUrl(props.url)) {
						// insert the untrimmed version
						this.input.value = props.url.href;
					}

					if (e.key == "ArrowLeft") {
						// move the cursor to the start
						if (props.url.protocol == "puter:") {
							this.input.setSelectionRange(0, 0);
						} else {
							let schemelen = props.url.protocol.length + 2;
							this.input.setSelectionRange(schemelen, schemelen);
						}
					}

					this.justselected = false;
				}}
				oninput={(e: InputEvent) => {
					this.subtleinput = false;

					if (e.inputType === "deleteContentBackward") {
						this.suggestionDenied = true;
					} else {
						this.suggestionDenied = false;
					}
					this.focusindex = 0;

					this.realvalue = this.value;
				}}
			></UrlInput>
		</div>
	);
}

Omnibox.style = css`
	:scope {
		position: relative;
		flex: 1;
		display: flex;
		height: 100%;
	}

	.result-icon {
		align-self: start;
		margin-top: 0.4em;
	}

	.favicon {
		width: 16px;
		height: 16px;
	}

	.overflow {
		position: absolute;
		display: none;
		background: var(--bg02);
		width: 100%;
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--fg5);
		padding-bottom: 0.5em;
	}
	.overflow .spacer {
		display: block;
		height: 2.5em;

		width: 98%;
		margin: 0 auto;

		border-bottom: 1px solid var(--fg5);
	}

	.spacertext {
		display: block;
		height: 2em;
		line-height: 2.5em;
		padding-left: 1.5em;
		color: var(--fg3);
		font-size: 0.9em;
	}


	.overflow.active {
		display: block;
	}
}
`;
