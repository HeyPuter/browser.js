import { controller } from ".";
import { css, createStore, type Component } from "dreamland/core";
import { demoSettingsStore } from "./store";
import { FlagEditor } from "./components/FlagEditor";
import { BrowserView, type Frame } from "./pages/BrowserView";
import { RequestViewer, type RequestEntry } from "./pages/RequestViewer";
import { PlaygroundPanel } from "./pages/Playground";
import { ResponsePlayground } from "./pages/ResponsePlayground";
import { SettingsPanel } from "./pages/SettingsPage";

const urlStore = createStore(
	{
		url: demoSettingsStore.homeUrl,
	},
	{
		ident: "store",
		backing: "localstorage",
		autosave: "auto",
	}
);
export const App: Component<
	{},
	{},
	{
		activeTab:
			| "browser"
			| "requests"
			| "playground"
			| "response-playground"
			| "settings";
		frame: Frame;
		playgroundFrame: Frame;
		responsePlaygroundFrame: Frame;
		requests: RequestEntry[];
		selectedId: string | null;
	}
> = function (cx) {
	this.activeTab ??= "browser";
	this.requests ??= [];
	this.selectedId ??= null;
	cx.mount = async () => {
		await controller.wait();
		this.activeTab = "browser";
		this.requests = [];
		this.selectedId = null;

		this.playgroundFrame = controller.createFrame();
		this.responsePlaygroundFrame = controller.createFrame();
	};

	return (
		<div>
			<div class="top-bar">
				<div class="tab-bar">
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "browser" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "browser";
						}}
					>
						Browser
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "requests" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "requests";
						}}
					>
						Requests ({use(this.requests).map((reqs) => reqs.length)})
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "playground" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "playground";
						}}
					>
						Playground
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) =>
								`tab-button ${tab === "response-playground" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "response-playground";
						}}
					>
						Response Playground
					</button>
					<button
						class={use(this.activeTab).map(
							(tab) => `tab-button ${tab === "settings" ? "active" : ""}`
						)}
						on:click={() => {
							this.activeTab = "settings";
						}}
					>
						Settings
					</button>
				</div>
				<div class="top-actions">
					<FlagEditor
						inline={true}
						onFlagsChange={(flags) => {
							Object.assign(controller.scramjetConfig.flags, flags);
						}}
					/>
				</div>
			</div>
			<BrowserView
				active={use(this.activeTab).map((tab) => tab === "browser")}
				url={use(urlStore.url)}
				onUrlChange={(url) => {
					urlStore.url = url;
				}}
			/>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel requests-panel ${tab === "requests" ? "active" : ""}`
				)}
			>
				<RequestViewer
					frame={use(this.frame)}
					active={use(this.activeTab).map((tab) => tab === "requests")}
					requests={use(this.requests)}
					selectedId={use(this.selectedId)}
					maxRequests={use(demoSettingsStore.maxRequests)}
					onSelect={(id) => {
						this.selectedId = id;
					}}
					onSelectedChange={(id) => {
						this.selectedId = id;
					}}
					onRequestsChange={(updater) => {
						this.requests = updater(this.requests);
					}}
					onClear={() => {
						this.requests = [];
						this.selectedId = null;
					}}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel playground-panel ${tab === "playground" ? "active" : ""}`
				)}
			>
				<PlaygroundPanel
					frame={use(this.playgroundFrame)}
					active={use(this.activeTab).map((tab) => tab === "playground")}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel response-playground-panel ${tab === "response-playground" ? "active" : ""}`
				)}
			>
				<ResponsePlayground
					frame={use(this.responsePlaygroundFrame)}
					active={use(this.activeTab).map(
						(tab) => tab === "response-playground"
					)}
				/>
			</div>
			<div
				class={use(this.activeTab).map(
					(tab) =>
						`tab-panel settings-tab ${tab === "settings" ? "active" : ""}`
				)}
			>
				<SettingsPanel
					onHomeUrlApply={(url) => {
						urlStore.url = url;
					}}
				/>
			</div>
		</div>
	);
};

App.style = css`
	@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0");

	:scope {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		margin: 0;
		overflow: hidden;
		position: absolute;
		top: 0;
		left: 0;

		padding: 0;
		background: black;
		box-sizing: border-box;
	}
	.material-symbols-outlined {
		font-family: "Material Symbols Outlined";
		font-weight: normal;
		font-style: normal;
		font-size: 11px;
		line-height: 1;
		letter-spacing: normal;
		text-transform: none;
		display: inline-block;
		white-space: nowrap;
		word-wrap: normal;
		direction: ltr;
		-webkit-font-smoothing: antialiased;
	}
	.top-bar {
		display: flex;
		align-items: stretch;
		gap: 0;
		margin-bottom: 0;
		border-bottom: 1px solid #4a4a4a;
		background: #0f0f0f;
	}
	.tab-bar {
		display: flex;
		align-items: stretch;
		gap: 0;
	}
	.tab-button {
		border: 1px solid transparent;
		border-bottom: 0;
		background: transparent;
		color: #a8a8a8;
		padding: 0.24em 0.62em;
		border-radius: 0;
		cursor: pointer;
		font-size: 0.84em;
		line-height: 1.2;
		min-height: 28px;
		margin: 0;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
	}
	.tab-button:hover {
		background: #181818;
		color: #d0d0d0;
	}
	.tab-button.active {
		background: #1f1f1f;
		color: #fff;
		border-color: #4a4a4a;
		margin-bottom: -1px;
	}
	.top-actions {
		display: flex;
		align-items: center;
		margin-left: auto;
		padding: 0 0.35em;
		min-height: 28px;
	}
	.tab-panel {
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
		display: none;
	}
	.tab-panel.active {
		display: flex;
	}
	.requests-panel {
		flex-direction: column;
	}
	.playground-panel {
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
	.response-playground-panel {
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
	.settings-tab {
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
`;
