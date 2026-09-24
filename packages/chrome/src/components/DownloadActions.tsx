import { css, type FC } from "dreamland/core";
import type { DownloadEntry } from "../services/DownloadsService";
import { downloadsService } from "..";
import { formatBytes } from "../util";

export function DownloadStatus(this: FC<{ entry: DownloadEntry }>) {
	return (
		<span role="status">
			{use(
				this.entry.status,
				this.entry.progressbytes,
				this.entry.size,
				this.entry.error
			).map(([status, bytes, size, error]) => {
				if (status === "failed")
					return `Failed: ${error || "Download interrupted"}`;
				if (status === "cancelled") return "Cancelled";
				if (status === "complete") return `Downloaded · ${formatBytes(size)}`;
				return `${status === "paused" ? "Paused · " : ""}${formatBytes(bytes ?? 0)}${size ? ` / ${formatBytes(size)}` : ""}`;
			})}
		</span>
	);
}

export function DownloadActions(this: FC<{ entry: DownloadEntry }>) {
	return (
		<div>
			{use(this.entry.progress)
				.map((progress) => progress !== undefined)
				.and(
					<>
						<button on:click={() => this.entry.pause?.()}>
							{use(this.entry.paused).map((paused) =>
								paused ? "Resume" : "Pause"
							)}
						</button>
						<button on:click={() => this.entry.cancel?.()}>Cancel</button>
					</>
				)}
			{use(this.entry.status, this.entry.fileAvailable)
				.map(([status, available]) => status === "complete" && !!available)
				.and(
					<button on:click={() => downloadsService.saveFile(this.entry)}>
						Save again
					</button>
				)}
			{use(this.entry.progress)
				.map((progress) => progress === undefined)
				.and(
					<button on:click={() => downloadsService.removeDownload(this.entry)}>
						Remove
					</button>
				)}
		</div>
	);
}
DownloadActions.style = css`
	:scope {
		display: flex;
		gap: var(--space-md);
	}
	button {
		color: inherit;
		padding: var(--space-sm);
		border-radius: var(--radius-sm);
	}
	button:hover {
		background: var(--toolbarbutton-hover-background);
	}
`;
