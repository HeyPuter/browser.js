import type { IconifyIcon } from "@iconify/types";
import { css } from "dreamland/core";
import { Icon } from "./Icon";

export function SmallIconButton(s: {
	click: (e: MouseEvent) => void;
	icon: IconifyIcon;
}) {
	return (
		<button on:click={s.click}>
			<Icon icon={s.icon}></Icon>
		</button>
	);
}
SmallIconButton.style = css`
	:scope {
		display: flex;
		align-items: center;
		font-size: 1em;
		position: relative;
	}
	:scope:hover::before {
		content: "";
		z-index: -1;
		position: absolute;
		width: 150%;
		height: 150%;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: var(--bg20);
		border-radius: 50%;
	}
`;
