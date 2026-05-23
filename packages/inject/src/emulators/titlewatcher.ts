import { ExecutionContextWrapper } from "../context";

export function setupTitleWatcher({ self, rpc }: ExecutionContextWrapper) {
	let cachedfaviconurl: string | null = null;
	const observer = new MutationObserver(() => {
		const title = self.document.querySelector("title");
		if (title) {
			rpc.call("titlechange", { title: title.textContent || undefined });
		}
		const favicon = self.document.querySelector(
			"link[rel='icon'], link[rel='shortcut icon'], link[rel='icon shortcut']"
		);

		const loadAndSendData = async (href: string) => {
			let res = await fetch(href);
			let blob = await res.blob();
			const reader = new FileReader();
			reader.onload = () => {
				rpc.call("titlechange", { icon: reader.result as string });
			};
			reader.onabort = () => {
				console.warn("Failed to read favicon");
				cachedfaviconurl = null;
			};
			reader.readAsDataURL(blob);
		};

		if (favicon) {
			const iconhref = favicon.getAttribute("href");
			if (iconhref) {
				if (iconhref !== cachedfaviconurl) {
					cachedfaviconurl = iconhref;
					loadAndSendData(iconhref);
				}
			}
		}
	});
	observer.observe(self.document, {
		childList: true,
		subtree: true,
	});
}
