import { rewriteUrl } from "@mercuryworkshop/scramjet";
import { Controller, controllerForURL } from "./Controller";

export class ProxyFrame {
	frame: HTMLIFrameElement;
	controller: Controller | null = null;
	constructor() {
		this.frame = document.createElement("iframe");
	}

	async go(url: URL) {
		let controller = await controllerForURL(url);
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
}
