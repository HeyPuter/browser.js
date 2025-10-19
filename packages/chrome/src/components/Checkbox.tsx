import { css } from "dreamland/core";

export function Checkbox(s: { value: boolean }) {
	return (
		<label>
			<input type="checkbox" checked={use(s.value)}></input>
		</label>
	);
}
Checkbox.style = css`
	:scope {
		width: 1em;
		height: 1em;
		background: var(--bg);
		border: 1px solid var(--bg20);
	}
	:scope:has(input:checked) {
		background: var(--accent);
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
