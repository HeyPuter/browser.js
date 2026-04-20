import { css, type FC } from "dreamland/core";
import { createMenuCustom } from "@components/Menu";
import { SiteInformationPopup } from "@components/SiteInformationPopup";
import { Icon } from "@components/Icon";
import { emToPx } from "../../util";
import { iconOptions } from "../../icons";
import { tabsService } from "../..";

export function SiteOptionsButton() {
	return (
		<button
			on:click={(e: MouseEvent) => {
				createMenuCustom(
					{
						left: (e.target as HTMLElement).getBoundingClientRect().left,
						top: emToPx(2.5) + 40,
					},
					<SiteInformationPopup
						tab={tabsService.activetab}
					></SiteInformationPopup>
				);
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<Icon icon={iconOptions}></Icon>
		</button>
	);
}
SiteOptionsButton.style = css`
	:scope {
		width: 100%;
		cursor: pointer;
		padding: 0;
		margin: 0;
		background: none;
		outline: none;
		border: none;
		color: var(--toolbar_text);
		font-size: calc(var(--omnibar-height) / 2.5);
		padding: 0.1em;
		border-radius: 0.2em;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--toolbar);
	}
	:scope:hover {
		background: var(--toolbarbutton-hover-background);
	}
`;
