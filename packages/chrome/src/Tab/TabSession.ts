import { rewriteUrl } from "@mercuryworkshop/scramjet/bundled";
import { Controller, controllerForURL } from "../proxy/Controller";
import { CDPConnection } from "../CDP";
import { contexts } from "../proxy/scramjet";

export class TabSession {
	frame: HTMLIFrameElement;
	frameWindowProxy!: WindowProxy;
	devtoolsFrame: HTMLIFrameElement;
	controller: Controller | null = null;
	constructor() {
		this.frame = document.createElement("iframe");
		this.devtoolsFrame = document.createElement("iframe");
		setTimeout(() => {
			this.devtoolsFrame.onload = async () => {
				const ctx = contexts.find(
					(ctx) => ctx.windowproxy === this.frame.contentWindow
				);
				let session = new CDPConnection((msh) => {
					this.devtoolsFrame.contentWindow.InspectorFrontendAPI.dispatchMessage(
						msh
					);
				}, ctx.id);
				this.devtoolsFrame.contentWindow.InspectorFrontendHost.sendMessageToBackend =
					(message) => {
						console.warn(message);
						session.sendMessage(message);
					};
			};

			this.devtoolsFrame.src = "front_end/inspector.html";
		}, 1000);
	}

	mounted() {
		this.frameWindowProxy = this.frame.contentWindow!;
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
