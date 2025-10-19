import { css } from "dreamland/core";
import type { Tab } from "../Tab";
import { browser } from "../Browser";
import { trimUrl } from "../components/Omnibar/utils";
import { createMenu } from "../components/Menu";
import { defaultFaviconUrl } from "../assets/favicon";
import { Icon } from "../components/Icon";
import { iconSearch } from "../icons";

export function NewTabPage(s: { tab: Tab }) {
	return (
		<div>
			<div class="topbar">
				{/*<div class="logo"></div>*/}
				<div class="inputcontainercontainer">
					<div class="inputcontainer">
						<div class="icon">
							<Icon icon={iconSearch}></Icon>
						</div>
						<input
							on:keydown={(e: KeyboardEvent) => {
								if (e.key === "Enter") {
									e.preventDefault();
									browser.searchNavigate((e.target as HTMLInputElement).value);
								}
							}}
							placeholder="Search Google or type A URL"
						></input>
					</div>
				</div>
				{/*<div class="clock">
					{new Date().toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</div>*/}
			</div>
			<div class="main">
				<div class="suggestions">
					{browser.globalhistory.slice(0, 5).map((entry) => (
						<div
							class="suggestion"
							on:contextmenu={(e: MouseEvent) => {
								createMenu({ left: e.clientX, top: e.clientY }, [
									{
										label: "Open",
										action: () => browser.activetab.pushNavigate(entry.url),
									},
									{
										label: "Open in New Tab",
										action: () => browser.newTab(entry.url),
									},
								]);
								e.preventDefault();
								e.stopPropagation();
							}}
							on:click={() => browser.newTab(entry.url)}
						>
							<div class="suggestioninner">
								<div class="circle">
									<img src={entry.favicon || defaultFaviconUrl} alt="favicon" />
								</div>
								<span class="title">{entry.title || trimUrl(entry.url)}</span>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
NewTabPage.style = css`
	:scope {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: var(--font);
		background: var(--bg01);
		color: var(--fg);

		padding: 5em;
	}

	.topbar {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3em;
	}
	.logo {
		width: 3em;
		height: 3em;
	}
	.clock {
		font-size: 1.5em;
		font-weight: bold;
		min-width: 4em;
		text-align: center;
	}

	.inputcontainercontainer {
		flex: 1;
		display: flex;
		justify-content: center;
	}
	.inputcontainer {
		flex: 1;
		max-width: 60em;
		box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1);
		background: var(--bg20);
		border-radius: var(--radius);
		display: flex;
		gap: 1em;
		align-items: center;
		padding: 0.6em 1em;
	}
	.inputcontainer .icon {
		width: 1.5em;
		height: 1.5em;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--fg2);
	}
	.inputcontainer input {
		background: none;
		border: none;
		outline: none;
		flex: 1;
		font-size: 1em;
		color: var(--fg);
		font-family: var(--font);
	}

	.main {
		flex: 1;
		width: 100%;
		max-width: 90em;
		margin-top: 2em;
	}

	.suggestions {
		display: flex;
		flex-direction: column;
		gap: 0.75em;
	}

	.suggestion {
		background: var(--bg02);
		border-radius: var(--radius);
		padding: 0.75em;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.suggestion:hover {
		background: var(--bg03);
	}
	.suggestioninner {
		display: flex;
		align-items: center;
		gap: 1em;
	}
	.circle {
		width: 2em;
		height: 2em;
		border-radius: 50%;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg);
	}
	.title {
		font-weight: 600;
	}
`;
