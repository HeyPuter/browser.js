import type { IconifyIcon } from "@iconify/types";
import type { FC } from "dreamland/core";

export function Icon(
	this: FC<{
		icon: IconifyIcon;
		width?: string | undefined;
		height?: string | undefined;
		class?: string | undefined;
	}>
) {
	this.cx.mount = () => {
		// Listen on `icon.body` rather than on `icon` itself. Icons from
		// ../icons are stateful objects whose glyph is swapped in place when the
		// UI style changes (see `setIconStyle`), so their identity stays put;
		// watching the field picks up both that and a swapped-out `icon` prop.
		const update = (body: string) => {
			this.root.innerHTML = body;
		};
		use(this.icon.body).listen(update);
		update(this.icon.body);
	};

	return (
		<svg
			width={use(this.width).map((x) => x || "1em")}
			height={use(this.height).map((x) => x || "1em")}
			viewBox={use`0 0 ${this.icon.width} ${this.icon.height}`}
			xmlns="http://www.w3.org/2000/svg"
			{...(this.class ? { class: this.class } : {})}
		></svg>
	);
}
