import {
	createDelegate,
	createState,
	css,
	type Component,
	type Delegate,
} from "dreamland/core";
import iconOptions from "@ktibow/iconset-ion/options-outline";
import iconStar from "@ktibow/iconset-ion/star-outline";
import iconStarFilled from "@ktibow/iconset-ion/star";
import iconSearch from "@ktibow/iconset-ion/search";
import iconForwards from "@ktibow/iconset-ion/arrow-forward";
import iconTrendingUp from "@ktibow/iconset-ion/trending-up";
import { Icon } from "./Icon";
import { OmnibarButton } from "./OmnibarButton";
import { createMenuCustom, setContextMenu } from "./Menu";
import { defaultFaviconUrl } from "../assets/favicon";
import { browser } from "../Browser";
import { SiteInformationPopup } from "./SiteInformationPopup";
import { emToPx, splitUrl } from "../utils";
import { fetchSuggestions, type OmniboxResult } from "./suggestions";
import { BookmarkPopup } from "./BookmarkPopup";
import { bare } from "../IsolatedFrame";

export const focusOmnibox = createDelegate<void>();

export function trimUrl(v: URL) {
	return (
		(v.protocol === "puter:" ? v.protocol : "") +
		v.host +
		(v.search ? v.pathname : v.pathname.replace(/\/$/, "")) +
		v.search
	);
}
export type TrendingQuery = {
	title: string;
	traffic?: string;
	url?: string;
};

