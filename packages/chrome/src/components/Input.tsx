import { css, type Component, type Pointer } from "dreamland/core";

export const Input: Component<{
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
}> = function (cx) {
	const handleInput = (e: Event) => {
		this.value = (e.target as HTMLInputElement).value;

		if (this["on:input"]) {
			this["on:input"](e);
		}
	};

	return (
		<div class={`input-container ${this.class || ""}`}>
			{this.label && <label>{this.label}</label>}
			<input
				type={this.type || "text"}
				value={typeof this.value === "object" ? use(this.value) : this.value}
				placeholder={this.placeholder}
				autocomplete={this.autocomplete}
				required={this.required}
				disabled={this.disabled}
				autofocus={this.autofocus}
				on:input={handleInput}
				on:focus={this["on:focus"] as any}
				on:blur={this["on:blur"] as any}
				on:keydown={this["on:keydown"] as any}
				on:keyup={this["on:keyup"] as any}
			/>
		</div>
	);
};

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
