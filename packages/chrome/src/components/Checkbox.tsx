import { css } from "dreamland/core";

export function Checkbox(props: {
	value: boolean;
	id?: string;
	"on:change"?: (value: boolean) => void;
}) {
	return (
		<label>
			<input
				type="checkbox"
				id={use(props.id)}
				checked={use(props.value)}
				onChange={(e) => props["on:change"]?.(e.target.checked)}
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
		border-radius: 4px;
		vertical-align: middle;
		transition:
			background 120ms ease,
			border-color 120ms ease;
		box-sizing: border-box;
	}

	:scope::after {
		content: " ";
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--toolbar_field);
		font-size: 0.8em;
		transform: scale(0);
		transition: transform 120ms ease;
		pointer-events: none;
	}

	:scope:has(input:checked) {
		background: var(--tab_line);
		border-color: var(--tab_line);
	}

	:scope:has(input:checked)::after {
		transform: scale(1);
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
