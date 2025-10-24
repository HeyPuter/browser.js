import { createState, css } from "dreamland/core";
import { OmnibarButton } from "./OmnibarButton";
import { browser } from "../../Browser";
import { createMenuCustom } from "../Menu";
import { BookmarkPopup } from "../BookmarkPopup";
import { emToPx } from "../../utils";

import { iconStar, iconStarFilled } from "../../icons";
import { Icon } from "../Icon";

export function BookmarkButton(s: { url: URL }) {
	return (
		<button
			on:click={(e) => {
				e.stopPropagation();
				e.preventDefault();
				let bookmark = browser.bookmarks.find((b) => b.url == s.url.href);

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
		>
			<Icon
				icon={use(browser.bookmarks, s.url).map(() =>
					browser.bookmarks.some((b) => b.url == s.url.href)
						? iconStarFilled
						: iconStar
				)}
			></Icon>
		</button>
	);
}
BookmarkButton.style = css`
	:scope {
		font-size: 1em;
		color: var(--fg2);
		display: flex;
		margin: 0.25em;
		padding: 0.25em;
		box-sizing: border-box;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;

		color: var(--fg2);
		border-radius: 0.2em;
	}
	:scope:hover {
		background: var(--bg01);
	}
`;
