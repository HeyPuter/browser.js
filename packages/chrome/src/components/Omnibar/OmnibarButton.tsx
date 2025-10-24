import type { IconifyIcon } from "@iconify/types";
import { css } from "dreamland/core";
import { Icon } from "../Icon";

export function OmnibarButton(props: {
	icon: IconifyIcon;
	click?: (e: MouseEvent) => void;
	rightclick?: (e: MouseEvent) => void;
	active?: boolean;
	tooltip?: string;
}) {
	props.active ??= true;
	return (
		<button
			disabled={use(props.active).map((x) => (x ? undefined : true))}
			class:active={use(props.active)}
			on:click={(e: MouseEvent) => props.click?.(e)}
			on:contextmenu={(e: MouseEvent) => props.rightclick?.(e)}
			title={props.tooltip}
		>
			<Icon icon={use(props.icon)} />
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

		font-size: 1.15em;
		color: var(--fg2);
		border-radius: 0.2em;
	}
	:scope.active:hover {
		background: var(--bg20);
	}
	:scope.active {
		color: var(--fg2);
	}
`;
