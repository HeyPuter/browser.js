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
import { StatefulClass } from "../util/StatefulClass";

export type DownloadEntry = {
	url: string;
	filename: string;
	timestamp: number;
	size: number;
	id: string;
	cancelled: boolean;

	progress?: number;
	progressbytes?: number;
	paused?: boolean;
	cancel?: Delegate<void>;
	pause?: Delegate<void>;
};

export class DownloadsService extends StatefulClass {
	sessionDownloadHistory: Stateful<DownloadEntry>[] = [];
	globalDownloadHistory: Stateful<DownloadEntry>[] = [];
	current: Stateful<DownloadEntry> | null = null;

	async startDownload(download: RawDownload): Promise<Stateful<DownloadEntry>> {
		let downloaded = 0;
		animateDownloadFly();

		let filename = download.filename;
		if (!filename) {
			let url = new URL(download.url);
			filename =
				decodeURIComponent(url.pathname.split("/").at(-1) || "") ||
				url.hostname.replaceAll(".", "-");
		}

		let cancel = createDelegate<void>();
		let pause = createDelegate<void>();

		let entry: Stateful<DownloadEntry> = createState({
			filename,
			url: download.url,
			size: download.length,
			timestamp: Date.now(),
			id: crypto.randomUUID(),
			cancelled: false,

			progress: 0,
			progressbytes: 0,
			paused: false,
			cancel,
			pause,
		});
		this.current = entry;
		this.globalDownloadHistory = [entry, ...this.globalDownloadHistory];
		this.sessionDownloadHistory = [entry, ...this.sessionDownloadHistory];

		let resumeResolver: (() => void) | null = null;
		const ac = new AbortController();

		pause.listen(() => {
			entry.paused = !entry.paused;
			if (!entry.paused) {
				resumeResolver?.();
				resumeResolver = null;
			}
		});

		cancel.listen(() => {
			entry.cancelled = true;
			ac.abort();
		});

		const pausableProgress = new TransformStream<Uint8Array, Uint8Array>({
			async transform(chunk, controller) {
				if (entry.paused)
					await new Promise<void>((res) => (resumeResolver = res));
				downloaded += chunk.byteLength;
				entry.progressbytes = downloaded;
				const progress = Math.min(
					(download.length ? downloaded / download.length : 0) + 0.1,
					1
				);
				entry.progress = progress;
				controller.enqueue(chunk);
			},
		});

		const streamnull = new WritableStream<Uint8Array>({
			write() {},
		});

		try {
			await new Response(download.body)
				.body!.pipeThrough(pausableProgress)
				.pipeTo(streamnull, { signal: ac.signal });
		} catch (err) {
			if ((err as any)?.name !== "AbortError") throw err;
		}
		entry.cancel = undefined;
		entry.pause = undefined;
		entry.progress = undefined;
		entry.progressbytes = undefined;
		entry.paused = false;
		showDownloadsPopup();
		setTimeout(() => {
			this.current = null;
		}, 1000);

		return entry;
	}

	pauseDownload(): void {
		if (this.current) {
			this.current.pause!();
		}
	}

	cancelDownload(): void {
		if (this.current) {
			this.current.cancel!();
		}
	}
}
