import { css, type FC } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";

export function Favicon(this: FC<{ url: string | null }>) {
	return <img src={use(this.url).map((u) => u || defaultFaviconUrl)}></img>;
}
Favicon.style = css`
	:scope {
		width: 16px;
		height: 16px;
	}
`;
