import { css, type FC } from "dreamland/core";
import type { Tab } from "../Tab/Tab";
import { versionInfo } from "@mercuryworkshop/scramjet/bundled";
import { Icon } from "@components/Icon";
import { Checkbox } from "@components/Checkbox";
import { Button } from "@components/Button";
import { Input } from "@components/Input";
import { AVAILABLE_SEARCH_ENGINES } from "@components/Omnibar/suggestions";
import { THEMES, type ThemeDefinition } from "../themes";
import type { TabLayoutMode } from "../services/SettingsService";
import { TWEAKS, TWEAK_KEYS, type TweakKey, type Tweaks } from "../tweaks";

import {
	iconSettings,
	iconOptions,
	iconSearchOutline as iconSearch,
	iconExtension,
	iconPrivacy,
	iconAbout,
	iconBrush,
	iconError,
	iconAdd,
	iconBack,
	iconClose,
	iconForwards,
	iconMore,
	iconRefresh,
	type IconDescription,
} from "../icons";
import { settingsService } from "..";

function ThemePreview(this: FC<{ theme: (typeof THEMES)[number] }>) {
	const theme = this.theme;

	return (
		<div
			aria-hidden="true"
			style={`--preview-frame: ${theme.tokens.frame}; --preview-toolbar: ${theme.tokens.toolbar}; --preview-toolbar-text: ${theme.tokens.toolbar_text}; --preview-tab-text: ${theme.tokens.tab_background_text}; --preview-field: ${theme.tokens.toolbar_field}; --preview-field-text: ${theme.tokens.toolbar_field_text}; --preview-accent: ${theme.tokens.tab_line}; --preview-icons: ${theme.tokens.icons}; --preview-border: ${theme.tokens.popup_border}; --preview-separator: ${theme.tokens.toolbar_top_separator};`}
		>
			<div class="preview-window">
				<div class="preview-tabstrip">
					<div class="preview-tab active">
						<span class="preview-site">
							<span class="preview-favicon"></span>
							<span class="preview-tab-title"></span>
						</span>
						<Icon class="preview-close" icon={iconClose} />
					</div>
					<div class="preview-tab">
						<span class="preview-site">
							<span class="preview-favicon"></span>
							<span class="preview-tab-title short"></span>
						</span>
						<Icon class="preview-close" icon={iconClose} />
					</div>
					<Icon class="preview-add" icon={iconAdd} />
				</div>
				<div class="preview-toolbar">
					<div class="preview-nav-controls">
						<Icon class="preview-control" icon={iconBack} />
						<Icon class="preview-control disabled" icon={iconForwards} />
						<Icon class="preview-control" icon={iconRefresh} />
					</div>
					<div class="preview-field">
						<Icon class="preview-site-indicator" icon={iconOptions} />
						<span class="preview-address"></span>
					</div>
					<Icon class="preview-menu" icon={iconMore} />
				</div>
			</div>
		</div>
	);
}

ThemePreview.style = css`
	:scope {
		height: 4rem;
	}

	.preview-window {
		height: 100%;
		overflow: hidden;
	}

	.preview-tabstrip {
		height: 2.25rem;
		padding-inline: 0.2rem;
		background: var(--preview-frame);
		color: var(--preview-tab-text);
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}

	.preview-tab {
		width: min(34%, 10rem);
		min-width: 4.5rem;
		height: 1.75rem;
		padding: 0 0.45rem;
		border-radius: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		opacity: 0.68;
	}

	.preview-tab.active {
		background: var(--preview-toolbar);
		color: var(--preview-toolbar-text);
		opacity: 1;
		outline: 1px solid var(--preview-border);
		outline-offset: -1px;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	}

	.preview-favicon {
		width: 0.63rem;
		height: 0.63rem;
		border-radius: 50%;
		background: var(--preview-accent);
		flex: none;
	}

	.preview-tab-title {
		width: 58%;
		height: 2px;
		border-radius: 1px;
		background: currentColor;
		opacity: 0.42;
	}

	.preview-tab-title.short {
		width: 42%;
	}

	.preview-site {
		display: flex;
		gap: 0.35rem;
		flex-grow: 1;
		align-items: center;
	}

	.preview-close {
		width: 0.45rem;
		height: 0.45rem;
		flex: none;
		opacity: 0.65;
	}

	.preview-add {
		width: 0.7rem;
		height: 0.7rem;
		margin: 0 0 0.2rem 0.1rem;
		align-self: center;
		opacity: 0.75;
		flex: none;
	}

	.preview-toolbar {
		height: 2rem;
		padding: 0.25rem 0.4rem;
		background: var(--preview-toolbar);
		border-bottom: 1px solid var(--preview-separator);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--preview-icons);
	}

	.preview-nav-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--preview-icons);
		font-size: 0.9rem;
	}

	.preview-control {
		width: 0.8rem;
		height: 0.8rem;
		flex: none;
	}

	.preview-control.disabled {
		opacity: 0.38;
	}

	.preview-field {
		height: 1.35rem;
		min-width: 0;
		flex: 1;
		border-radius: 4px;
		background: var(--preview-field);
		color: var(--preview-field-text);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.5rem;
		font-size: 0.8rem;
	}

	.preview-site-indicator {
		width: 0.5rem;
		height: 0.5rem;
		color: var(--preview-accent);
		flex: none;
	}

	.preview-address {
		width: 26%;
		height: 2px;
		border-radius: 1px;
		background: currentColor;
		opacity: 0.3;
	}

	.preview-menu {
		width: 0.8rem;
		height: 0.8rem;
		opacity: 0.8;
		flex: none;
	}
`;

