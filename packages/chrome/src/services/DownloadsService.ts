import {
	createState,
	createDelegate,
	type Delegate,
	type Stateful,
} from "dreamland/core";
import type { RawDownload } from "../proxy/scramjet";
import {
	animateDownloadFly,
	showDownloadsPopup,
} from "../components/Omnibar/Omnibar";
import { Service } from "./Service";
import { downloadFilename } from "./downloads";
import { closeMenu } from "../components/Menu";

export type DownloadEntry = {
	url: string;
	filename: string;
	timestamp: number;
	size: number;
	id: string;
	cancelled: boolean;
	status: "downloading" | "paused" | "complete" | "cancelled" | "failed";
	error?: string;
	progress?: number;
	progressbytes?: number;
	paused?: boolean;
	fileAvailable?: boolean;
	cancel?: Delegate<void>;
	pause?: Delegate<void>;
};

export type DownloadRecord = Pick<
	DownloadEntry,
	| "id"
	| "url"
	| "filename"
	| "timestamp"
	| "size"
	| "status"
	| "error"
	| "progressbytes"
>;
export type DownloadsState = { entries: DownloadRecord[] };

export class DownloadsService extends Service {
	sessionDownloadHistory: Stateful<DownloadEntry>[] = [];
	globalDownloadHistory: Stateful<DownloadEntry>[] = [];
	current: Stateful<DownloadEntry> | null = null;
	private files = new Map<string, string>();

	constructor(data: DownloadsState | null = null) {
		super();
		this.globalDownloadHistory = (data?.entries ?? []).map((record) => {
			const interrupted =
				record.status === "downloading" || record.status === "paused";
			if (interrupted) this.markDirty();
			return createState<DownloadEntry>({
				...record,
				status: interrupted ? "failed" : record.status,
				error: interrupted
					? "Download interrupted when browser closed"
					: record.error,
				cancelled: record.status === "cancelled",
				fileAvailable: false,
			});
		});
	}

	save(): DownloadsState {
		return {
			entries: this.globalDownloadHistory.map(
				({
					id,
					url,
					filename,
					timestamp,
					size,
					status,
					error,
					progressbytes,
				}) => ({
					id,
					url,
					filename,
					timestamp,
					size,
					status,
					error,
					progressbytes,
				})
			),
		};
	}

	async startDownload(download: RawDownload): Promise<Stateful<DownloadEntry>> {
		let downloaded = 0;
		animateDownloadFly();
		const cancel = createDelegate<void>();
		const pause = createDelegate<void>();
		const entry = createState<DownloadEntry>({
			filename: downloadFilename(download.filename, download.url),
			url: download.url,
			size:
				Number.isFinite(download.length) && download.length > 0
					? download.length
					: 0,
			timestamp: Date.now(),
			id: crypto.randomUUID(),
			cancelled: false,
			status: "downloading",
			progress: 0,
			progressbytes: 0,
			paused: false,
			fileAvailable: false,
			cancel,
			pause,
		});
		this.current = entry;
		this.globalDownloadHistory = [entry, ...this.globalDownloadHistory];
		this.sessionDownloadHistory = [entry, ...this.sessionDownloadHistory];
		this.markDirty();

		let resume: (() => void) | undefined;
		const abort = new AbortController();
		pause.listen(() => {
			if (abort.signal.aborted) return;
			entry.paused = !entry.paused;
			entry.status = entry.paused ? "paused" : "downloading";
			this.markDirty();
			if (!entry.paused) {
				resume?.();
				resume = undefined;
			}
		});
		cancel.listen(() => {
			entry.cancelled = true;
			abort.abort();
			// A paused write must settle before pipeTo can propagate cancellation.
			resume?.();
			resume = undefined;
		});

		const chunks: Uint8Array<ArrayBuffer>[] = [];
		const dirty = () => this.markDirty();
		try {
			// Response normalizes the proxy's string/Blob/ArrayBuffer/stream bodies.
			const body = new Response(download.body ?? new Uint8Array()).body!;
			await body.pipeTo(
				new WritableStream<Uint8Array>({
					async write(chunk) {
						if (entry.paused)
							await new Promise<void>((resolve) => {
								resume = resolve;
							});
						if (abort.signal.aborted) return;
						chunks.push(new Uint8Array(chunk));
						downloaded += chunk.byteLength;
						entry.progressbytes = downloaded;
						// The writer's this is not the download service.
						dirty();
						entry.progress = entry.size
							? Math.min(downloaded / entry.size, 0.99)
							: 0;
					},
				}),
				{ signal: abort.signal }
			);
			abort.signal.throwIfAborted();
			const blob = new Blob(chunks, { type: download.type });
			this.files.set(entry.id, URL.createObjectURL(blob));
			entry.fileAvailable = true;
			entry.size = downloaded;
			entry.status = "complete";
			this.saveFile(entry);
		} catch (error) {
			entry.status = entry.cancelled ? "cancelled" : "failed";
			if (!entry.cancelled)
				entry.error = error instanceof Error ? error.message : String(error);
		} finally {
			chunks.length = 0;
			entry.cancel = undefined;
			entry.pause = undefined;
			entry.progress = undefined;
			entry.paused = false;
			if (this.current === entry) {
				this.current =
					this.sessionDownloadHistory.find(
						(item) => item.progress !== undefined
					) ?? null;
			}
			showDownloadsPopup();
			this.markDirty();
		}
		return entry;
	}

	saveFile(entry: DownloadEntry) {
		const url = this.files.get(entry.id);
		if (!url || entry.status !== "complete") return;
		// Release the menu's outside-click capture before activating the anchor.
		closeMenu();
		// https://html.spec.whatwg.org/multipage/links.html#downloading-resources
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = entry.filename;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	}

	removeDownload(entry: DownloadEntry) {
		entry.cancel?.();
		const url = this.files.get(entry.id);
		if (url) URL.revokeObjectURL(url);
		this.files.delete(entry.id);
		entry.fileAvailable = false;
		this.globalDownloadHistory = this.globalDownloadHistory.filter(
			(item) => item !== entry
		);
		this.sessionDownloadHistory = this.sessionDownloadHistory.filter(
			(item) => item !== entry
		);
		this.markDirty();
	}

	pauseDownload() {
		this.current?.pause?.();
	}
	cancelDownload() {
		this.current?.cancel?.();
	}
}
