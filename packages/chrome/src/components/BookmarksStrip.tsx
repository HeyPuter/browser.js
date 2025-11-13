import { createState, css, type ComponentContext } from "dreamland/core";
import { Icon } from "./Icon";
import { iconAdd, iconOpen, iconLink, iconBrush, iconTrash } from "../icons";
import { browser, type BookmarkEntry } from "../Browser";
import { createMenu, createMenuCustom, setContextMenu } from "./Menu";
import { BookmarkPopup } from "./BookmarkPopup";

export function BookmarksStrip(props: {}, cx: ComponentContext) {
	cx.mount = () => {
		setContextMenu(cx.root, [
			{
				label: "Add Bookmark",
				icon: iconAdd,
				action: () => {},
			},
			{
				label: "Pin Bookmarks Strip",
				checkbox: use(browser.settings.showBookmarksBar),
			},
		]);
	};
	console.log(browser.bookmarks);
	return (
		<div>
			{use(browser.bookmarks).mapEach((b) => (
				<button
					on:auxclick={(e: MouseEvent) => {
						if (e.button != 1) return;
						browser.newTab(new URL(b.url));
					}}
					on:contextmenu={(e: MouseEvent) => {
						createMenu({ left: e.clientX, top: e.clientY }, [
							{
								label: "Open",
								icon: iconLink,
								action: () => browser.activetab.pushNavigate(new URL(b.url)),
							},
							{
								label: "Open in New Tab",
								icon: iconOpen,
								action: () => browser.newTab(new URL(b.url)),
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
									browser.bookmarks = browser.bookmarks.filter((br) => br != b);
								},
							},
						]);
						e.preventDefault();
						e.stopPropagation();
					}}
					on:click={() => {
						browser.activetab.pushNavigate(new URL(b.url));
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
		height: 2em;
		display: flex;
		gap: 0.5em;
		background: var(--toolbar);
		color: var(--toolbar_text);
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
	button:hover {
		background: var(--toolbarbutton-hover-background);
	}
	button span {
		white-space: nowrap;
	}

	button img {
		width: 16px;
		height: 16px;
	}
`;
