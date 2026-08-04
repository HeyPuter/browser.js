import type { FC } from "dreamland/core";
import { resolveIcon, type IconDescription } from "../icons";

export function Icon(
	this: FC<{
		icon: IconDescription;
		width?: string | undefined;
		height?: string | undefined;
		class?: string | undefined;
	}>
) {
	const glyph = resolveIcon(use(this.icon));

	this.cx.mount = () => {
		const update = (body: string) => {
			this.root.innerHTML = body;
		};
		glyph.map((i) => i.body).listen(update);
		update(glyph.value.body);
	};

	return (
		<svg
			width={use(this.width).map((x) => x || "1em")}
			height={use(this.height).map((x) => x || "1em")}
			viewBox={glyph.map((i) => `0 0 ${i.width} ${i.height}`)}
			xmlns="http://www.w3.org/2000/svg"
			{...(this.class ? { class: this.class } : {})}
		></svg>
	);
}
