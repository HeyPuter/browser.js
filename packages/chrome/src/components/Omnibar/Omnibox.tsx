import { createDelegate, css, type FC, type Delegate } from "dreamland/core";
import { setContextMenu } from "@components/Menu";
import { INTERNAL_URL_PROTOCOL } from "../../consts";
import {
	fetchGoogleTrending,
	fetchSuggestions,
	trendingCached,
	type OmniboxResult,
} from "./suggestions";
import { trimUrl } from "./utils";
import { UrlInput } from "@components/Omnibar/UrlInput";
import { Suggestion } from "@components/Omnibar/Suggestion";
import { requestUnfocusFrames } from "@components/Shell";
import { tabsService, settingsService } from "../..";
import { resolveNavigation } from "./navigation";

export const focusOmnibox = createDelegate<void>();

function InactiveBar(this: FC<{ subtle: boolean; active: boolean }>) {
	return (
		<div class:subtle={use(this.subtle)} class:active={use(this.active)}></div>
	);
}
InactiveBar.style = css`
	:scope {
		background: var(--toolbar_field);
		width: 100%;
		border: none;
		outline: none;
		border-radius: var(--radius-md);
		margin: 0.25em;
	}

	/* At the roundest end of the scale the address bar goes fully pill-shaped,
	   as Chromium's omnibox does. */
	:global(.roundness-round *) > :scope {
		border-radius: 9999px;
	}

	:scope.subtle.active {
		border: 1px solid var(--tab_line);
	}
`;

