import { createStore, css, type Component } from "dreamland/core";
import type { ScramjetFlags } from "@mercuryworkshop/scramjet";
import { defaultConfigDev } from "@mercuryworkshop/scramjet";
import { controller } from "..";

const flagStore = createStore<ScramjetFlags>(
	{
		...defaultConfigDev.flags,
	},
	{
		ident: "scramjet-flags",
		backing: "localstorage",
		autosave: "auto",
	}
);

// Flag descriptions for better UX
const flagDescriptions: Record<keyof ScramjetFlags, string> = {
	syncxhr: "Enable synchronous XMLHttpRequest support",
	strictRewrites: "enable extra security in js rewriter at a performance cost",
	cleanErrors: "prevent sites from noticing scramjet stack frames",
	sourcemaps:
		"prevent sites from noticing javascript transformations (at a performance cost)",
	destructureRewrites:
		"enable support for rewriting es6 destructure syntax (currently experimental)",
	allowInvalidJs:
		"if invalid javascript is evaluated, pass through unsafely instead of throwing",
	allowFailedIntercepts:
		"if an api interceptor fails, call the api with original input unsafely instead of throwing",
	encapsulateWorkers:
		"wrap web worker scripts in data urls to prevent scope issues (potentially buggy)",
	scramitize:
		"Trigger debugger whenever the string 'scramjet' or the real location is detected in attacker code (debug feature)",
	rewriterLogs: "Enable rewriter logging (debug feature)",
	captureErrors: "Capture and handle JavaScript errors (debug feature)",
	debugTrampolines: "Show proxied api in stack traces (debug feature)",
	debugSourceURL:
		"Make debugger recognize javascript source urls consistently (debug feature)",
	visitor: "Which javascript rewriting method to use",
};

const FlagEditor: Component<
	{
		inline?: boolean;
	},
	{},
	{
		isOpen: boolean;
	}
> = function (cx) {
	this.isOpen = false;

	const toggleFlag = (flag: keyof ScramjetFlags, value: boolean) => {
		(flagStore as any)[flag] = value;
		Object.assign(controller.scramjetConfig.flags, flagStore);
	};

	const setFlag = <K extends keyof ScramjetFlags>(
		flag: K,
		value: ScramjetFlags[K]
	) => {
		flagStore[flag] = value;
		Object.assign(controller.scramjetConfig.flags, flagStore);
	};

	const VISITOR_OPTIONS: Array<ScramjetFlags["visitor"]> = ["dpsc", "ppsc"];

	const resetToDefaults = () => {
		Object.assign(flagStore, {
			...defaultConfigDev.flags,
		});
		Object.assign(controller.scramjetConfig.flags, flagStore);
	};
	cx.mount = async () => {
		await controller.wait();
		Object.assign(controller.scramjetConfig.flags, flagStore);
	};

	return (
		<div
			class={use(this.inline).map(
				(inline) => `flag-editor ${inline ? "inline" : ""}`
			)}
		>
			<button
				class="toggle-button"
				on:click={() => {
					this.isOpen = !this.isOpen;
				}}
			>
				{use(this.isOpen).map((open) => (open ? "▼" : "▶"))} Flag Editor
			</button>
			{use(this.isOpen).andThen(
				<div class="editor-panel">
					<div class="header">
						<h3>Scramjet Feature Flags</h3>
						<button class="reset-button" on:click={resetToDefaults}>
							Reset to Defaults
						</button>
					</div>
					<div class="flags-list">
						{(Object.keys(flagStore) as Array<keyof ScramjetFlags>).map(
							(flag) => {
								if (flag === "visitor") {
									return (
										<div class="flag-item flag-item-toggle">
											<div class="flag-info">
												<span class="flag-name">{flag}</span>
												<span class="flag-desc">{flagDescriptions[flag]}</span>
											</div>
											<div
												class="flag-toggle-group"
												role="radiogroup"
												aria-label="visitor"
											>
												{VISITOR_OPTIONS.map((option) => (
													<button
														type="button"
														role="radio"
														aria-checked={use(flagStore.visitor).map((v) =>
															v === option ? "true" : "false"
														)}
														class={use(flagStore.visitor).map(
															(v) =>
																`flag-toggle-btn ${v === option ? "active" : ""}`
														)}
														on:click={() => setFlag("visitor", option)}
													>
														{option}
													</button>
												))}
											</div>
										</div>
									);
								}
								return (
									<label class="flag-item">
										<input
											type="checkbox"
											checked={use(flagStore[flag] as boolean)}
											on:change={(e: Event) =>
												toggleFlag(flag, (e.target as HTMLInputElement).checked)
											}
										/>
										<div class="flag-info">
											<span class="flag-name">{flag}</span>
											<span class="flag-desc">{flagDescriptions[flag]}</span>
										</div>
									</label>
								);
							}
						)}
					</div>
				</div>
			)}
		</div>
	);
};

