import { css, type FC } from "dreamland/core";

export function Checkbox(
	this: FC<{
		value: boolean;
		id?: string;
		disabled?: boolean;
		role?: string;
		tabIndex?: number;
		"on:change"?: (value: boolean) => void;
	}>
) {
	return (
		<span>
			<input
				type="checkbox"
				id={use(this.id)}
				role={use(this.role)}
				tabIndex={use(this.tabIndex)}
				checked={use(this.value)}
				disabled={use(this.disabled).map((v) => (v ? true : undefined))}
				on:change={(e: Event) =>
					this["on:change"]?.((e.currentTarget as HTMLInputElement).checked)
				}
			></input>
		</span>
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
		border-radius: min(0.25em, var(--radius-md));
		vertical-align: middle;
		transition:
			background 120ms ease,
			border-color 120ms ease;
		box-sizing: border-box;
		margin: 0;
	}

	:scope::before,
	:scope::after {
		content: "";
		position: absolute;
		inset: 0;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center / 75% no-repeat;
		transform: scale(0);
		transition: transform 120ms var(--ease-control);
		pointer-events: none;
	}

	:scope::before {
		background-color: var(--accent-shade-20);
		translate: 0 0.055em;
	}

	:scope::after {
		background-color: var(--toolbar_field);
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

	:scope:has(input:checked)::before,
	:scope:has(input:checked)::after {
		transform: scale(1);
	}

	:scope:has(input:disabled) {
		opacity: 0.5;
		filter: grayscale(100%);
		cursor: not-allowed;
	}

	input {
		opacity: 0;
		display: block;
		height: 100%;
		width: 100%;
		margin: 0;
		inset: 0;
		position: absolute;
		cursor: inherit;
	}
	:scope:has(input:focus-visible) {
		outline: 2px solid var(--tab_line);
		outline-offset: 2px;
	}
`;
