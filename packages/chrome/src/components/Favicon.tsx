import { css, type Component } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";

export const Favicon: Component<{ url: string | null }> = function (cx) {
	return <img src={use(this.url).map((u) => u || defaultFaviconUrl)}></img>;
};
Favicon.style = css`
	:scope {
		width: 16px;
		height: 16px;
	}
`;
