import { css } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";

export function Favicon(s: { url: string | null }) {
	return <img src={use(s.url).map((u) => u || defaultFaviconUrl)}></img>;
}
Favicon.style = css`
	:scope {
		width: 16px;
		height: 16px;
	}
`;
