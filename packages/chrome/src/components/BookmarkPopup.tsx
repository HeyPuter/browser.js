import { css, type Component, type Stateful } from "dreamland/core";
import { Icon } from "./Icon";
import { browser, type BookmarkEntry } from "../Browser";
import { Input } from "./Input";
import { closeMenu } from "./Menu";
import { Button } from "./Button";

export const BookmarkPopup: Component<{
	bookmark: Stateful<BookmarkEntry>;
	new: boolean;
}> = function (cx) {
	return (
		<div>
			<div class="title">{this.new ? "Add Bookmark" : "Edit Bookmark"}</div>

			<div class="field">
				<Input
					label="Title"
					value={this.bookmark.title}
					on:input={(e) =>
						(this.bookmark.title = (e.target as HTMLInputElement).value)
					}
				/>
			</div>
			<div class="field">
				<Input
					label="URL"
					value={this.bookmark.url}
					on:input={(e) =>
						(this.bookmark.url = (e.target as HTMLInputElement).value)
					}
				/>
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
};
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
