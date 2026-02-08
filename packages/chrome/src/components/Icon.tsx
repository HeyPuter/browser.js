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
		const update = (icon: IconifyIcon) => {
			this.root.innerHTML = icon.body;
		};
		use(this.icon).listen(update);
		update(this.icon);
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
