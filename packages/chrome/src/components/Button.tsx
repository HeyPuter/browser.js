import { type Component, type ComponentContext, css } from "dreamland/core";

export function Button(
	props: {
		"on:click"?: (e: any) => void;
		disabled?: boolean;
		variant?: "primary" | "secondary" | "icon";
		children: any;
	},
	cx: ComponentContext
) {
	return (
		<button
			class={props.variant || ""}
			disabled={use(props.disabled)}
			on:click={props["on:click"] || (() => {})}
		>
			{cx.children}
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
		border-radius: 4px;
		padding: 0.5em 1em;
		font-size: 0.9em;
		cursor: pointer;
		color: var(--toolbar_field_text);
	}
	:scope:not(.icon):hover {
		background: var(--text-10);
	}
	:scope.primary {
		background: var(--tab_line);
		color: white;
		border-color: var(--tab_line);
	}
	:scope.primary:hover {
		background: var(--accent-dark);
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
