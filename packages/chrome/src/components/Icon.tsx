import type { IconifyIcon } from "@iconify/types";
import type { ComponentContext } from "dreamland/core";

export function Icon(
	s: {
		icon: IconifyIcon;
		width?: string | undefined;
		height?: string | undefined;
		class?: string | undefined;
	},
	cx: ComponentContext
) {
	cx.mount = () => {
		const update = (icon: IconifyIcon) => {
			cx.root.innerHTML = icon.body;
		};
		use(s.icon).listen(update);
		update(s.icon);
	};

	return (
		<svg
			width={use(s.width).map((x) => x || "1em")}
			height={use(s.height).map((x) => x || "1em")}
			viewBox={use(s.icon).map((icon) => `0 0 ${icon.width} ${icon.height}`)}
			xmlns="http://www.w3.org/2000/svg"
			{...(s.class ? { class: s.class } : {})}
		></svg>
	);
}
