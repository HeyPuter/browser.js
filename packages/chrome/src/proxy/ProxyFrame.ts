import { rewriteUrl } from "@mercuryworkshop/scramjet/bundled";
import { Controller, controllerForURL } from "./Controller";

export class ProxyFrame {
	frame: HTMLIFrameElement;
	controller: Controller | null = null;
	private navigation = 0;
	constructor() {
		this.frame = document.createElement("iframe");
	}

	async go(url: URL) {
		const navigation = ++this.navigation;
		let controller = await controllerForURL(url);
		if (navigation !== this.navigation) return;
		this.controller = controller;

		const prefix = controller.prefix;

		this.frame.src = rewriteUrl(url, controller.fetchHandler.context, {
			origin: prefix, // origin/base don't matter here because we're always sending an absolute URL
			base: prefix,
		});
	}

	reload() {
		this.frame.contentWindow?.location.reload();
	}

	clear() {
		this.navigation++;
		this.controller = null;
		this.frame.src = "about:blank";
	}
}