type SidebarLocation = "left" | "right";

const LAYOUT_OPTIONS: readonly {
	id: TabLayoutMode;
	name: string;
	description: string;
}[] = [
	{
		id: "horizontal",
		name: "Default",
		description: "Tabs in a single row above the address bar.",
	},
	{
		id: "bottom",
		name: "Bottom",
		description: "Tabs along the bottom edge of the window.",
	},
	{
		id: "compact",
		name: "Compact",
		description: "Tabs beside the address bar in one compact row.",
	},
	{
		id: "hybrid",
		name: "Hybrid",
		description: "Vertical tabs beside a horizontal address bar.",
	},
	{
		id: "vertical",
		name: "Vertical",
		description: "Tabs and address controls together in a sidebar.",
	},
];

function LayoutPreview(
	this: FC<{ layout: TabLayoutMode; sidebar?: SidebarLocation }>
) {
	const sidebar = this.sidebar ?? "left";

	return (
		<div
			aria-hidden="true"
			class={`layout-preview layout-${this.layout} sidebar-${sidebar}`}
		>
			<div class="layout-tab-region">
				<div class="layout-vertical-field">
					<span class="layout-field-dot"></span>
					<span class="layout-field-line"></span>
				</div>
				<div class="layout-tabs">
					<span class="layout-tab active">
						<span class="layout-favicon"></span>
						<span class="layout-tab-line"></span>
					</span>
					<span class="layout-tab">
						<span class="layout-favicon secondary"></span>
						<span class="layout-tab-line short"></span>
					</span>
					<span class="layout-tab third">
						<span class="layout-favicon tertiary"></span>
						<span class="layout-tab-line"></span>
					</span>
				</div>
			</div>

			<div class="layout-toolbar">
				<div class="layout-field">
					<span class="layout-field-dot"></span>
					<span class="layout-field-line"></span>
				</div>
				<div class="layout-inline-tabs">
					<span class="layout-inline-tab active">
						<span class="layout-favicon"></span>
						<span class="layout-tab-line"></span>
					</span>
					<span class="layout-inline-tab">
						<span class="layout-favicon secondary"></span>
						<span class="layout-tab-line short"></span>
					</span>
				</div>
				<span class="layout-menu-dots">
					<span></span>
					<span></span>
					<span></span>
				</span>
			</div>

			<div class="layout-content">
				<div class="layout-page">
					<span class="layout-page-heading"></span>
					<div class="layout-page-body">
						<span class="layout-page-image"></span>
						<div class="layout-page-copy">
							<span></span>
							<span></span>
							<span class="short"></span>
							<span class="shorter"></span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

LayoutPreview.style = css`
	:scope {
		display: grid;
		height: 7.25rem;
	}

	.layout-preview {
		height: 100%;
		overflow: hidden;
		background: var(--ntp_background);
		color: var(--toolbar_text);
	}

	.layout-horizontal {
		grid-template:
			"tabs" 1.6rem
			"toolbar" 1.45rem
			"content" 1fr / 1fr;
	}

	.layout-bottom {
		grid-template:
			"toolbar" 1.45rem
			"content" 1fr
			"tabs" 1.6rem / 1fr;
	}

	.layout-compact {
		grid-template:
			"toolbar" 1.7rem
			"content" 1fr / 1fr;
	}

	.layout-hybrid {
		grid-template:
			"tabs toolbar" 1.45rem
			"tabs content" 1fr / 29% 1fr;
	}

	.layout-hybrid.sidebar-right {
		grid-template:
			"toolbar tabs" 1.45rem
			"content tabs" 1fr / 1fr 29%;
	}

	.layout-vertical {
		grid-template: "tabs content" 1fr / 39% 1fr;
	}

	.layout-vertical.sidebar-right {
		grid-template: "content tabs" 1fr / 1fr 39%;
	}

	.layout-tab-region {
		grid-area: tabs;
		min-width: 0;
		min-height: 0;
		padding: 0.2rem 0.25rem;
		background: var(--frame);
		display: flex;
		align-items: center;
		gap: 0.2rem;
		position: relative;
		z-index: 1;
	}

	.layout-horizontal .layout-tab-region {
		border-bottom: 1px solid var(--text-15);
	}

	.layout-bottom .layout-tab-region {
		border-top: 1px solid var(--popup_border);
	}

	.layout-tabs {
		min-width: 0;
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.18rem;
	}

	.layout-tab,
	.layout-inline-tab {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--tab_background_text);
		opacity: 0.65;
	}

	.layout-tab {
		height: 1.1rem;
		width: 31%;
		padding-inline: 0.25rem;
		border-radius: 0.2rem;
	}

	.layout-tab.active,
	.layout-inline-tab.active {
		background: var(--toolbar);
		color: var(--toolbar_text);
		opacity: 1;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
	}

	.layout-favicon {
		width: 0.32rem;
		height: 0.32rem;
		border-radius: 50%;
		background: var(--tab_line);
		flex: none;
	}

	.layout-favicon.secondary {
		background: var(--tab_loading);
		opacity: 0.75;
	}

	.layout-favicon.tertiary {
		background: var(--icons);
		opacity: 0.55;
	}

	.layout-tab-line {
		width: 62%;
		height: 2px;
		border-radius: 1px;
		background: currentColor;
		opacity: 0.38;
	}

	.layout-tab-line.short {
		width: 42%;
	}

	.layout-toolbar {
		grid-area: toolbar;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		background: var(--toolbar);
		display: flex;
		align-items: center;
		gap: 0.25rem;
		position: relative;
		z-index: 1;
	}

	.layout-menu-dots {
		display: flex;
		align-items: center;
		gap: 0.09rem;
		flex: none;
	}

	.layout-menu-dots span {
		width: 0.13rem;
		height: 0.13rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
	}

	.layout-field,
	.layout-vertical-field {
		min-width: 0;
		background: var(--toolbar_field);
		color: var(--toolbar_field_text);
		display: flex;
		align-items: center;
		gap: 0.2rem;
		border-radius: 0.2rem;
		box-shadow: inset 0 0 0 1px var(--text-10);
	}

	.layout-field {
		height: 0.85rem;
		padding-inline: 0.3rem;
		flex: 1;
	}

	.layout-field-dot {
		width: 0.28rem;
		height: 0.28rem;
		border-radius: 50%;
		background: var(--tab_line);
		flex: none;
	}

	.layout-field-line {
		width: 38%;
		height: 0.16rem;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.22;
	}

	.layout-inline-tabs,
	.layout-vertical-field {
		display: none;
	}

	.layout-compact .layout-tab-region {
		display: none;
	}

	.layout-compact .layout-field {
		flex: 0 1 38%;
	}

	.layout-compact .layout-inline-tabs {
		min-width: 0;
		align-self: stretch;
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	.layout-inline-tab {
		width: 42%;
		height: 1.1rem;
		padding-inline: 0.25rem;
		border-radius: 0.2rem;
	}

	.layout-hybrid .layout-tab-region,
	.layout-vertical .layout-tab-region {
		padding: 0.4rem 0.35rem;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		border-right: 1px solid var(--text-15);
	}

	.layout-hybrid.sidebar-right .layout-tab-region,
	.layout-vertical.sidebar-right .layout-tab-region {
		border-right: none;
		border-left: 1px solid var(--text-15);
	}

	.layout-hybrid .layout-tabs,
	.layout-vertical .layout-tabs {
		flex: none;
		width: 100%;
		flex-direction: column;
		align-items: stretch;
		gap: 0.18rem;
	}

	.layout-hybrid .layout-tab,
	.layout-vertical .layout-tab {
		width: 100%;
		height: 0.8rem;
		padding-inline: 0.2rem;
	}

	.layout-hybrid .layout-tab.third,
	.layout-vertical .layout-tab.third {
		display: flex;
	}

	.layout-vertical .layout-vertical-field {
		height: 0.85rem;
		padding-inline: 0.25rem;
		display: flex;
	}

	.layout-vertical .layout-toolbar {
		display: none;
	}

	.layout-content {
		grid-area: content;
		min-width: 0;
		min-height: 0;
		background: var(--ntp_background);
		color: var(--ntp_text);
		display: flex;
		align-items: flex-start;
		justify-content: flex-start;
		padding: 0.8rem 0.75rem;
	}

	.layout-page {
		width: min(82%, 7rem);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.38rem;
	}

	.layout-page-body {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.layout-page-copy {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.layout-page-copy span {
		width: 82%;
		height: 0.16rem;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.12;
	}

	.layout-page-heading {
		width: 45%;
		height: 0.25rem;
		border-radius: 999px;
		background: currentColor;
		opacity: 0.25;
	}

	.layout-page-copy span.short {
		width: 62%;
	}

	.layout-page-copy span.shorter {
		width: 48%;
	}

	.layout-page-image {
		width: 1.35rem;
		aspect-ratio: 3 / 4;
		border-radius: 0.22rem;
		background: var(--ntp-text-10);
		flex: none;
	}
`;

/**
 * The theme picker for one appearance, as a section of the Themes pane.
 */
function themeSection(
	appearance: ThemeDefinition["appearance"],
	title: string,
	description: string
) {
	return (
		<section class="setting-section">
			<div class="section-header">
				<h2>{title}</h2>
				<p class="description">{description}</p>
			</div>
			<div class="section-content" style="padding-left: 0;">
				<div class="theme-grid">
					{THEMES.filter((theme) => theme.appearance === appearance).map(
						(theme) => (
							<div
								class="theme-card"
								class:selected={use(settingsService.settings.themeId).map(
									(id) => id === theme.id
								)}
								on:click={() => {
									settingsService.settings.themeId = theme.id;
								}}
							>
								<ThemePreview theme={theme} />
								<div class="theme-info">
									<h5>{theme.name}</h5>
									<p>{theme.description}</p>
								</div>
							</div>
						)
					)}
				</div>
			</div>
		</section>
	);
}

/**
 * One radio group for a single tweak axis, generated from that axis' entry in
 * `TWEAKS` so the Appearance pane never drifts out of step with tweaks.ts.
 */
function tweakSection<K extends TweakKey>(key: K) {
	const definition = TWEAKS[key];
	// `Settings` carries the tweak keys verbatim; the cast is only so that TS
	// relates `key` to the option type, which it can't do by indexing the wider
	// `Settings` with a type parameter.
	const tweaks = settingsService.settings as Tweaks;

	return (
		<section class="setting-section">
			<div class="section-header">
				<h2>{definition.title}</h2>
				<p class="description">{definition.description}</p>
			</div>
			<div class="section-content">
				<div class="setting-group">
					<div class="radio-group">
						{definition.options.map((option) => (
							<div class="radio-option">
								<input
									type="radio"
									id={`tweak-${definition.slug}-${option.id}`}
									name={`tweak-${definition.slug}`}
									value={option.id}
									checked={use(tweaks[key]).map((value) => value === option.id)}
									on:change={() => {
										tweaks[key] = option.id;
									}}
								/>
								<label
									for={`tweak-${definition.slug}-${option.id}`}
									class="label-multiline"
								>
									<span>{option.name}</span>
									<span class="description">{option.description}</span>
								</label>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

export function SettingsPage(
	this: FC<{ tab: Tab; selected: string }, { searchQuery: string }>
) {
	this.searchQuery = "";

	const button = (id: string, icon: IconDescription, name: string) => {
		return (
			<div
				class="nav-button"
				class:active={use(this.selected).map((s) => s === id)}
				on:click={() => {
					this.selected = id;
					// this.tab.url = new URL(`puter://settings/${id}`);
					this.tab.history.push(new URL(`puter://settings/${id}`));
				}}
			>
				<Icon icon={icon} />
				<span>{name}</span>
			</div>
		);
	};

	use(this.selected).listen((s) => {
		console.log("Selected settings category:", s);
	});

	return (
		<div class="settings-page">
			<div class="sidebar">
				<h1>Settings</h1>
				<nav class="navigation">
					{button("general", iconSettings, "General")}
					{button("appearance", iconOptions, "Appearance")}
					{button("themes", iconBrush, "Themes")}
					{button("search", iconSearch, "Search")}
					{button("privacy", iconPrivacy, "Privacy & Security")}
					{/* {button("extensions", iconExtension, "Extensions")} */}
					{button("about", iconAbout, "About")}
				</nav>
			</div>
			<div class="content">
				<div class="search-container">
					<Input placeholder="Find in Settings" value={use(this.searchQuery)} />
				</div>
				<div class="settings-content">
					<h1>
						{use(this.selected).map(
							(s) => s.charAt(0).toUpperCase() + s.slice(1)
						)}
					</h1>
					{/* General Tab */}
					{use(this.selected).map((selected) =>
						selected === "general" ? (
							<div class="settings-tab">
								<section class="setting-section">
									<div class="section-header">
										<h2>Startup</h2>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<h4>When Browser Starts</h4>
											<div class="radio-group">
												<div class="radio-option">
													<input
														type="radio"
														id="startup-new-tab"
														name="startupPage"
														value="new-tab"
														checked={use(
															settingsService.settings.startupPage
														).map((v) => v === "new-tab")}
														on:change={() => {
															settingsService.settings.startupPage = "new-tab";
														}}
													/>
													<label for="startup-new-tab">Open New Tab Page</label>
												</div>
												<div class="radio-option">
													<input
														type="radio"
														id="startup-continue"
														name="startupPage"
														value="continue"
														checked={use(
															settingsService.settings.startupPage
														).map((v) => v === "continue")}
														on:change={() => {
															settingsService.settings.startupPage = "continue";
														}}
													/>
													<label for="startup-continue">
														Continue where you left off
													</label>
												</div>
											</div>
										</div>
									</div>
								</section>

								<section class="setting-section">
									<div class="section-header">
										<h2>Bookmarks</h2>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div
												class="checkbox-option"
												class:disabled={use(
													settingsService.settings.tabLayout
												).map((layout) => layout === "vertical")}
											>
												<Checkbox
													value={use(settingsService.settings.showBookmarksBar)}
													id="show-bookmarks-bar"
													disabled={use(settingsService.settings.tabLayout).map(
														(layout) => layout === "vertical"
													)}
												/>
												{use(settingsService.settings.tabLayout)
													.map((layout) => layout === "vertical")
													.and(
														<label
															for="show-bookmarks-bar"
															class="label-multiline"
														>
															<span>Always show bookmarks bar</span>
															<span class="description">
																Bookmarks are always shown in vertical mode.
															</span>
														</label>
													)
													.or(
														<label for="show-bookmarks-bar">
															Show bookmarks bar
														</label>
													)}
											</div>
										</div>
									</div>
								</section>
							</div>
						) : null
					)}

					{/* Appearance Tab */}
					{use(this.selected).map((selected) =>
						selected === "appearance" ? (
							<div class="settings-tab">
								{/* <section class="setting-section">
									<div class="section-header">
										<h2>Page Appearance</h2>
										<p class="description">
											Control the appearance of websites you visit.
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="radio-group">
												<div class="radio-option">
													<input
														type="radio"
														id="appearance-system"
														name="appearance"
														value="system"
														checked={
															settingsService.settings.appearance === "system"
														}
														on:change={() => {
															settingsService.settings.appearance = "system";
														}}
													/>
													<label for="appearance-system">System Default</label>
												</div>
												<div class="radio-option">
													<input
														type="radio"
														id="appearance-dark"
														name="appearance"
														value="dark"
														checked={
															settingsService.settings.appearance === "dark"
														}
														on:change={() => {
															settingsService.settings.appearance = "dark";
														}}
													/>
													<label for="appearance-dark">Dark</label>
												</div>
												<div class="radio-option">
													<input
														type="radio"
														id="appearance-light"
														name="appearance"
														value="light"
														checked={
															settingsService.settings.appearance === "light"
														}
														on:change={() => {
															settingsService.settings.appearance = "light";
														}}
													/>
													<label for="appearance-light">Light</label>
												</div>
											</div>
										</div>
									</div>
								</section> */}
								<section class="setting-section">
									<div class="section-header">
										<h2>Browser Layout (Beta)</h2>
										<p class="description">Choose where tabs are displayed.</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											{use(settingsService.settings.verticalTabJustify).map(
												(sidebar) => (
													<div class="layout-grid">
														{LAYOUT_OPTIONS.map((option) => (
															<label
																for={`layout-${option.id}`}
																class="layout-card"
																class:selected={use(
																	settingsService.settings.tabLayout
																).map((value) => value === option.id)}
															>
																<input
																	class="layout-radio"
																	type="radio"
																	id={`layout-${option.id}`}
																	name="layout"
																	value={option.id}
																	checked={use(
																		settingsService.settings.tabLayout
																	).map((value) => value === option.id)}
																	on:change={() => {
																		settingsService.settings.tabLayout =
																			option.id;
																	}}
																/>
																<LayoutPreview
																	layout={option.id}
																	sidebar={sidebar}
																/>
																<span class="layout-info">
																	<span class="layout-name">{option.name}</span>
																	<span class="description">
																		{option.description}
																	</span>
																</span>
															</label>
														))}
													</div>
												)
											)}
										</div>
									</div>
								</section>
								{use(settingsService.settings.tabLayout)
									.map((l) => l === "hybrid" || l === "vertical")
									.and(
										<section class="setting-section">
											<div class="section-header">
												<h2>Sidebar Location</h2>
												<p class="description">
													Choose which side of the screen the sidebar is on.
												</p>
											</div>
											<div class="section-content">
												<div class="setting-group">
													{use(settingsService.settings.tabLayout).map(
														(layout) => (
															<div class="layout-grid sidebar-location-grid">
																{(["left", "right"] as const).map((sidebar) => (
																	<label
																		for={`sidebar-${sidebar}`}
																		class="layout-card"
																		class:selected={use(
																			settingsService.settings
																				.verticalTabJustify
																		).map((value) => value === sidebar)}
																	>
																		<input
																			class="layout-radio"
																			type="radio"
																			id={`sidebar-${sidebar}`}
																			name="sidebar-location"
																			value={sidebar}
																			checked={use(
																				settingsService.settings
																					.verticalTabJustify
																			).map((value) => value === sidebar)}
																			on:change={() => {
																				settingsService.settings.verticalTabJustify =
																					sidebar;
																			}}
																		/>
																		<LayoutPreview
																			layout={
																				layout === "vertical"
																					? "vertical"
																					: "hybrid"
																			}
																			sidebar={sidebar}
																		/>
																		<span class="layout-info compact">
																			<span class="layout-name">
																				{sidebar === "left" ? "Left" : "Right"}
																			</span>
																		</span>
																	</label>
																))}
															</div>
														)
													)}
												</div>
											</div>
										</section>
									)}
								<section class="setting-section">
									<div class="section-header">
										<h2>Density</h2>
										<p class="description">
											Adjust the spacing and sizing of UI elements.
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="radio-group">
												<div class="radio-option">
													<input
														type="radio"
														id="ui-dense"
														name="ui-dense"
														value="compact"
														checked={
															settingsService.settings.uiProfile === "compact"
														}
														on:change={() => {
															settingsService.settings.uiProfile = "compact";
														}}
													/>
													<label for="ui-dense" class="label-multiline">
														<span>Compact</span>
														<span class="description">
															Reduced spacing for smaller screens.
														</span>
													</label>
												</div>
												<div class="radio-option">
													<input
														type="radio"
														id="ui-default"
														name="ui-dense"
														value="default"
														checked={
															settingsService.settings.uiProfile === "default"
														}
														on:change={() => {
															settingsService.settings.uiProfile = "default";
														}}
													/>
													<label for="ui-default" class="label-multiline">
														<span>Comfortable</span>
														<span class="description">
															Balanced spacing for most screens.
														</span>
													</label>
												</div>
												<div class="radio-option">
													<input
														type="radio"
														id="ui-sparse"
														name="ui-dense"
														value="touch"
														checked={
															settingsService.settings.uiProfile === "touch"
														}
														on:change={() => {
															settingsService.settings.uiProfile = "touch";
														}}
													/>
													<label for="ui-sparse" class="label-multiline">
														<span>Cozy</span>
														<span class="description">
															More sparse layout optimized for touchscreens.
														</span>
													</label>
												</div>
											</div>
										</div>
									</div>
								</section>
								{/* The style tweaks: independent axes of shape, motion and
								    iconography. Coarse layout choices come first, so these
								    read as a progression from structure down to detail. */}
								{TWEAK_KEYS.map((key) => tweakSection(key))}
							</div>
						) : null
					)}

					{/* Themes Tab */}
					{use(this.selected).map((selected) =>
						selected === "themes" ? (
							<div class="settings-tab">
								{themeSection(
									"dark",
									"Dark",
									"Palettes with a dark toolbar and tab strip."
								)}
								{themeSection(
									"light",
									"Light",
									"Palettes with a light toolbar and tab strip."
								)}
							</div>
						) : null
					)}

					{/* Search Tab */}
					{use(this.selected).map((selected) =>
						selected === "search" ? (
							<div class="settings-tab">
								<section class="setting-section">
									<div class="section-header">
										<h3>Default Search Engine</h3>
										<p class="description">
											Choose which search engine to use when searching from the
											address bar
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<select
												class="select-input"
												value={use(
													settingsService.settings.defaultSearchEngine
												)}
											>
												{Object.keys(AVAILABLE_SEARCH_ENGINES).map((key) => (
													<option value={key}>
														{AVAILABLE_SEARCH_ENGINES[key].name}
													</option>
												))}
											</select>
										</div>
									</div>
								</section>

								<section class="setting-section">
									<div class="section-header">
										<h2>Search Suggestions</h2>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="search-suggestions"
													value={use(
														settingsService.settings.searchSuggestionsEnabled
													)}
												/>
												<label for="search-suggestions">
													Show search and site suggestions in the address bar
												</label>
											</div>
										</div>
									</div>
								</section>
							</div>
						) : null
					)}

					{/* Privacy Tab */}
					{use(this.selected).map((selected) =>
						selected === "privacy" ? (
							<div class="settings-tab">
								<section class="setting-section">
									<div class="section-header">
										<h2>Trackers & Site Data</h2>
										<p class="description">
											Control how the browser handles trackers and your data
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="block-trackers"
													value={use(settingsService.settings.blockTrackers)}
												/>
												<label for="block-trackers">
													Block third-party trackers
												</label>
											</div>

											<div class="checkbox-option">
												<Checkbox
													id="do-not-track"
													value={use(settingsService.settings.doNotTrack)}
												/>
												<label for="do-not-track">
													Send 'Do Not Track' with browsing requests
												</label>
											</div>
										</div>
									</div>
								</section>
								<section class="setting-section">
									<div class="section-header">
										<h2>Browsing History</h2>
										<p class="description">
											Control what data is saved or cleared
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="clear-history"
													value={use(
														settingsService.settings.clearHistoryOnExit
													)}
												/>
												<label for="clear-history">
													Clear history when browser closes
												</label>
											</div>
											<br />
											<Button variant="primary">Clear Browsing Data...</Button>
										</div>
									</div>
								</section>
							</div>
						) : null
					)}

					{/* Extensions Tab */}
					{use(this.selected).map((selected) =>
						selected === "extensions" ? (
							<div class="settings-tab">
								<section class="setting-section">
									<div class="section-header">
										<h3>Installed Extensions</h3>
										<p class="description">Manage your browser extensions</p>
									</div>
									<div class="section-content">
										<div class="extensions-list">
											<div class="extension-item">
												<div class="extension-info">
													<div class="extension-icon">
														<span class="icon-inner">
															<Icon icon={iconExtension} />
														</span>
													</div>
													<div class="extension-details">
														<h4>No extensions installed</h4>
														<p>Extensions will appear here once installed</p>
													</div>
												</div>
											</div>
										</div>
									</div>
								</section>

								<section class="setting-section">
									<div class="section-header">
										<h2>Developer Mode</h2>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="dev-mode"
													value={use(
														settingsService.settings.extensionsDevMode
													)}
												/>
												<label for="dev-mode">Enable developer mode</label>
											</div>

											{use(settingsService.settings.extensionsDevMode).map(
												(enabled) =>
													enabled && (
														<div class="dev-buttons">
															<Button variant="primary">Load Unpacked</Button>
															<Button variant="secondary">
																Pack Extension
															</Button>
														</div>
													)
											)}
										</div>
									</div>
								</section>
							</div>
						) : null
					)}

					{/* About Tab */}
					{use(this.selected).map((selected) =>
						selected === "about" ? (
							<div class="settings-tab">
								<section class="setting-section">
									<div class="section-header"></div>
									<div class="section-content">
										<div class="about-info">
											<img
												class="browser-logo"
												src="/icon.png"
												alt="Browser.js Logo"
											/>
											<div class="browser-info">
												<h3>Browser.js</h3>
												<p>
													Scramjet Version: {versionInfo.version} (
													{versionInfo.build})
												</p>
												<p>© {__COPYRIGHT_YEAR__} Puter Technologies</p>
											</div>
										</div>
									</div>
								</section>

								<section class="setting-section">
									<div class="section-header">
										<h3>Open Source</h3>
									</div>
									<div class="section-content">
										<p>
											Browser.js is open source software. View the source code
											on GitHub.
										</p>
										<a
											href="https://github.com/HeyPuter/browser.js"
											class="link"
										>
											GitHub Repository
										</a>
									</div>
								</section>
							</div>
						) : null
					)}
				</div>
			</div>
		</div>
	);
}

SettingsPage.style = css`
	:scope {
		width: 100%;
		height: 100%;
		display: flex;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			"Segoe UI",
			Roboto,
			Oxygen,
			Ubuntu,
			Cantarell,
			"Open Sans",
			"Helvetica Neue",
			sans-serif;
		background: var(--ntp_background);
		color: var(--ntp_text);
		overflow: hidden;
	}

	h1,
	h2,
	h3,
	h4,
	p {
		margin: 0;
		padding: 0;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 2rem;
	}

	.settings-content h1 {
		margin-bottom: 2.75rem;
	}

	h2 {
		font-size: 1.2rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
		color: var(--ntp_text);
	}

	h3 {
		font-size: 1.08rem;
		font-weight: 600;
		color: var(--ntp_text);
		margin-bottom: 0.8rem;
	}

	h4 {
		font-size: 0.925rem;
		font-weight: 550;
		color: var(--ntp_text);
		margin-bottom: 0.7rem;
	}

	h5 {
		font-size: 0.87rem;
		font-weight: 500;
		color: var(--ntp_text);
		margin-bottom: 0.5rem;
	}

	p {
		color: var(--ntp-text-70);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.sidebar {
		width: max(20rem, 250px);
		padding: var(--space-xxl);
		background: var(--toolbar);
		border-right: 1px solid var(--text-15);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	.navigation {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.nav-button {
		display: flex;
		align-items: center;
		gap: var(--space-lg);
		padding: var(--space-lg) var(--space-xl);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color 0.05s ease-out,
			color 0.05s ease-out,
			font-weight 0.1s ease-out;
		font-size: 0.95rem;
		color: var(--toolbar_text);
	}

	.nav-button:hover {
		background: var(--text-10);
	}

	.nav-button.active {
		background: var(--accent-10);
		color: var(--tab_line);
		font-weight: 600;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	input {
		font-family: inherit;
	}

	.search-container {
		position: absolute;
		top: 0;
		right: 0;
		width: 24rem;
		z-index: 5;
		padding: 1.5rem;
	}

	.search-input input {
		width: 100%;
		height: 2.5rem;
		padding: 0 2.5rem;
		border-radius: 6px;
		border: 1px solid var(--ntp-text-20);
		background: var(--toolbar_field);
		color: var(--toolbar_field_text);
		font-size: 0.95rem;
		outline: none;
		transition: all 0.2s ease;
	}

	.search-input input:focus {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 2px var(--accent-20);
	}

	.search-input .icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: color-mix(in srgb, var(--ntp_text) 50%, transparent);
	}

	.clear-search {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: color-mix(in srgb, var(--ntp_text) 50%, transparent);
		font-size: 1.2rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
	}

	.clear-search:hover {
		background: var(--ntp-text-10);
	}

	.settings-content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}

	.settings-tab {
		max-width: max(50rem, 80vw);
	}

	.setting-section {
		margin-bottom: 2rem;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--ntp-text-15);
	}

	.setting-section:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}

	.section-header {
		margin-bottom: 1rem;
	}

	.description {
		margin-block: 0.33rem;
		color: var(--ntp-text-60);
	}

	.section-content {
		padding-left: 0.5rem;
	}

	.setting-group {
		margin-bottom: 1.5rem;
	}

	.setting-group:last-child {
		margin-bottom: 0;
	}

	.label-multiline {
		display: flex;
		flex-direction: column;
		gap: 2.5px;
	}

	.label-multiline .description {
		font-size: 0.85rem;
		color: var(--ntp-text-60);
	}

	.checkbox-option:has(.label-multiline),
	.radio-option:has(.label-multiline) {
		align-items: flex-start;
	}

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.radio-option,
	.checkbox-option {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		margin-bottom: var(--space-md);
	}

	.radio-option:last-child,
	.checkbox-option:last-child {
		margin-bottom: 0;
	}

	.radio-option label,
	.checkbox-option label {
		font-size: 0.95rem;
		cursor: pointer;
	}

	.checkbox-option.disabled label {
		cursor: not-allowed;
		opacity: 0.65;
	}

	input[type="radio"],
	input[type="checkbox"] {
		accent-color: var(--tab_line);
		margin: 0;
	}

	.layout-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 13.5rem), 1fr));
		gap: 0.8rem;
	}

	.sidebar-location-grid {
		grid-template-columns: repeat(2, minmax(0, 18rem));
		max-width: 36.8rem;
	}

	.layout-card {
		min-width: 0;
		border: 1px solid var(--ntp-text-15);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--toolbar_field);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	.layout-card:hover {
		border-color: var(--tab_line);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		transform: translateY(-1px);
	}

	.layout-card:focus-within {
		outline: 2px solid var(--tab_line);
		outline-offset: 2px;
	}

	.layout-card.selected {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 3px var(--accent-20);
	}

	.layout-radio {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.layout-info {
		padding: var(--space-lg) var(--space-md);
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.25rem;
		background: var(--toolbar_field);
		color: var(--toolbar_field_text);
	}

	.layout-info.compact {
		flex: none;
	}

	.layout-name {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.layout-info .description {
		font-size: 0.8rem;
		line-height: 1.3;
		color: var(--field-text-60);
	}

	.setting-hint {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: var(--ntp-text-60);
	}

	.zoom-control {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.zoom-value {
		min-width: 3rem;
		font-size: 0.95rem;
		font-weight: 500;
	}

	input[type="range"] {
		flex: 1;
		max-width: 20rem;
		accent-color: var(--tab_line);
	}

	select {
		font-family: inherit;
	}

	.select-input {
		padding: var(--space-md);
		border-radius: var(--radius-md);
		border: 1px solid var(--ntp-text-20);
		background: var(--toolbar_field);
		color: var(--toolbar_field_text);
		font-size: 0.9rem;
		min-width: 15rem;
		outline: none;
	}

	.select-input:focus {
		border-color: var(--tab_line);
	}

	.action-button {
		margin-top: var(--space-xl);
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-20);
		color: var(--toolbar_field_text);
		padding: var(--space-md) var(--space-xl);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-button:hover {
		background: var(--text-10);
	}

	.dev-buttons {
		display: flex;
		gap: var(--space-lg);
	}

	.extensions-list {
		border: 1px solid var(--ntp-text-15);
		border-radius: 6px;
		overflow: hidden;
	}

	.extension-item {
		padding: 1rem;
		border-bottom: 1px solid var(--ntp-text-15);
	}

	.extension-item:last-child {
		border-bottom: none;
	}

	.extension-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.extension-icon {
		width: 3.25rem;
		height: 3.25rem;
		font-size: 2.25rem;
		border-radius: 6px;
		background: var(--ntp-text-10);
		color: color-mix(in srgb, var(--ntp_text) 50%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.extension-icon .icon-inner {
		transform: translate(2px, 2px);
		transform-origin: top right;
	}

	.extension-details h4 {
		margin-bottom: 0.25rem;
	}

	.extension-details p {
		font-size: 0.85rem;
		color: var(--ntp-text-60);
	}

	.about-info {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.browser-logo {
		width: 5rem;
		height: 5rem;
	}

	.browser-info h3 {
		font-size: 1.5rem;
		margin-bottom: 0.25rem;
	}

	.browser-info p {
		margin-bottom: 0.25rem;
	}

	.link {
		display: inline-block;
		margin-top: 0.75rem;
		color: var(--tab_line);
		text-decoration: none;
	}

	.link:hover {
		text-decoration: underline;
	}

	.placeholder {
		position: relative;
		overflow: hidden;
	}

	.placeholder::after {
		content: "";
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: linear-gradient(
			90deg,
			var(--ntp-text-5) 0%,
			var(--ntp-text-10) 50%,
			var(--ntp-text-5) 100%
		);
		animation: shimmer 1.5s infinite;
		background-size: 200% 100%;
	}

	@keyframes shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}

	/* The track floor has to stay well under .settings-tab's width or auto-fit
	   can never fit a second column, which with two dozen themes leaves the
	   pane several screens long. 22rem gives two columns at the narrowest pane
	   and three on a wide window, and is still wide enough for ThemePreview to
	   read as a browser window. */
	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.theme-card {
		border-radius: var(--radius-md);
		overflow: hidden;
		cursor: pointer;
		transition: all 0.2s ease;
		background: var(--toolbar_field);
	}

	.theme-card:hover {
		border-color: var(--tab_line);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.theme-card.selected {
		border-color: var(--tab_line);
		box-shadow: 0 0 0 3px var(--accent-20);
	}

	.theme-info {
		padding: var(--space-lg) var(--space-md);
	}

	.theme-info h5 {
		margin: 0.25rem 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--toolbar_field_text);
	}

	.theme-info p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--field-text-60);
		line-height: 1.3;
	}
`;