FlagEditor.style = css`
	:scope {
		position: fixed;
		top: 1em;
		right: 1em;
		z-index: 1000;
		background: rgba(0, 0, 0, 0.9);
		border: 1px solid #444;
		border-radius: 8px;
		color: white;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		font-size: 14px;
		max-width: 400px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	:scope.inline {
		position: relative;
		display: flex;
		align-items: center;
		background: transparent;
		border: none;
		box-shadow: none;
		max-width: none;
	}

	.toggle-button {
		width: 100%;
		padding: 0.75em 1em;
		background: #333;
		border: none;
		border-radius: 8px 8px 0 0;
		color: white;
		cursor: pointer;
		font-size: 14px;
		font-weight: 500;
		text-align: left;
		transition: background 0.2s;
	}

	:scope.inline .toggle-button {
		padding: 0.35em 0.7em;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 0;
		font-size: 0.8em;
		line-height: 1.2;
		min-height: 28px;
		display: inline-flex;
		align-items: center;
	}

	:scope.inline .toggle-button:hover {
		background: #222;
	}

	.toggle-button:hover {
		background: #444;
	}

	.editor-panel {
		padding: 1em;
		border-top: 1px solid #444;
		max-height: 60vh;
		overflow-y: auto;
	}

	:scope.inline .editor-panel {
		position: absolute;
		top: calc(100% + 0.35em);
		right: 0;
		min-width: 320px;
		background: rgba(0, 0, 0, 0.95);
		border: 1px solid #444;
		border-radius: 8px;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
		z-index: 1000;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1em;
	}

	.header h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.reset-button {
		padding: 0.4em 0.8em;
		background: #555;
		border: 1px solid #666;
		border-radius: 4px;
		color: white;
		cursor: pointer;
		font-size: 12px;
		transition: background 0.2s;
	}

	.reset-button:hover {
		background: #666;
	}

	.flags-list {
		display: flex;
		flex-direction: column;
		gap: 0.75em;
	}

	.flag-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75em;
		cursor: pointer;
		padding: 0.5em;
		border-radius: 4px;
		transition: background 0.2s;
	}

	.flag-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.flag-item input[type="checkbox"] {
		margin-top: 0.2em;
		cursor: pointer;
		flex-shrink: 0;
	}

	.flag-item-toggle {
		cursor: default;
		align-items: center;
		gap: 0.75em;
	}

	.flag-item-toggle:hover {
		background: transparent;
	}

	.flag-item-toggle .flag-info {
		min-width: 0;
	}

	.flag-toggle-group {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		border: 1px solid #2f2f2f;
		border-radius: 999px;
		background: #141414;
		gap: 2px;
	}

	.flag-toggle-btn {
		border: 0;
		background: transparent;
		color: #9aa0a6;
		font-family: "Courier New", monospace;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.32em 0.85em;
		border-radius: 999px;
		cursor: pointer;
		min-width: 3em;
		transition:
			background 0.15s,
			color 0.15s,
			box-shadow 0.15s;
	}

	.flag-toggle-btn:hover {
		color: #e5e7eb;
	}

	.flag-toggle-btn.active {
		background: #2563eb;
		color: #fff;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
	}

	.flag-toggle-btn.active:hover {
		background: #3b82f6;
		color: #fff;
	}

	.flag-info {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
		flex: 1;
	}

	.flag-name {
		font-weight: 500;
		color: #fff;
		font-family: "Courier New", monospace;
		font-size: 13px;
	}

	.flag-desc {
		font-size: 12px;
		color: #aaa;
		line-height: 1.4;
	}
`;

export default FlagEditor;
