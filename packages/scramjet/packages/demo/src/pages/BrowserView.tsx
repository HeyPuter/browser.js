import { css, type Delegate, type Component } from "dreamland/core";
const { Plugin: ScramjetPlugin } = window.$scramjet;
import type { Frame } from "@mercuryworkshop/scramjet-controller";
import { controller } from "..";
import { demoSettingsStore } from "../store";
import homepage from "./homepage.html?raw";

const BrowserView: Component<
	{
		getFrame: Delegate<Frame>;
		active: boolean;
	},
	{},
	{
		url: string;
		frame: Frame | null;
		frameel: HTMLIFrameElement;
	}
> = function (cx) {
	this.url ??= demoSettingsStore.homeUrl;
	this.frame ??= null;

	cx.mount = async () => {
		await controller.wait();
		this.frame = controller.createFrame(this.frameel);
		this.getFrame(this.frame);
		const versionInfo = window.$scramjet.versionInfo ?? {};
		let realHomepage = homepage;
		realHomepage = realHomepage.replaceAll(
			"{{SCRAMJET_VERSION}}",
			String(versionInfo.version ?? "unknown")
		);
		realHomepage = realHomepage.replaceAll(
			"{{SCRAMJET_BUILD}}",
			String(versionInfo.build ?? "unknown")
		);
		realHomepage = realHomepage.replaceAll(
			"{{SCRAMJET_DATE_PRETTY}}",
			new Date(versionInfo.date).toLocaleString(undefined, {
				dateStyle: "short",
				timeStyle: "short",
			})
		);
		this.frameel.src = `data:text/html;base64,${btoa(realHomepage)}`;
		initPlugin(this.frame);
	};
	const initPlugin = (frame: Frame) => {
		const plugin = new ScramjetPlugin("url-watcher");
		plugin.tap(frame.hooks.frameInit.post, (context, props) => {
			if (!context.isTopLevel) return;
			this.url = context.client.url;
			plugin.tap(context.client.hooks.lifecycle.navigate, (context, props) => {
				this.url = props.url;
			});
		});
	};
	const navigate = () => {
		this.frame?.go(this.url);
	};

	return (
		<div
			class={use(this.active).map(
				(active) => `tab-panel browser-view ${active ? "active" : ""}`
			)}
		>
			<form
				class="url-form"
				on:submit={(e: SubmitEvent) => {
					e.preventDefault();
					navigate();
				}}
			>
				<div class="browser-omnibox-shell">
					<div class="omnibox-nav" aria-hidden="true">
						<button type="button" class="nav-btn">
							<span class="material-symbols-outlined">arrow_back</span>
						</button>
						<button type="button" class="nav-btn">
							<span class="material-symbols-outlined">arrow_forward</span>
						</button>
						<button type="button" class="nav-btn" on:click={navigate}>
							<span class="material-symbols-outlined">refresh</span>
						</button>
					</div>
					<input
						id="search"
						class="url-input"
						type="text"
						value={use(this.url)}
						spellcheck="false"
						placeholder="Enter URL or search..."
					/>
				</div>
			</form>
			<iframe this={use(this.frameel)}></iframe>
		</div>
	);
};

BrowserView.style = css`
	:scope {
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: none;
		flex-direction: column;
	}
	:scope.active {
		display: flex;
	}

	.url-form {
		display: flex;
		align-items: center;
		padding: 0.25em 0.45em;
		background: #0f0f0f;
		border-bottom: 1px solid #2a2a2a;
		min-width: 0;
	}
	.browser-omnibox-shell {
		display: flex;
		align-items: center;
		gap: 0.35em;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0;
		flex: 1;
	}
	.omnibox-nav {
		display: flex;
		align-items: center;
		gap: 0.15em;
		padding-right: 0.25em;
		border-right: 1px solid #2a2a2a;
	}
	.nav-btn {
		border: 0;
		background: transparent;
		color: #8f8f8f;
		width: 1.5em;
		height: 1.5em;
		padding: 0;
		border-radius: 3px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.nav-btn:hover {
		background: #1f1f1f;
		color: #d0d0d0;
	}
	.browser-omnibox-shell .material-symbols-outlined {
		font-size: 15px !important;
		line-height: 1 !important;
		font-variation-settings:
			"OPSZ" 20,
			"wght" 300,
			"FILL" 0,
			"GRAD" 0;
	}
	.url-input {
		box-sizing: border-box;
		width: 100%;
		padding: 0.22em 0.18em;
		font-size: 0.9em;
		border: 1px solid transparent;
		border-radius: 3px;
		background: transparent;
		color: #e5e7eb;
		outline: none;
	}
	.url-input::placeholder {
		color: #6f7680;
	}

	iframe {
		background: white;
		flex: 1;
		border: none;
	}
`;

export default BrowserView;
