import { type Component, css } from "dreamland/core";

export const Button: Component<{
	class?: string;
	"on:click"?: (e: any) => void;
	disabled?: boolean;
	variant?: "primary" | "secondary" | "icon";
	children: any;
}> = function (cx) {
	return (
		<button
			class={`${this.variant} ${this.class}`}
			disabled={use(this.disabled)}
			on:click={this["on:click"] || (() => {})}
		>
			{cx.children}
		</button>
	);
};

Button.style = css`
	:scope:not(.icon) {
		background: var(--bg02);
		border: 1px solid var(--fg4);
		border-radius: 4px;
		padding: 0.5em 1em;
		font-size: 0.9em;
		cursor: pointer;
		color: var(--fg);
	}
	:scope:not(.icon):hover {
		background: var(--bg03);
	}
	:scope.primary {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	:scope.primary:hover {
		background: var(--accent-hover, var(--accent));
	}

	:scope:disabled,
	:scope[disabled] {
		opacity: 0.6;
		cursor: not-allowed;
		pointer-events: none;
		background: var(--bg02);
		color: var(--fg4);
		border-color: var(--fg4);
	}
	:scope:disabled:hover,
	:scope[disabled]:hover {
		background: var(--bg02);
	}

	:scope.icon {
		display: flex;
		align-items: center;
		font-size: 1em;
		position: relative;
	}
	:scope.icon:hover::before {
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