let trendingCached: TrendingQuery[] | null = null;
export async function fetchGoogleTrending(geo = "US"): Promise<void> {
	try {
		if (trendingCached) return;

		const res = await bare.fetch(
			"https://trends.google.com/_/TrendsUi/data/batchexecute",
			{
				method: "POST",
				body: `f.req=[[["i0OFE","[null, null, \\"${geo}\\", 0, null, 48]"]]]`,
				headers: {
					"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
					Referer: "https://trends.google.com/trends/explore",
				},
			}
		);
		if (!res.ok) return;

		const text = await res.text();
		const json = JSON.parse(text.slice(5));
		const data = JSON.parse(json[0][2]);
		const results: TrendingQuery[] = [];
		for (const item of data[1]) {
			results.push({
				title: item[0],
				traffic: item[1],
				url: item[2]
					? `https://www.google.com/search?q=${encodeURIComponent(item[0])}`
					: undefined,
			});
		}

		trendingCached = results;
	} catch (err) {
		console.error("fetchGoogleTrending failed", err);
	}
}
export const UrlInput: Component<
	{
		tabUrl: URL;
		selectContent: Delegate<void>;
	},
	{
		value: string;
		active: boolean;
		justselected: boolean;
		subtleinput: boolean;
		input: HTMLInputElement;
		focusindex: number;
		overflowItems: OmniboxResult[];
		trending: TrendingQuery[];
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

		if (this.tabUrl.href == "puter://newtab") {
			this.value = "";
		} else {
			this.value = trimUrl(this.tabUrl);
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
			<div class="realbar">
				<div class="lefticon">
					{use(this.active, this.focusindex, this.overflowItems).map(() =>
						this.active ? (
							this.focusindex > 0 && this.overflowItems.length > 0 ? (
								<img
									src={
										this.overflowItems[this.focusindex - 1].favicon ||
										defaultFaviconUrl
									}
								></img>
							) : (
								<Icon icon={iconSearch}></Icon>
							)
						) : (
							<button
								class="optionsbutton"
								on:click={(e: MouseEvent) => {
									createMenuCustom(
										{
											left: (e.target as HTMLElement).getBoundingClientRect()
												.left,
											top: emToPx(2.5) + 40,
										},
										<SiteInformationPopup
											tab={browser.activetab}
										></SiteInformationPopup>
									);
									e.preventDefault();
									e.stopPropagation();
								}}
							>
								<Icon icon={iconOptions}></Icon>
							</button>
						)
					)}
				</div>
				{use(this.active).andThen(
					<input
						spellcheck="false"
						this={use(this.input)}
						value={use(this.value)}
						on:keydown={(e: KeyboardEvent) => {
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
						on:keyup={(e: KeyboardEvent) => {
							if (!this.justselected) return;

							// if the user didn't modify anything
							if (this.input.value == trimUrl(this.tabUrl)) {
								// insert the untrimmed version
								this.input.value = this.tabUrl.href;
							}

							if (e.key == "ArrowLeft") {
								// move the cursor to the start
								if (this.tabUrl.protocol == "puter:") {
									this.input.setSelectionRange(0, 0);
								} else {
									let schemelen = this.tabUrl.protocol.length + 2;
									this.input.setSelectionRange(schemelen, schemelen);
								}
							}

							this.justselected = false;
						}}
						on:input={() => {
							this.value = this.input.value;
							this.focusindex = 0;
							this.subtleinput = false;
						}}
					></input>
				)}
				{use(this.active, this.tabUrl)
					.map(([active, url]) => !active && url.href != "puter://newtab")
					.andThen(
						<span class="inactiveurl">
							<span class="subdomain">
								{use(this.tabUrl).map((t) => splitUrl(t)[0])}
							</span>
							<span class="domain">
								{use(this.tabUrl).map((t) => splitUrl(t)[1])}
							</span>
							<span class="rest">
								{use(this.tabUrl).map((t) => splitUrl(t)[2])}
							</span>
						</span>
					)}
				{use(this.active, this.tabUrl)
					.map(([active, url]) => !active && url.href == "puter://newtab")
					.andThen(
						<span class="placeholder">Search with Google or enter address</span>
					)}

				{use(this.active)
					.map((a) => !a)
					.andThen(
						<OmnibarButton
							click={(e) => {
								e.stopPropagation();
								e.preventDefault();
								let bookmark = browser.bookmarks.find(
									(b) => b.url == this.tabUrl.href
								);

								let isnew = false;
								if (!bookmark) {
									bookmark = createState({
										url: browser.activetab.url.href,
										favicon: browser.activetab.icon,
										title:
											browser.activetab.title || browser.activetab.url.hostname,
									});
									isnew = true;
								}

								createMenuCustom(
									{
										right: (e.target as HTMLElement).getBoundingClientRect()
											.right,
										top: emToPx(2.5) + 40,
									},
									<BookmarkPopup
										new={isnew}
										bookmark={bookmark}
									></BookmarkPopup>
								);
							}}
							icon={use(browser.bookmarks, this.tabUrl).map(() =>
								browser.bookmarks.some((b) => b.url == this.tabUrl.href)
									? iconStarFilled
									: iconStar
							)}
						></OmnibarButton>
					)}
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
	);
};

UrlInput.style = css`
	:scope {
		position: relative;
		flex: 1;
		display: flex;
		height: 100%;
	}

	.lefticon {
		font-size: 1.15em;
		color: var(--fg2);
		display: flex;
		margin: 0.25em;
		align-self: stretch;
		align-items: center;
	}
	.lefticon img {
		width: 16px;
		height: 16px;
	}

	.result-icon {
		align-self: start;
		margin-top: 0.4em;
	}

	.favicon {
		width: 16px;
		height: 16px;
	}

	.optionsbutton {
		width: 100%;
		cursor: pointer;
		padding: 0;
		margin: 0;
		background: none;
		outline: none;
		border: none;
		color: var(--fg);
		font-size: 1em;
		padding: 0.1em;
		border-radius: 0.2em;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg01);
	}
	.optionsbutton:hover {
		background: var(--bg02);
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

	.realbar {
		position: absolute;
		width: 100%;
		height: 100%;
		display: flex;
		z-index: 1;
		align-items: center;
		padding-left: 0.25em;
		padding-right: 0.25em;
	}
`;
