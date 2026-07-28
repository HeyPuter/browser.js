import { rewriteUrl } from "@mercuryworkshop/scramjet/bundled";
import { Controller, controllerForURL } from "../proxy/Controller";
import { CDPConnection } from "../CDP";
import { contexts, ProxyFrameContext } from "../proxy/scramjet";
import type { Tab } from "./Tab";

export class TabSession {
	frame: HTMLIFrameElement;
	frameWindowProxy!: WindowProxy;
	devtoolsFrame: HTMLIFrameElement;
	controller: Controller | null = null;
	contexts: ProxyFrameContext[] = [];
	rootcontext: ProxyFrameContext | null = null;
	constructor(
		public tab: Tab,
		public id: string
	) {
		this.frame = document.createElement("iframe");
		this.devtoolsFrame = document.createElement("iframe");
		this.devtoolsFrame.onload = async () => {
			const session = new CDPConnection((msh) => {
				this.devtoolsFrame.contentWindow.InspectorFrontendAPI.dispatchMessage(
					msh
				);
			}, this);
			this.devtoolsFrame.contentWindow.InspectorFrontendHost.sendMessageToBackend =
				(message) => {
					console.warn(message);
					session.sendMessage(message);
				};
		};

		this.devtoolsFrame.src = "front_end/inspector.html";
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
