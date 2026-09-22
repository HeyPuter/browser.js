import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { Favicon } from "@components/Favicon";
import { profileService, tabsService } from "..";

export function HistoryPage(this: FC<{ tab: Tab }, { query: string }>) {
	this.query = "";
	return (
		<div>
			<nav>
				<h1>History</h1>
				<input
					aria-label="Search history"
					placeholder="Search history"
					value={use(this.query)}
				/>
				<button
					on:click={() => profileService.clearHistory()}
					disabled={use(profileService.globalhistory).map(
						(entries) => entries.length === 0
					)}
				>
					Clear browsing history
				</button>
			</nav>
			<ul class="entries">
				{use(profileService.globalhistory, this.query).map(
					([entries, query]) => {
						const term = query.trim().toLowerCase();
						const matches = entries
							.filter(
								(entry) =>
									entry.url.href.toLowerCase().includes(term) ||
									entry.title?.toLowerCase().includes(term)
							)
							.slice()
							.sort((a, b) => b.timestamp - a.timestamp);
						return matches.length ? (
							matches.map((entry) => (
								<li class="entry">
									<button
										class="inner"
										on:click={() => {
											tabsService.newTab(new URL(entry.url));
										}}
									>
										<Favicon iconUrl={entry.favicon} size="small" />
										<span class="title">{entry.title || entry.url.href}</span>
										<span class="url">{entry.url.hostname}</span>
									</button>
									<button
										aria-label={`Remove ${entry.title || entry.url.href} from history`}
										on:click={() => profileService.removeHistoryEntry(entry)}
									>
										Remove
									</button>
								</li>
							))
						) : (
							<li class="empty">
								{term ? "No matching history" : "No browsing history yet"}
							</li>
						);
					}
				)}
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
	button,
	input {
		color: inherit;
	}
	input {
		background: var(--toolbar_field);
		padding: var(--space-md);
		border: 1px solid var(--text-20);
		border-radius: var(--radius-sm);
	}
	.empty {
		padding: var(--space-xxl);
	}
	nav {
		display: flex;
		align-items: center;
		gap: var(--space-xl);
		flex-wrap: wrap;
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
		display: flex;
		align-items: center;
		width: 100%;
		transition: background 0.1s;
	}
	.inner {
		flex: 1;
		min-width: 0;
		text-align: left;
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
