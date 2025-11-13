import { css, type Component } from "dreamland/core";
import type { Tab } from "../Tab";
import type { IconifyIcon } from "@iconify/types";
import { versionInfo } from "@mercuryworkshop/scramjet";
import { Icon } from "../components/Icon";
import { browser } from "../Browser";
import { Checkbox } from "../components/Checkbox";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { AVAILABLE_SEARCH_ENGINES } from "../components/Omnibar/suggestions";
import { THEMES } from "../themes";

import {
	iconSettings,
	iconSearchOutline as iconSearch,
	iconExtension,
	iconPrivacy,
	iconAbout,
} from "../icons";

export function SettingsPage(
	this: { selected: string; searchQuery: string },
	props: { tab: Tab }
) {
	this.selected = "general";
	this.searchQuery = "";

	const button = (id: string, icon: IconifyIcon, name: string) => {
		return (
			<div
				class="nav-button"
				class:active={use(this.selected).map((s) => s === id)}
				on:click={() => {
					this.selected = id;
				}}
			>
				<Icon icon={icon} />
				<span>{name}</span>
			</div>
		);
	};

	const handleSearch = (e: Event) => {
		this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
	};

	return (
		<div class="settings-page">
			<div class="sidebar">
				<h1>Settings</h1>
				<nav class="navigation">
					{button("general", iconSettings, "General")}
					{button("search", iconSearch, "Search")}
					{button("privacy", iconPrivacy, "Privacy & Security")}
					{button("extensions", iconExtension, "Extensions")}
					{button("about", iconAbout, "About")}
				</nav>
			</div>
			<div class="content">
				<div class="search-container">
					<Input
						placeholder="Search settings..."
						value={this.searchQuery}
						on:input={handleSearch}
					/>
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
										<h3>Appearance</h3>
										<p class="description">
											Customize how the browser looks and feels
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<h4>Page Appearance</h4>
											<div class="radio-group">
												<div class="radio-option">
													<input
														type="radio"
														id="appearance-system"
														name="appearance"
														value="system"
														checked={browser.settings.appearance === "system"}
														on:change={() => {
															browser.settings.appearance = "system";
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
														checked={browser.settings.appearance === "dark"}
														on:change={() => {
															browser.settings.appearance = "dark";
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
														checked={browser.settings.appearance === "light"}
														on:change={() => {
															browser.settings.appearance = "light";
														}}
													/>
													<label for="appearance-light">Light</label>
												</div>
											</div>
										</div>

										<div class="setting-group">
											<h4>Color Theme</h4>
											<p class="description">
												Choose your preferred color scheme
											</p>
											<div class="theme-grid">
												{THEMES.map((theme) => (
													<div
														class="theme-card"
														class:selected={use(browser.settings.themeId).map(
															(id) => id === theme.id
														)}
														on:click={() => {
															browser.settings.themeId = theme.id;
														}}
													>
														<div class="theme-preview">
															<div
																class="preview-toolbar"
																style={`background: ${theme.preview.toolbar};`}
															>
																<div
																	class="preview-field"
																	style={`background: ${theme.preview.field};`}
																></div>
																<div
																	class="preview-accent"
																	style={`background: ${theme.preview.accent};`}
																></div>
															</div>
														</div>
														<div class="theme-info">
															<h5>{theme.name}</h5>
															<p>{theme.description}</p>
														</div>
													</div>
												))}
											</div>
										</div>
									</div>
								</section>

								<section class="setting-section">
									<div class="section-header">
										<h3>Startup</h3>
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
														checked={use(browser.settings.startupPage).map(
															(v) => v === "new-tab"
														)}
														on:change={() => {
															browser.settings.startupPage = "new-tab";
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
														checked={use(browser.settings.startupPage).map(
															(v) => v === "continue"
														)}
														on:change={() => {
															browser.settings.startupPage = "continue";
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
										<h3>Bookmarks</h3>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													value={use(browser.settings.showBookmarksBar)}
													id="show-bookmarks-bar"
												/>
												<label for="show-bookmarks-bar">
													Always show bookmarks bar
												</label>
											</div>
										</div>
									</div>
								</section>
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
												value={use(browser.settings.defaultSearchEngine)}
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
										<h3>Search Suggestions</h3>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="search-suggestions"
													value={use(browser.settings.searchSuggestionsEnabled)}
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
										<h3>Trackers & Site Data</h3>
										<p class="description">
											Control how the browser handles trackers and your data
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="block-trackers"
													value={use(browser.settings.blockTrackers)}
												/>
												<label for="block-trackers">
													Block third-party trackers
												</label>
											</div>

											<div class="checkbox-option">
												<Checkbox
													id="do-not-track"
													value={use(browser.settings.doNotTrack)}
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
										<h3>Browsing History</h3>
										<p class="description">
											Control what data is saved or cleared
										</p>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="clear-history"
													value={use(browser.settings.clearHistoryOnExit)}
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
														<Icon icon={iconExtension} />
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
										<h3>Developer Mode</h3>
									</div>
									<div class="section-content">
										<div class="setting-group">
											<div class="checkbox-option">
												<Checkbox
													id="dev-mode"
													value={use(browser.settings.extensionsDevMode)}
												/>
												<label for="dev-mode">Enable developer mode</label>
											</div>

											{browser.settings.extensionsDevMode && (
												<div class="dev-buttons">
													<Button>Load Unpacked</Button>
													<Button>Pack Extension</Button>
												</div>
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
												<p>© 2025 Puter Technologies</p>
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
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	h2 {
		font-size: 1.3rem;
		font-weight: 600;
		margin-bottom: 1.5rem;
		color: var(--ntp_text);
	}

	h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--ntp_text);
	}

	h4 {
		font-size: 0.95rem;
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
		padding: 2rem;
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
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		cursor: pointer;
		transition: background-color 0.2s ease;
		font-size: 0.95rem;
		color: var(--toolbar_text);
	}

	.nav-button:hover {
		background: var(--text-10);
	}

	.nav-button.active {
		background: var(--accent-15);
		color: var(--tab_line);
		font-weight: 500;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.search-container {
		padding: 1rem 1rem;
	}

	input {
		font-family: inherit;
	}

	.search-container {
		position: relative;
		width: 100%;
		max-width: 24rem;
		margin-left: auto;
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
		padding: 1.5rem 2rem 2rem;
		overflow-y: auto;
	}
	.settings-content h1 {
		margin-bottom: 1.5rem;
		font-size: 1.75rem;
	}

	.settings-tab {
		max-width: 50rem;
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
		margin-top: 0.25rem;
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

	.radio-group {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.radio-option,
	.checkbox-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
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

	input[type="radio"],
	input[type="checkbox"] {
		accent-color: var(--tab_line);
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
		padding: 0.5rem;
		border-radius: 4px;
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
		margin-top: 1rem;
		background: var(--toolbar_field);
		border: 1px solid var(--ntp-text-20);
		color: var(--toolbar_field_text);
		padding: 0.5rem 1rem;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-button:hover {
		background: var(--text-10);
	}

	.dev-buttons {
		display: flex;
		gap: 0.75rem;
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
		width: 2.5rem;
		height: 2.5rem;
		font-size: 2.25rem;
		border-radius: 6px;
		background: var(--ntp-text-10);
		color: color-mix(in srgb, var(--ntp_text) 50%, transparent);
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

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.theme-card {
		border-radius: 8px;
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

	.theme-preview {
		height: 5rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.preview-toolbar {
		flex: 1;
		border-radius: 4px;
		padding: 0.5rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.preview-field {
		height: 1.5rem;
		flex: 1;
		border-radius: 3px;
	}

	.preview-accent {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
	}

	.theme-info {
		padding: 0.75rem 1rem 1rem;
	}

	.theme-info h5 {
		margin: 0 0 0.25rem 0;
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