export function Omnibox(
	this: FC<
		{
			url: URL;
			selectContent: Delegate<void>;
			layout?: "horizontal" | "vertical";
		},
		{
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
		}
	>
) {
	this.focusindex = 0;
	this.searchSuggestions = [];
	this.value = "";
	this.realvalue = "";
	this.active = false;
	this.trendingSuggestions = [];

	const [lock, unlock] = requestUnfocusFrames();
	let cancelSuggestions = () => {};
	const deactivate = () => {
		cancelSuggestions();
		unlock();
		this.active = false;
		document.body.removeEventListener("click", handleClickOutside);
		document.body.removeEventListener("auxclick", handleClickOutside);
	};
	const handleClickOutside = () => deactivate();

	this.cx.mount = () => {
		setContextMenu(this.root, [
			{
				label: "Select All",
				action: () => {
					this.selectContent();
				},
			},
		]);
	};

	focusOmnibox.listen(() => {
		setTimeout(() => {
			if (!this.root.isConnected) return;
			activate();
			this.subtleinput = true;
		}, 10);
	});

	use(this.realvalue).listen(() => {
		cancelSuggestions();
		if (!this.realvalue) {
			this.searchSuggestions = [];
			return;
		}
		this.trendingSuggestions = [];
		const denied = this.suggestionDenied;
		cancelSuggestions = fetchSuggestions(this.realvalue, denied, (results) => {
			this.searchSuggestions = results;
			if (this.focusindex >= results.length) this.focusindex = 0;
			const first = results[0];
			if (!first || denied || !this.active || this.focusindex !== 0) return;
			const cursor = this.input.selectionStart;
			if (
				cursor !== this.realvalue.length ||
				this.input.selectionEnd !== cursor
			)
				return;
			const completion =
				first.kind === "search"
					? first.title
					: this.realvalue.startsWith("https://")
						? first.url.href
						: trimUrl(first.url);
			if (
				!completion ||
				completion.length <= this.realvalue.length ||
				!completion.toLowerCase().startsWith(this.realvalue.toLowerCase())
			)
				return;
			this.value = completion;
			this.input.setSelectionRange(cursor, completion.length);
		});
		this.suggestionDenied = false;
	});

	use(
		settingsService.settings.searchSuggestionsEnabled,
		settingsService.settings.defaultSearchEngine
	).listen(() => {
		cancelSuggestions();
		this.trendingSuggestions = [];
		this.realvalue = this.realvalue;
	});

	use(this.url.href).listen(() => {
		deactivate();
		// when the url changes, clear whatever text the user might have had in the search box
		this.value = "";
		// also set realvalue to clear the search results
		this.realvalue = "";
	});

	const activate = () => {
		this.subtleinput = false;
		if (!this.active) lock();
		this.active = true;

		// empty value == just represent the url
		if (this.value == "") {
			if (this.url.href != `${INTERNAL_URL_PROTOCOL}//newtab`) {
				this.value = this.url.href;
			}
		}

		document.body.addEventListener("click", handleClickOutside);
		document.body.addEventListener("auxclick", handleClickOutside);

		this.input.focus();
		this.input.select();
		this.justselected = true;
		this.input.scrollLeft = 0;

		if (this.url.href === `${INTERNAL_URL_PROTOCOL}//newtab`) {
			// don't clutter the results if not on a newtab page
			fetchGoogleTrending().then(() => {
				// pick a random 3 from the cache
				if (
					!this.active ||
					this.realvalue ||
					!settingsService.settings.searchSuggestionsEnabled ||
					settingsService.settings.defaultSearchEngine !== "google"
				)
					return;
				this.trendingSuggestions = [...(trendingCached ?? [])]
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
		} else {
			this.trendingSuggestions = [];
		}
	};

	const navTo = (url: URL, newTab = false) => {
		deactivate();
		if (newTab) tabsService.newTab(url);
		else tabsService.activetab.pushNavigate(url);
	};

	const doSearch = (newTab = false) => {
		if (!this.value.trim()) return;
		const selected = [...this.searchSuggestions, ...this.trendingSuggestions][
			this.focusindex
		];
		const url =
			selected?.url ??
			resolveNavigation(
				this.value,
				settingsService.settings.defaultSearchEngine
			);
		if (url) navTo(url, newTab);
	};

	this.selectContent.listen(() => {
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
		if (!focused) return;
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
			class:vertical-layout={this.layout === "vertical"}
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
						onClick={(e: MouseEvent) => {
							e.stopPropagation();
							navTo(item.url);
						}}
						input={this.input}
						item={item}
						focused={use(this.focusindex).map(
							(i) => i === this.searchSuggestions.indexOf(item)
						)}
					></Suggestion>
				))}
				{use(this.trendingSuggestions)
					.map((s) => s.length > 0)
					.and(<div class="spacertext">Trending Searches</div>)}
				{use(this.trendingSuggestions).mapEach((item) => (
					<Suggestion
						item={item}
						input={this.input}
						layout={this.layout}
						onClick={(e: MouseEvent) => {
							e.stopPropagation();
							navTo(item.url);
						}}
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
				url={use(this.url)}
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
					if (e.isComposing) return;
					if (e.key === "Escape") {
						e.preventDefault();
						deactivate();
						this.value = this.realvalue = "";
						return;
					}
					if (e.key === "ArrowDown" && overflowlength() > 0) {
						e.preventDefault();
						let idx = this.focusindex + 1;
						if (idx >= overflowlength()) {
							idx = 0;
						}
						this.focusindex = idx;
						updateValue();
					}
					if (e.key === "ArrowUp" && overflowlength() > 0) {
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
						doSearch(e.altKey);
					}
				}}
				onkeyup={(e: KeyboardEvent) => {
					if (!this.justselected) return;

					// if the user didn't modify anything
					if (this.input.value == trimUrl(this.url)) {
						// insert the untrimmed version
						this.input.value = this.url.href;
					}

					if (e.key == "ArrowLeft") {
						// move the cursor to the start
						if (this.url.protocol == INTERNAL_URL_PROTOCOL) {
							this.input.setSelectionRange(0, 0);
						} else {
							let schemelen = this.url.protocol.length + 2;
							this.input.setSelectionRange(schemelen, schemelen);
						}
					}

					this.justselected = false;
				}}
				oninput={(e: InputEvent) => {
					this.subtleinput = false;

					if (e.isComposing || e.inputType.startsWith("delete")) {
						this.suggestionDenied = true;
					} else {
						this.suggestionDenied = false;
					}
					this.focusindex = 0;

					this.realvalue = this.value;

					if (this.value === "") {
						this.subtleinput = true;
					}
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
		overflow: visible;
		transition: width 150ms var(--ease-omnibox);
	}

	:scope.vertical-layout {
		flex: none;
		width: 100%;
		z-index: 0;
		background: var(--toolbar_field);
		border-radius: var(--radius-md);
	    border: 1px solid var(--text-20);
	}

	:scope.vertical-layout.active {
		width: min(42rem, calc(100vw - 2rem));
		z-index: 5;
	}

	:global(.sidebar-right) :scope.vertical-layout.active {
		right: calc(min(42rem, calc(100vw - 2rem)) - 100%);
	}

	.result-icon {
		align-self: start;
		margin-top: var(--space-sm);
	}

	.favicon {
		width: 16px;
		height: 16px;
	}

	.overflow {
		position: absolute;
		display: none;
		background: var(--toolbar_field);
		width: 100%;
		border-radius: var(--radius-md);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		border: 1px solid var(--popup_border);
		padding-bottom: var(--space-md);
	}
	.overflow .spacer {
		display: block;
		height: var(--omnibar-height);

		width: 98%;
		margin: 0 auto;

		border-bottom: 1px solid
			var(--text-35);
		margin-bottom: var(--space-md);
	}

	.spacertext {
		display: block;
		height: 2em;
		line-height: var(--omnibar-height);
		padding-left: var(--space-xxl);
		color: var(--text-60);
		font-size: 0.9em;
	}


	.overflow.active {
		display: block;
	}
}
`;
