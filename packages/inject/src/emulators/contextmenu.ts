import { ExecutionContextWrapper } from "../context";
import { Chromebound } from "../types";

export function setupContextMenu({ self, rpc }: ExecutionContextWrapper) {
	// TODO: this needs to always be last
	self.document.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		const target = e.target;
		const selection = getSelection()?.toString();

		const resp: Chromebound["contextmenu"][0] = {
			x: e.clientX,
			y: e.clientY,
			selection,
		};

		if (target instanceof HTMLImageElement) {
			resp.image = {
				src: target.src,
				width: target.naturalWidth,
				height: target.naturalHeight,
			};
		} else if (target instanceof HTMLAnchorElement) {
			resp.anchor = {
				href: target.href,
			};
		} else if (target instanceof HTMLVideoElement) {
			resp.video = {
				src: target.currentSrc,
				width: target.videoWidth,
				height: target.videoHeight,
			};
		}

		rpc.call("contextmenu", resp);
	});
}
