import { css, type FC } from "dreamland/core";
import { type Tab } from "../Tab/Tab";
import { splitUrl } from "../util";

import { iconClose, iconTrash, iconSettings } from "../icons";
import { Icon } from "@components/Icon";
import { Button } from "@components/Button";

import { closeMenu } from "@components/Menu";

export function SiteInformationPopup(this: FC<{ tab: Tab }>) {
	return (
		<div>
			<div class="header section">
				<span>
					{use(this.tab.url).map((u) => splitUrl(u)[0] + splitUrl(u)[1])}
				</span>
				<div class="buttoniconscontainer">
					<Button
						variant="icon"
						on:click={() => {
							closeMenu();
						}}
					>
						<Icon icon={iconClose}></Icon>
					</Button>
				</div>
			</div>
			<div class="content section">
				<p>
					Connection is protected by SSL for this site and forwarded over WISP
				</p>
			</div>
			<div class="footer section">
				{/* <div class="entry">
					<Icon icon={iconTrash}></Icon>
					<span>Clear Site Data</span>
				</div>
				<div class="entry">
					<Icon icon={iconSettings}></Icon>
					<span>Site Settings</span>
				</div> */}
			</div>
		</div>
	);
}
SiteInformationPopup.style = css`
	:scope {
		display: flex;
		flex-direction: column;
		gap: var(--space-xl);
		width: 20em;

		color: var(--toolbar_text);
	}

	.buttoniconscontainer {
		flex: 1;
		display: flex;
		align-items: top;
		justify-content: end;
		color: var(--toolbar_text);
	}

	.content {
		padding-inline: var(--space-xl);
		font-size: 0.85em;
		line-height: 1.3;
	}

	.header {
		padding: var(--space-xl);
		display: flex;
		border-bottom: 1px solid var(--popup_border);
	}
	.header span {
		font-size: 1.15em;
		font-weight: 500;
	}

	.footer {
		border-top: 1px solid var(--popup_border);
		display: flex;
		flex-direction: column;
	}

	.entry {
		padding: var(--space-xl);
		padding-left: calc(var(--space-xl) - 4px);
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--space-md);
	}
	.entry:hover {
		background: var(--toolbarbutton-hover-background);
	}
`;
