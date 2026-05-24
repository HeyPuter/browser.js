import { css, type FC } from "dreamland/core";
import { createMenuCustom } from "@components/Menu";
import { BookmarkPopup } from "@components/BookmarkPopup";

import { iconStar, iconStarFilled } from "../../icons";
import { Icon } from "@components/Icon";
import { profileService, tabsService } from "../..";
import { BookmarkEntry } from "../../services/ProfileService";

export function BookmarkButton(this: FC<{ url: URL }>) {
	return (
		<button
			on:click={(e) => {
				e.stopPropagation();
				e.preventDefault();
				const target = e.currentTarget as HTMLElement;
				const rect = target.getBoundingClientRect();
				let bookmark = profileService.bookmarks.find(
					(b) => b.url.href == this.url.href
				);

				let isnew = false;
				if (!bookmark) {
					bookmark = new BookmarkEntry({
						url: tabsService.activetab.url,
						favicon: tabsService.activetab.icon,
						title:
							tabsService.activetab.title || tabsService.activetab.url.hostname,
					});
					isnew = true;
				}

				createMenuCustom(
					{
						right: rect.right,
						top: rect.bottom + 6,
					},
					<BookmarkPopup new={isnew} bookmark={bookmark}></BookmarkPopup>
				);
			}}
		>
			<Icon
				icon={use(profileService.bookmarks, this.url).map(() =>
					profileService.bookmarks.some((b) => b.url == this.url.href)
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
		color: var(--toolbar_text);
		display: flex;
		margin: 0.25em;
		padding: 0.25em;
		box-sizing: border-box;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;

		border-radius: 0.2em;
	}
	:scope:hover {
		background: var(--toolbarbutton-hover-background);
	}
`;
