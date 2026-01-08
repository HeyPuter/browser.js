import { css, type FC, type Stateful } from "dreamland/core";
import { Icon } from "./Icon";
import { browser, type BookmarkEntry } from "../Browser";
import { Input } from "./Input";
import { closeMenu } from "./Menu";
import { Button } from "./Button";

export function BookmarkPopup(
	this: FC<{
		bookmark: Stateful<BookmarkEntry>;
		new: boolean;
	}>
) {
	return (
		<div>
			<div class="title">{this.new ? "Add Bookmark" : "Edit Bookmark"}</div>

			<div class="field">
				<Input label="Title" value={use(this.bookmark.title)} />
			</div>
			<div class="field">
				<Input label="URL" value={use(this.bookmark.url)} />
			</div>
			<div class="actions">
				<Button
					on:click={() => {
						if (!this.new) {
							browser.bookmarks = browser.bookmarks.filter(
								(b) => b !== this.bookmark
							);
						}
						closeMenu();
					}}
				>
					{this.new ? "Cancel" : "Delete"}
				</Button>
				<Button
					variant="primary"
					on:click={() => {
						if (this.new) {
							browser.bookmarks = [this.bookmark, ...browser.bookmarks];
						}

						closeMenu();
					}}
				>
					{this.new ? "Add" : "Save"}
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
		border-bottom: 1px solid var(--text-30);
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
		background: var(--toolbar_field);
		border: 1px solid var(--text-20);
		border-radius: 4px;
		padding: 0.5em 1em;
		font-size: 0.9em;
		cursor: pointer;
		color: var(--toolbar_field_text);
	}
	button:hover {
		background: var(--text-10);
	}
	button.accent {
		background: var(--tab_line);
		color: white;
		border-color: var(--tab_line);
	}
	button.accent:hover {
		background: var(--accent-dark);
	}
`;
