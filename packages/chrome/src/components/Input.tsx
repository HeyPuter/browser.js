import { css, type Pointer } from "dreamland/core";

export function Input(s: {
	value: Pointer<string> | string;
	label?: string;
	placeholder?: string;
	type?: string;
	autocomplete?: string;
	required?: boolean;
	disabled?: boolean;
	autofocus?: boolean;
	className?: string;
	onInput?: (e: Event) => void;
	onFocus?: (e: FocusEvent) => void;
	onBlur?: (e: FocusEvent) => void;
	onKeyDown?: (e: KeyboardEvent) => void;
	onKeyUp?: (e: KeyboardEvent) => void;
}) {
	const handleInput = (e: Event) => {
		// keep the original behavior: assign into the passed `value` (may be a Pointer)
		(s.value as any) = (e.target as HTMLInputElement).value;

		if (s.onInput) {
			s.onInput(e);
		}
	};

	return (
		<div class={`input-container ${s.className || ""}`}>
			{(s.label as any) && <label>{s.label}</label>}
			<input
				type={s.type || "text"}
				value={typeof s.value === "object" ? use(s.value) : s.value}
				placeholder={s.placeholder}
				autocomplete={s.autocomplete}
				required={s.required}
				disabled={s.disabled}
				autofocus={s.autofocus}
				on:input={handleInput}
				on:focus={s.onFocus as any}
				on:blur={s.onBlur as any}
				on:keydown={s.onKeyDown as any}
				on:keyup={s.onKeyUp as any}
			/>
		</div>
	);
}

Input.style = css`
	:scope {
		display: flex;
		flex-direction: column;
		gap: 0.5em;
		width: 100%;
	}

	label {
		font-size: 0.9em;
		color: var(--fg2);
	}

	input {
		background: var(--bg01);
		border: 1px solid var(--fg4);
		border-radius: 4px;
		padding: 0.75em;
		font-family: var(--font);
		font-size: 0.9em;
		color: var(--fg);
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent-transparent);
	}

	input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	input::placeholder {
		color: var(--fg4);
	}
`;
