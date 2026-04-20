import { css, type FC, type Pointer } from "dreamland/core";

export function Input(
	this: FC<{
		value: Pointer<string> | string;
		label?: string;
		placeholder?: string;
		type?: string;
		autocomplete?: string;
		required?: boolean;
		disabled?: boolean;
		autofocus?: boolean;
		class?: string;
		"on:input"?: (e: Event) => void;
		"on:focus"?: (e: FocusEvent) => void;
		"on:blur"?: (e: FocusEvent) => void;
		"on:keydown"?: (e: KeyboardEvent) => void;
		"on:keyup"?: (e: KeyboardEvent) => void;
	}>
) {
	return (
		<div class={`input-container ${this.class || ""}`}>
			{this.label && <label>{this.label}</label>}
			<input
				type={this.type || "text"}
				value={use(this.value)}
				placeholder={this.placeholder}
				autocomplete={this.autocomplete}
				required={this.required}
				disabled={this.disabled}
				autofocus={this.autofocus}
				on:input={this["on:input"] as any}
				on:focus={this["on:focus"] as any}
				on:blur={this["on:blur"] as any}
				on:keydown={this["on:keydown"] as any}
				on:keyup={this["on:keyup"] as any}
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
		color: var(--text-70);
	}

	input {
		background: var(--toolbar_field);
		border: 1px solid var(--text-20);
		border-radius: var(--radius);
		padding: 0.75em;
		font-family: var(--font);
		font-size: 0.9em;
		color: var(--toolbar_field_text);
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	input:focus {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 2px var(--accent-20);
	}

	input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	input::placeholder {
		color: var(--field-text-50);
	}
`;
