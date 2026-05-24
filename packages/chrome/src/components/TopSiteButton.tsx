import { css, type FC } from "dreamland/core";
import { createMenu } from "@components/Menu";
import { Icon } from "@components/Icon";
import { Favicon } from "@components/Favicon";
import { iconLink, iconMore, iconOpen } from "../icons";
import { tabsService } from "..";

export type TopSiteEntry = {
	url: URL;
	title: string;
	displayTitle: string;
	favicon: string | null;
	fallback: string;
};

export function TopSiteButton(this: FC<{ entry: TopSiteEntry }>) {
	const openMenu = (event: MouseEvent) => {
		createMenu({ left: event.clientX, top: event.clientY }, [
			{
				label: "Open",
				icon: iconLink,
				action: () => tabsService.activetab.pushNavigate(this.entry.url),
			},
			{
				label: "Open in New Tab",
				icon: iconOpen,
				action: () => tabsService.newTab(this.entry.url),
			},
		]);

		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<li class="top-site-outer">
			<div class="top-site-inner" on:contextmenu={openMenu}>
				<button
					class="top-site-button"
					title={this.entry.title}
					on:click={() => tabsService.activetab.pushNavigate(this.entry.url)}
					on:auxclick={() => tabsService.newTab(this.entry.url)}
				>
					<div class="tile" aria-hidden="true">
						<div class="icon-wrapper" class:has-favicon={!!this.entry.favicon}>
							{this.entry.favicon ? (
								<Favicon
									iconUrl={this.entry.favicon}
									domain={this.entry.url.hostname}
									size="unset"
								></Favicon>
							) : (
								<span class="fallback">{this.entry.fallback}</span>
							)}
						</div>
					</div>
					<div class="title">
						<span class="title-label">{this.entry.displayTitle}</span>
					</div>
					<button
						class="context-menu-button"
						title={`Open context menu for ${this.entry.title}`}
						aria-label={`Open context menu for ${this.entry.title}`}
						on:click={openMenu}
					>
						<Icon icon={iconMore} width="1rem" height="1rem"></Icon>
					</button>
				</button>
			</div>
		</li>
	);
}
TopSiteButton.style = css`
	:scope {
		width: 100%;
		max-width: var(--top-site-column-size);
	}

	.top-site-inner {
		position: relative;
		width: 100%;
	}

	.top-site-button {
		width: 100%;
		min-width: 0;
		padding: 0.6rem 0.5rem;
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		justify-items: center;
		border-radius: calc(var(--radius) * 2);
		transition:
			background-color 0.12s ease-out,
			color 0.12s ease-out;
	}

	.top-site-button:hover {
		background: var(--ntp-text-5);
	}

	.top-site-button:active {
		background: var(--ntp-text-10);
	}

	.tile {
		width: var(--top-site-tile-size);
		height: var(--top-site-tile-size);
		margin: auto;
		margin-top: 0.75rem;
		align-self: end;
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-15);
		border-radius: calc(var(--radius) * 2);
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			background 120ms ease-out,
			border-color 120ms ease-out;
	}

	:scope:is(:hover, :focus-within) .tile {
		background: color-mix(in srgb, var(--toolbar_field) 82%, var(--text-8));
		border-color: var(--ntp-text-20);
	}

	.top-site-button:focus-visible .tile {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 2px var(--accent-20);
		outline: none;
	}

	.icon-wrapper {
		width: var(--top-site-icon-size);
		height: var(--top-site-icon-size);
		border-radius: calc(var(--radius) * 1.5);
		background: var(--accent-15);
		color: var(--accent-tint-50);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		font-size: 1rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.icon-wrapper.has-favicon {
		background: var(--text-10);
		color: inherit;
	}

	.icon-wrapper :global(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.fallback {
		line-height: 1;
		user-select: none;
	}

	.context-menu-button {
		position: absolute;
		top: 0.5rem;
		right: 0.3rem;
		width: 1.75rem;
		height: 1.75rem;
		border: 1px solid var(--text-20);
		border-radius: 999px;
		background: var(--toolbar_field);
		color: var(--text-60);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 100ms ease-out,
			background 100ms ease-out,
			border-color 100ms ease-out;
	}

	:scope:is(:hover, :focus-within) .context-menu-button {
		opacity: 1;
	}

	.context-menu-button:hover,
	.context-menu-button:focus-visible {
		background: var(--popup);
		border-color: var(--text-30);
		opacity: 1;
	}

	.title {
		width: 100%;
		min-width: 0;
		padding-block: 0.2rem;
		padding-inline: 0.15rem;
		display: flex;
		justify-content: center;
		text-align: center;
	}

	.title-label {
		display: block;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.88rem;
		line-height: 1.25;
		color: var(--ntp-text-70);
		user-select: none;
	}

	@media (max-width: 720px) {
		:scope {
			max-width: 6.25rem;
		}

		.top-site-button {
			grid-template-rows: 6.25rem auto;
		}
	}
`;
