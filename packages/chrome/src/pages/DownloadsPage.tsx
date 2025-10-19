import { css, type Component } from "dreamland/core";
import type { Tab } from "../Tab";
import { browser } from "../Browser";
import { iconLink, iconClose, iconFolder } from "../icons";
import { Icon } from "../components/Icon";
import { formatBytes } from "../utils";
import { defaultFaviconUrl } from "../assets/favicon";

export const DownloadsPage: Component<
	{
		tab: Tab;
	},
	{}
> = function () {
	return (
		<div>
			<nav>
				<h1>Downloads</h1>
			</nav>
			<ul class="entries">
				{use(browser.globalDownloadHistory).mapEach((entry) => {
					const url = new URL(entry.url);
					return (
						<li
							class="entry"
							on:click={() => {
								browser.newTab(url);
							}}
						>
							<span class="inner">
								<img src={defaultFaviconUrl} alt="favicon" />
								<div class="text">
									<span class="title">{entry.filename}</span>
									<span class="url">{url.hostname}</span>
									<div class="details">
										<span>{formatBytes(entry.size)}</span>
										<span>{new Date(entry.timestamp).toDateString()}</span>
									</div>
								</div>
								<div class="icons">
									<Icon icon={iconFolder}></Icon>
									<Icon icon={iconLink}></Icon>
									<Icon icon={iconClose}></Icon>
								</div>
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
};
DownloadsPage.style = css`
	:scope {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		background: var(--bg01);
		color: var(--fg);
	}
	nav {
		width: 100%;
		padding: 1.5em;
		background: var(--bg02);
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-left: 0;
	}
	.entries {
		list-style: none;
		padding: 0;
		margin: 0;
		width: 100%;
		padding-right: 1.75em;
	}
	.entry {
		width: 100%;
		transition: background 0.1s;
	}
	.inner {
		display: flex;
		align-items: center;
		gap: 0.5em;
		cursor: pointer;
		padding-block: 0.75em;
		padding-left: 0.5em;
		margin-left: 1.75em;
		border-bottom: 1px solid var(--bg08);
	}
	.entry:hover {
		background: var(--bg08);
	}
	.entry img {
		width: 16px;
		height: 16px;
	}
	.entry .title {
		font-weight: bold;
		color: inherit;
		text-decoration: none;
	}
	.entry .title:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.inner span {
		white-space: nowrap;
		overflow: hidden;
		padding: 0.085em;
		text-overflow: ellipsis;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		flex: 1;
		min-width: 0;
	}
	.details {
		display: flex;
		gap: 1em;
		color: var(--fg2);
	}
	.icons {
		display: flex;
		gap: 0.5em;
		margin-left: 0.75em;
	}
	.icons :global(svg) {
		width: 1em;
		height: 1em;
		color: var(--fg2);
	}
`;
