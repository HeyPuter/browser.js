import { css, type FC } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";
import { browser } from "../Browser";

export function Favicon(
	this: FC<
		{
			iconUrl?: string | null;
			domain?: string | null;
			size?: "small" | "medium" | "large" | "unset";
		},
		{
			url: string | undefined;
		}
	>
) {
	this.size ||= "small";

	use(this.iconUrl, this.domain).listen(([iconUrl, domain]) => {
		if (iconUrl) {
			if (this.url !== iconUrl) this.url = iconUrl;
		} else if (domain) {
			browser.fetchFavicon(domain).then((favicon) => {
				if (favicon?.iconUrl !== this.url)
					this.url = favicon?.iconUrl || defaultFaviconUrl;
			});
		} else {
			if (this.url !== defaultFaviconUrl) this.url = defaultFaviconUrl;
		}
	});
	// :(
	this.domain = this.domain;
	this.iconUrl = this.iconUrl;

	return <img src={use(this.url)} class={use(this.size)}></img>;
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
