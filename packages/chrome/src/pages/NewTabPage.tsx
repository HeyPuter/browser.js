import { css, type Component } from "dreamland/core";
import type { Tab } from "../Tab";
import { browser } from "../Browser";
import { trimUrl } from "../components/Omnibar/utils";
import { createMenu } from "../components/Menu";
import { defaultFaviconUrl } from "../assets/favicon";
import { Icon } from "../components/Icon";
import { iconSearch } from "../icons";

export const NewTabPage: Component<
	{
		tab: Tab;
	},
	{}
> = function () {
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
};
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
		align-items: center;
	}

	.icon {
		font-size: 1.5em;
		padding-left: 0.5em;
		color: var(--fg3);
	}

	.inputcontainer:focus-within {
		box-shadow: 0 0 2px var(--accent);
		outline: 1px solid var(--accent);
	}
	input {
		font-size: 1.25em;
		outline: none;
		padding: 1em;
		padding-top: 0.75em;
		padding-bottom: 0.75em;
		flex: 1;
		height: 100%;
		background: none;
		border: none;
		color: var(--fg);
	}

	.suggestions {
		width: 100%;

		grid-template-columns: repeat(5, 1fr);
		grid-template-rows: repeat(2, 1fr);
		display: grid;
	}

	.suggestion {
		cursor: pointer;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2em;
	}
	.suggestion:hover {
		background: var(--bg03);
	}
	.suggestioninner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5em;
	}
	.circle {
		width: 64px;
		height: 64px;

		border-radius: 50%;
		background-color: var(--bg02);
		display: flex;
		justify-content: center;
		align-items: center;
	}
	.title {
		width: 6em;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
		white-space: nowrap;
		line-height: 1.2;
	}
	.suggestion img {
		width: 32px;
		height: 32px;
	}

	.main {
		margin-top: 2.5em;
		width: 70%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1em;
	}

	.main {
		position: relative;
	}
`;
