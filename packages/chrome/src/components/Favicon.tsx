import { css, type FC } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";

export function Favicon(
	this: FC<{
		url: string | null;
		size?: "small" | "medium" | "large" | "unset";
	}>
) {
	this.size ||= "small";
	return (
		<img
			src={use(this.url).map((u) => u || defaultFaviconUrl)}
			class={use(this.size)}
		></img>
	);
}
Favicon.style = css`
	:scope.small {
		width: 16px;
		height: 16px;
	}
	:scope.medium {
		width: 32px;
		height: 32px;
	}
	:scope.large {
		width: 64px;
		height: 64px;
	}
`;
