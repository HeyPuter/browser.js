import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { DownloadActions, DownloadStatus } from "@components/DownloadActions";
import { Favicon } from "@components/Favicon";
import { downloadsService, tabsService } from "..";

export function DownloadsPage(this: FC<{ tab: Tab }>) {
	return (
		<div>
			<nav>
				<h1>Downloads</h1>
			</nav>
			<ul class="entries">
				{use(downloadsService.globalDownloadHistory).mapEach((entry) => {
					const url = new URL(entry.url);
					return (
						<li class="entry">
							<span class="inner">
								<Favicon domain={url.hostname} size="medium"></Favicon>
								<div class="text">
									<span class="title">{entry.filename}</span>
									<button class="url" on:click={() => tabsService.newTab(url)}>
										{url.hostname}
									</button>
									<div class="details">
										<DownloadStatus entry={entry} />
										<span>{new Date(entry.timestamp).toDateString()}</span>
									</div>
								</div>
								<DownloadActions entry={entry} />
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
DownloadsPage.style = css`
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
	}
	.entry {
		width: 100%;
		transition: background 0.1s;
	}
	.inner {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		cursor: default;
		padding-block: var(--space-lg);
		padding-left: var(--space-md);
		margin-left: 1.75em;
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
		color: inherit;
		text-decoration: none;
	}
	.entry .title:hover {
		color: var(--tab_line);
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
		gap: var(--space-xs);
		flex: 1;
		min-width: 0;
	}
	.details {
		display: flex;
		gap: 1em;
		color: var(--ntp-text-70);
	}
	.icons {
		display: flex;
		gap: var(--space-md);
		margin-left: 0.75em;
	}
	.icons :global(svg) {
		width: 1em;
		height: 1em;
		color: var(--ntp-text-70);
	}
`;
