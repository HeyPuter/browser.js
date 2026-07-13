import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { Favicon } from "@components/Favicon";
import { profileService, tabsService } from "..";

export function HistoryPage(this: FC<{ tab: Tab }>) {
	return (
		<div>
			<nav>
				<h1>History</h1>
			</nav>
			<ul class="entries">
				{profileService.globalhistory
					.sort((a, b) => b.timestamp - a.timestamp)
					.map((entry) => (
						<li
							class="entry"
							on:click={() => {
								tabsService.newTab(entry.url);
							}}
						>
							<span
								class="inner"
								x={(() => {
									console.log(entry);
								})()}
							>
								<Favicon iconUrl={entry.favicon} size="small"></Favicon>
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
		background: var(--ntp_background);
		color: var(--ntp_text);
	}
	nav {
		width: 100%;
		padding: var(--space-xxl);
		background: var(--toolbar);
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
		overflow-y: scroll;
		width: 100%;
		flex: 1;
	}
	.entry {
		width: 100%;
		transition: background 0.1s;
	}
	.inner {
		display: flex;
		align-items: center;
		cursor: pointer;
		gap: var(--space-sm);
		padding-block: var(--space-xl);
		padding-left: var(--space-sm);
		margin-left: var(--space-xxl);
		border-bottom: 1px solid var(--ntp-text-10);
	}
	.entry:hover {
		background: var(--ntp-text-10);
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
		font-size: 0.85rem;
		text-overflow: ellipsis;
	}
`;
