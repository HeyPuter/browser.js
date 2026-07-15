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
		padding: var(--space-xs);
		padding-left: var(--space-md);
		display: flex;
		gap: var(--space-md);
		background: var(--toolbar);
		color: var(--toolbar_text);
		height: var(--tab-height);
	}

	:scope.vertical {
		padding: 0;
		height: auto;
		flex-direction: column;
		gap: var(--space-sm);
		background: none;
	}

	button {
		display: flex;
		align-items: center;
		height: 100%;
		gap: var(--space-sm);
		padding-inline: var(--space-xs);
		border-radius: var(--radius-xs);
		color: var(--toolbar_text);
	}

	:scope.vertical button {
		width: 100%;
		height: auto;
		gap: var(--space-sm);
		min-height: var(--tab-height);
		padding: var(--space-md);
		border-radius: calc(var(--radius-md) + 1px);
		background: var(--toolbar_field);
	}

	button:hover {
		background: var(--toolbarbutton-hover-background);
	}

	button span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.83rem;
	}

	:scope.vertical button span {
		font-size: 0.75rem;
	}

	button img {
		width: 16px;
		height: 16px;
	}
`;
