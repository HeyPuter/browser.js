import { createState, type Component } from "dreamland/core";
import { OmnibarButton } from "./OmnibarButton";
import { browser } from "../../Browser";
import { createMenuCustom } from "../Menu";
import { BookmarkPopup } from "../BookmarkPopup";
import { emToPx } from "../../utils";

import { iconStar, iconStarFilled } from "../../icons";

export const BookmarkButton: Component<{
	url: URL;
}> = function () {
	return (
		<OmnibarButton
			click={(e) => {
				e.stopPropagation();
				e.preventDefault();
				let bookmark = browser.bookmarks.find((b) => b.url == this.url.href);

				let isnew = false;
				if (!bookmark) {
					bookmark = createState({
						url: browser.activetab.url.href,
						favicon: browser.activetab.icon,
						title: browser.activetab.title || browser.activetab.url.hostname,
					});
					isnew = true;
				}

				createMenuCustom(
					{
						right: (e.target as HTMLElement).getBoundingClientRect().right,
						top: emToPx(2.5) + 40,
					},
					<BookmarkPopup new={isnew} bookmark={bookmark}></BookmarkPopup>
				);
			}}
			icon={use(browser.bookmarks, this.url).map(() =>
				browser.bookmarks.some((b) => b.url == this.url.href)
					? iconStarFilled
					: iconStar
			)}
		></OmnibarButton>
	);
};
