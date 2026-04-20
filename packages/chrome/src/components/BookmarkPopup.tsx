import { css, type FC, type Stateful } from "dreamland/core";
import { Icon } from "@components/Icon";
import { Input } from "@components/Input";
import { closeMenu } from "@components/Menu";
import { Button } from "@components/Button";
import type { BookmarkEntry } from "../services/ProfileService";
import { profileService } from "..";

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
				<Input label="URL" value={use(this.bookmark.url.href)} />
			</div>
			<div class="actions">
				<Button
					on:click={() => {
						if (!this.new) {
							profileService.bookmarks = profileService.bookmarks.filter(
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
							profileService.bookmarks = [
								this.bookmark,
								...profileService.bookmarks,
							];
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
		border-radius: var(--radius);
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
		background: var(--accent-shade-15);
	}
`;
