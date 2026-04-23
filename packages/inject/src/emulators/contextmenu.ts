import { ExecutionContextWrapper } from "../context";
import { Chromebound } from "../types";

export function setupContextMenu({
	self,
	rpc,
	client,
}: ExecutionContextWrapper) {
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

		if (client.box.instanceof(target, "HTMLImageElement")) {
			const targetImage = target as HTMLImageElement;
			resp.image = {
				src: targetImage.src,
				width: targetImage.naturalWidth,
				height: targetImage.naturalHeight,
			};
		} else if (client.box.instanceof(target, "HTMLAnchorElement")) {
			const targetAnchor = target as HTMLAnchorElement;
			resp.anchor = {
				href: targetAnchor.href,
			};
		} else if (client.box.instanceof(target, "HTMLVideoElement")) {
			const targetVideo = target as HTMLVideoElement;
			resp.video = {
				src: targetVideo.currentSrc,
				width: targetVideo.videoWidth,
				height: targetVideo.videoHeight,
			};
		}

		rpc.call("contextmenu", resp);
	});
}
