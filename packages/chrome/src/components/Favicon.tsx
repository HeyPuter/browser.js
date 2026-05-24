import { css, type FC } from "dreamland/core";
import { defaultFaviconUrl } from "../assets/favicon";
import { faviconService } from "..";

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
			// set default favicon while it's loading
			// TODO: does this cause flickering?
			this.url = defaultFaviconUrl;
			faviconService.fetchFavicon(domain).then((favicon) => {
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

	return (
		<img
			src={use(this.url)}
			width={use(this.size).map((s) =>
				s === "small" ? 16 : s === "medium" ? 32 : 64
			)}
			height={use(this.size).map((s) =>
				s === "small" ? 16 : s === "medium" ? 32 : 64
			)}
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
