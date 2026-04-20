import { css, type FC } from "dreamland/core";

export function Button(
	this: FC<{
		"on:click"?: (e: any) => void;
		disabled?: boolean;
		variant?: "primary" | "secondary" | "icon";
		children?: any;
	}>
) {
	return (
		<button
			class={this.variant || ""}
			disabled={use(this.disabled)}
			on:click={this["on:click"] || (() => {})}
		>
			{this.children}
		</button>
	);
}

Button.style = css`
	:scope {
		color: inherit;
	}
	:scope:not(.icon) {
		background: var(--toolbar_field);
		border: 1px solid var(--text-20);
		border-radius: var(--radius);
		padding: 0.5em 1em;
		font-size: 0.9em;
		cursor: pointer;
		color: var(--toolbar_field_text);
	}
	:scope:not(.icon):hover {
		background: var(--text-10);
		background-image: radial-gradient(
			70% 80% at 50% 100%,
			var(--text-8),
			var(--text-5)
		);
	}
	:scope.primary {
		background-color: var(--tab_line);
		background-image: radial-gradient(
			70% 80% at 50% 100%,
			var(--tab_line),
			var(--accent-shade-20)
		);
		box-shadow: inset 0px 0.05em 0.025em rgb(255 255 255 / 30%);
		text-shadow: 0 0.055em 0.05em var(--accent-shade-20);
		color: white;
		font-weight: 500;
		border-color: var(--tab_line);
	}

	:scope.primary:hover {
		background-color: var(--accent-shade-10);
		background-image: radial-gradient(
			70% 80% at 50% 100%,
			var(--accent-shade-5),
			var(--accent-shade-25)
		);
		filter: saturate(1.1);
	}

	:scope:disabled,
	:scope[disabled] {
		opacity: 0.6;
		cursor: not-allowed;
		pointer-events: none;
		background: var(--toolbar_field);
		color: var(--text-40);
		border-color: var(--text-20);
	}
	:scope:disabled:hover,
	:scope[disabled]:hover {
		background: var(--toolbar_field);
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
		background: var(--text-15);
		border-radius: 50%;
	}
`;
