import { css, type FC } from "dreamland/core";

export function Checkbox(
	this: FC<{
		value: boolean;
		id?: string;
		"on:change"?: (value: boolean) => void;
	}>
) {
	return (
		<label>
			<input
				type="checkbox"
				id={use(this.id)}
				checked={use(this.value)}
				onChange={(e) => this["on:change"]?.(e.target.checked)}
			></input>
		</label>
	);
}

Checkbox.style = css`
	:scope {
		width: 1em;
		height: 1em;
		background: var(--toolbar_field);
		border: 1px solid var(--text-20);
		display: inline-block;
		position: relative;
		border-radius: var(--radius);
		vertical-align: middle;
		transition:
			background 120ms ease,
			border-color 120ms ease;
		box-sizing: border-box;
	}

	:scope::after {
		content: "✓";
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--toolbar_field);
		text-shadow: 0 0.055em 0.05em var(--accent-shade-20);
		font-size: 0.8em;
		transform: scale(0);
		transition: transform 120ms cubic-bezier(0.43, 0.91, 0.34, 1.3);
		pointer-events: none;
	}

	:scope:has(input:checked) {
		background-color: var(--tab_line);
		background-image: radial-gradient(
			70% 50% at 50% 100%,
			var(--accent-tint-20),
			var(--accent-shade-10)
		);
		box-shadow:
			inset 0px 0.05em 0.025em rgb(255 255 255 / 40%),
			inset 0px -0.05em 0.04em rgb(0 0 0 / 20%);
		border: none;
	}

	:scope:has(input:checked)::after {
		transform: scale(1) translateY(0.5px);
	}

	input {
		visibility: hidden;
		display: block;
		height: 0;
		width: 0;
		position: absolute;
		overflow: hidden;
	}
`;
