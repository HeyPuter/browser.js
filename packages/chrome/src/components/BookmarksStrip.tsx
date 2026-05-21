import { css, type FC } from "dreamland/core";
import { iconAdd, iconOpen, iconLink, iconBrush, iconTrash } from "../icons";
import { createMenu, createMenuCustom, setContextMenu } from "@components/Menu";
import { BookmarkPopup } from "@components/BookmarkPopup";
import { profileService, settingsService, tabsService } from "..";

export function BookmarksStrip(
	this: FC<{
		orientation?: "horizontal" | "vertical";
	}>
) {
	this.orientation ??= "horizontal";

	this.cx.mount = () => {
		setContextMenu(this.root, [
			{
				label: "Add Bookmark",
				icon: iconAdd,
				action: () => {},
			},
			{
				label: "Pin Bookmarks Strip",
				checkbox: use(settingsService.settings.showBookmarksBar),
			},
		]);
	};
	return (
		<div class:vertical={this.orientation === "vertical"}>
			{use(profileService.bookmarks).mapEach((b) => (
				<button
					on:auxclick={(e: MouseEvent) => {
						if (e.button != 1) return;
						tabsService.newTab(new URL(b.url));
					}}
					on:contextmenu={(e: MouseEvent) => {
						createMenu({ left: e.clientX, top: e.clientY }, [
							{
								label: "Open",
								icon: iconLink,
								action: () =>
									tabsService.activetab.pushNavigate(new URL(b.url)),
							},
							{
								label: "Open in New Tab",
								icon: iconOpen,
								action: () => tabsService.newTab(new URL(b.url)),
							},
							{
								label: "Edit Bookmark",
								action: () => {
									// doesn't like having the menu open while opening another menu
									requestAnimationFrame(() => {
										createMenuCustom(
											{
												left: e.clientX,
												top: e.clientY,
											},
											<BookmarkPopup bookmark={b} new={false} />
										);
									});
								},
								icon: iconBrush,
							},
							{
								label: "Delete Bookmark",
								icon: iconTrash,
								action: () => {
									profileService.bookmarks = profileService.bookmarks.filter(
										(br) => br != b
									);
								},
							},
						]);
						e.preventDefault();
						e.stopPropagation();
					}}
					on:click={() => {
						tabsService.activetab.pushNavigate(new URL(b.url));
					}}
				>
					<img src={use(b.favicon)}></img>
					<span>{use(b.title)}</span>
				</button>
			))}
		</div>
	);
}
BookmarksStrip.style = css`
	:scope {
		padding: 0.25em;
		padding-left: 0.5em;
		display: flex;
		gap: 0.5em;
		background: var(--toolbar);
		color: var(--toolbar_text);
		height: 2em;
	}

	:scope.vertical {
		padding: 0;
		height: auto;
		flex-direction: column;
		gap: 0.35em;
		background: none;
	}

	button {
		display: flex;
		align-items: center;
		height: 100%;
		gap: 0.25em;

		padding-left: 0.25em;
		padding-right: 0.25em;
		border-radius: 3px;
		color: var(--toolbar_text);
	}

	:scope.vertical button {
		width: 100%;
		height: auto;
		min-height: var(--tab-height);
		padding: 0.6em 0.75em;
		border-radius: calc(var(--radius) + 1px);
		background: var(--toolbar_field);
	}

	button:hover {
		background: var(--toolbarbutton-hover-background);
	}
	button span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	button img {
		width: 16px;
		height: 16px;
	}
`;
