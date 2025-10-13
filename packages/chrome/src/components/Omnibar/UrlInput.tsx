import {
	createDelegate,
	createState,
	css,
	type Component,
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

export const focusOmnibox = createDelegate<void>();

export const UrlInput: Component<
	{
		url: URL;
		selectContent: Delegate<void>;
	},
	{
		value: string;
		active: boolean;
		justselected: boolean;
		subtleinput: boolean;
		focusindex: number;
		overflowItems: OmniboxResult[];
		trending: TrendingQuery[];
		input: HTMLInputElement;
	}
> = function (cx) {
	this.focusindex = 0;
	this.overflowItems = [];
	this.value = "";
	this.trending = [];

	cx.mount = () => {
		setContextMenu(cx.root, [
			{
				label: "Select All",
				action: () => {
					this.selectContent();
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
			this.overflowItems = [];
			return;
		}

		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(
			() =>
				fetchSuggestions(this.value, (results) => {
					this.overflowItems = results;
				}),
			100
		);
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

		if (this.url.href == "puter://newtab") {
			this.value = "";
		} else {
			this.value = trimUrl(this.url);
		}

		this.input.focus();
		this.input.select();
		this.justselected = true;
		this.input.scrollLeft = 0;

		fetchGoogleTrending().then(() => {
			// pick a random 3 from the cache
			this.trending = trendingCached!
				.sort(() => 0.5 - Math.random())
				.slice(0, 3);
		});
	};

	const doSearch = () => {
		if (this.focusindex > 0) {
			browser.activetab.pushNavigate(
				this.overflowItems[this.focusindex - 1].url
			);
		} else {
			browser.searchNavigate(this.value);
		}

		this.active = false;
		this.input.blur();
	};

	this.selectContent.listen(() => {
		activate();
	});

	const renderResultHighlight = (title: string, inputValue: string) => {
		if (title.toLowerCase().startsWith(inputValue.toLowerCase())) {
			return (
				<>
					<span style="font-weight: normal; opacity: 0.7;">
						{title.substring(0, inputValue.length)}
					</span>
					<span>{title.substring(inputValue.length)}</span>
				</>
			);
		}
		return <span style="font-weight: normal; opacity: 0.7;">{title}</span>;
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
			<div class="inactivebar"></div>
			<div
				class="overflow"
				class:active={use(this.active, this.subtleinput).map(
					([a, s]) => a && !s
				)}
			>
				<div class="spacer"></div>
				{use(this.overflowItems).mapEach((item) => (
					<div
						class="overflowitem"
						on:click={() => {
							this.active = false;
							this.input.blur();
							browser.activetab.pushNavigate(item.url);
						}}
						class:focused={use(this.focusindex).map(
							(i) => i - 1 === this.overflowItems.indexOf(item)
						)}
						title={item.url.href}
					>
						<div class="result-icon">
							{item.kind === "search" ? (
								<Icon icon={iconSearch}></Icon>
							) : (
								<img
									class="favicon"
									src={item.favicon || defaultFaviconUrl}
									alt="favicon"
								/>
							)}
						</div>
						<div class="result-content">
							{(item.title && (
								<span class="description">
									{renderResultHighlight(item.title, this.input.value)}
								</span>
							)) || <span class="description">{trimUrl(item.url)}</span>}
							{item.title && <span class="url">{trimUrl(item.url)}</span>}
						</div>
					</div>
				))}
				<div class="spacertext">Trending Searches</div>
				{use(this.trending).mapEach((item) => (
					<div
						class="overflowitem"
						on:click={() => {
							if (item.url) {
								this.active = false;
								this.input.blur();
								browser.activetab.pushNavigate(new URL(item.url));
							} else {
								this.value = item.title;
								this.focusindex = 0;
							}
						}}
						class:focused={false}
						title={item.url || item.title}
					>
						<div class="result-icon">
							<Icon icon={iconTrendingUp}></Icon>
						</div>
						<div class="result-content">
							<span class="description">
								{renderResultHighlight(item.title, this.input.value)}
							</span>
							{item.traffic && (
								<span class="url">{item.traffic} searches today</span>
							)}
						</div>
					</div>
				))}
			</div>

			<RealBar
				active={use(this.active)}
				input={use(this.input)}
				url={use(this.url)}
				value={use(this.value)}
				favicon={use(this.focusindex, this.overflowItems).map(() =>
					this.focusindex > 0 && this.overflowItems.length > 0
						? this.overflowItems[this.focusindex - 1].favicon
						: null
				)}
				doSearch={doSearch}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						let idx = this.focusindex + 1;
						if (idx > this.overflowItems.length) {
							idx = 0;
						}
						this.focusindex = idx;
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						let idx = this.focusindex - 1;
						if (idx < 0) {
							idx = this.overflowItems.length;
						}
						this.focusindex = idx;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						doSearch();
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
						if (this.url.protocol == "puter:") {
							this.input.setSelectionRange(0, 0);
						} else {
							let schemelen = this.url.protocol.length + 2;
							this.input.setSelectionRange(schemelen, schemelen);
						}
					}

					this.justselected = false;
				}}
				oninput={(e: InputEvent) => {
					this.focusindex = 0;
					this.subtleinput = false;
				}}
			></RealBar>
		</div>
	);
};

UrlInput.style = css`
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

	.overflowitem {
		display: flex;
		align-items: center;
		height: 2.5em;
		cursor: pointer;
		gap: 0.5em;
		padding-left: 0.5em;
		padding-right: 0.5em;
		white-space: nowrap;
		color: var(--fg);
		width: 100%;
		overflow: hidden;
	}

	.result-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		gap: 2px;
	}

	.overflowitem .url,
	.overflowitem .description {
		text-overflow: ellipsis;
		text-wrap: nowrap;
		word-wrap: nowrap;
		overflow: hidden;
	}

	.overflowitem .description {
		font-size: 1em;
		min-width: 0;
		font-weight: 500;
	}

	.overflowitem .url {
		color: var(--fg20);
		font-size: 0.85em;
		min-width: 0;
		opacity: 0.6;
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}
	.overflowitem.focused {
		background: var(--bg04);
	}

	.overflowitem.focused .description {
		color: var(--highlight);
	}

	.overflow.active {
		display: block;
	}
	.inactivebar {
		background: var(--bg);
		width: 100%;
		border: none;
		outline: none;
		border-radius: 4px;
		margin: 0.25em;
	}

	:scope.subtle.active .inactivebar {
		border: 1px solid var(--accent);
	}
`;

const RealBar: Component<
	{
		active: boolean;
		favicon: string | null;
		url: URL;
		value: string;
		input: HTMLInputElement;

		onkeydown: (e: KeyboardEvent) => void;
		onkeyup: (e: KeyboardEvent) => void;
		oninput: (e: InputEvent) => void;
		doSearch: () => void;
	},
	{}
> = function (cx) {
	return (
		<div>
			<div class="lefticon">
				{use(this.active).andThen([
					use(this.favicon).andThen(<Favicon url={this.favicon}></Favicon>),
					use(this.favicon)
						.map((f) => !f)
						.andThen(<Icon icon={iconSearch}></Icon>),
				])}
				{use(this.active)
					.map((a) => !a)
					.andThen(<SiteOptionsButton></SiteOptionsButton>)}
			</div>
			{use(this.active).andThen(
				<input
					spellcheck="false"
					this={use(this.input)}
					value={use(this.value)}
					on:keydown={(e: KeyboardEvent) => {
						this.onkeydown(e);
					}}
					on:keyup={(e: KeyboardEvent) => {
						this.onkeyup(e);
					}}
					on:input={(e: InputEvent) => {
						this.oninput(e);
					}}
				></input>
			)}
			{use(this.active, this.url)
				.map(([active, url]) => !active && url.href != "puter://newtab")
				.andThen(
					<span class="inactiveurl">
						<span class="subdomain">
							{use(this.url).map((t) => splitUrl(t)[0])}
						</span>
						<span class="domain">
							{use(this.url).map((t) => splitUrl(t)[1])}
						</span>
						<span class="rest">{use(this.url).map((t) => splitUrl(t)[2])}</span>
					</span>
				)}
			{use(this.active, this.url)
				.map(([active, url]) => !active && url.href == "puter://newtab")
				.andThen(
					<span class="placeholder">Search with Google or enter address</span>
				)}

			{use(this.active)
				.map((a) => !a)
				.andThen(<BookmarkButton url={use(this.url)}></BookmarkButton>)}
			{use(this.active).andThen(
				<OmnibarButton
					click={(e: MouseEvent) => {
						this.doSearch();
						e.stopPropagation();
						e.preventDefault();
					}}
					icon={iconForwards}
				></OmnibarButton>
			)}
		</div>
	);
};
RealBar.style = css`
	:scope {
		position: absolute;
		width: 100%;
		height: 100%;
		display: flex;
		z-index: 1;
		align-items: center;
		padding-left: 0.25em;
		padding-right: 0.25em;
	}

	input,
	.inactiveurl,
	.placeholder {
		background: none;
		border: none;
		outline: none;
		font-size: 1em;
		height: 100%;
		width: 100%;
		text-wrap: nowrap;
		overflow: hidden;
		font-family: var(--font);
		color: var(--fg);
		cursor: text;
	}
	.inactiveurl {
		display: flex;
		align-items: center;
		color: var(--fg);
	}
	.inactiveurl .subdomain,
	.inactiveurl .rest {
		opacity: 0.7;
		color: var(--fg2);
	}

	.placeholder {
		color: var(--fg4);
		display: flex;
		align-items: center;
	}

	.lefticon {
		font-size: 1.15em;
		color: var(--fg2);
		display: flex;
		margin: 0.25em;
		align-self: stretch;
		align-items: center;
	}
`;
