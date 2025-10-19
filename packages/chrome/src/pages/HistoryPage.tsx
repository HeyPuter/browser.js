import { css } from "dreamland/core";
import type { Tab } from "../Tab";
import { browser } from "../Browser";
import { defaultFaviconUrl } from "../assets/favicon";

export function HistoryPage(s: { tab: Tab }) {
	return (
		<div>
			<nav>
				<h1>History</h1>
			</nav>
			<ul class="entries">
				{browser.globalhistory
					.sort((a, b) => b.timestamp - a.timestamp)
					.map((entry) => (
						<li
							class="entry"
							on:click={() => {
								browser.newTab(entry.url);
							}}
						>
							<span class="inner">
								<img src={entry.favicon || defaultFaviconUrl} alt="favicon" />
								<span class="title">{entry.title || entry.url.href}</span>
								<span class="url">{entry.url.hostname}</span>
							</span>
						</li>
					))}
			</ul>
		</div>
	);
}
HistoryPage.style = css`
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
		cursor: pointer;
		gap: 0.5em;
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
	}
	.inner span {
		white-space: nowrap;
		overflow: hidden;
		padding: 0.085em;
		text-overflow: ellipsis;
	}
`;
