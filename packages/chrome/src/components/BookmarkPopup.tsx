import { css, type Stateful } from "dreamland/core";
import { Icon } from "./Icon";
import { browser, type BookmarkEntry } from "../Browser";
import { Input } from "./Input";
import { closeMenu } from "./Menu";
import { Button } from "./Button";

export function BookmarkPopup(s: {
	bookmark: Stateful<BookmarkEntry>;
	new: boolean;
}) {
	return (
		<div>
			<div class="title">{s.new ? "Add Bookmark" : "Edit Bookmark"}</div>

			<div class="field">
				<Input
					label="Title"
					value={s.bookmark.title}
					onInput={(e) =>
						(s.bookmark.title = (e.target as HTMLInputElement).value)
					}
				/>
			</div>
			<div class="field">
				<Input
					label="URL"
					value={s.bookmark.url}
					onInput={(e) =>
						(s.bookmark.url = (e.target as HTMLInputElement).value)
					}
				/>
			</div>
			<div class="actions">
				<Button
					on:click={() => {
						if (!s.new) {
							browser.bookmarks = browser.bookmarks.filter(
								(b) => b !== s.bookmark
							);
						}
						closeMenu();
					}}
				>
					{s.new ? "Cancel" : "Delete"}
				</Button>
				<Button
					variant="primary"
					on:click={() => {
						if (s.new) {
							browser.bookmarks = [s.bookmark, ...browser.bookmarks];
						}

						closeMenu();
					}}
				>
					{s.new ? "Add" : "Save"}
				</Button>
			</div>
		</div>
	);
}
BookmarkPopup.style = css`
	:scope {
		display: flex;
		flex-direction: column;
		gap: 1em;
		width: 20em;
		padding: 0 1em 1em 1em;
	}
	.title {
		padding: 1em;
		font-weight: bold;
		border-bottom: 1px solid var(--fg4);
		text-align: center;
		margin: 0 -1em;
	}
	.field {
		margin-bottom: 0.5em;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5em;
		margin-top: 0.5em;
	}
	button {
		background: var(--bg02);
		border: 1px solid var(--fg4);
		border-radius: 4px;
		padding: 0.5em 1em;
		font-size: 0.9em;
		cursor: pointer;
		color: var(--fg);
	}
	button:hover {
		background: var(--bg03);
	}
	button.accent {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	button.accent:hover {
		background: var(--accent-hover, var(--accent));
	}
`;
