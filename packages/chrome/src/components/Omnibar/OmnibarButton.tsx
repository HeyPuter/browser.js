import type { IconifyIcon } from "@iconify/types";
import { css, type FC } from "dreamland/core";
import { Icon } from "@components/Icon";

export function OmnibarButton(
	this: FC<{
		icon: IconifyIcon;
		click?: (e: MouseEvent) => void;
		rightclick?: (e: MouseEvent) => void;
		active?: boolean;
		tooltip?: string;
	}>
) {
	this.active ??= true;
	return (
		<button
			disabled={use(this.active).map((x) => (x ? undefined : true))}
			class:active={use(this.active)}
			on:click={(e: MouseEvent) => this.click?.(e)}
			on:contextmenu={(e: MouseEvent) => this.rightclick?.(e)}
			title={this.tooltip}
		>
			<Icon icon={use(this.icon)} />
		</button>
	);
}
OmnibarButton.style = css`
	:scope {
		box-sizing: border-box;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25em;

		font-size: calc(var(--omnibar-height) * 0.475);
		color: var(--icons);
		border-radius: var(--radius);

		opacity: 0.4;
	}
	:scope.active:hover {
		background: var(--toolbarbutton-hover-background);
	}
	:scope.active {
		opacity: 1;
	}
`;
