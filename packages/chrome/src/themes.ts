export type AppearancePreference = "system" | "light" | "dark";

export type ThemeId =
	| "light"
	| "light-high-contrast"
	| "dark"
	| "dark-high-contrast"
	| "oled-dark"
	| "catppuccin-mocha"
	| "catppuccin-macchiato"
	| "catppuccin-frappe"
	| "catppuccin-latte"
	| "dracula"
	| "nord"
	| "nord-light"
	| "gruvbox-dark"
	| "gruvbox-dark-soft"
	| "gruvbox-dark-hard"
	| "gruvbox-light"
	| "gruvbox-light-soft"
	| "gruvbox-light-hard"
	| "tokyo-night"
	| "tokyo-night-light"
	| "solarized-dark"
	| "solarized-light"
	| "citrus";

export type ThemeTokens = {
	toolbar: string;
	toolbar_text: string;
	frame: string;
	tab_background_text: string;
	toolbar_field: string;
	toolbar_field_text: string;
	tab_line: string;
	popup: string;
	popup_text: string;
	icons: string;
	ntp_background: string;
	ntp_text: string;
	popup_border: string;
	toolbar_top_separator: string;
	tab_loading: string;
};

export type ThemeDefinition = {
	id: ThemeId;
	name: string;
	appearance: "light" | "dark";
	description: string;
	preview: {
		toolbar: string;
		field: string;
		text: string;
		accent: string;
	};
	tokens: ThemeTokens;
};

export const THEMES: readonly ThemeDefinition[] = [
	{
		id: "light",
		name: "Default Light",
		appearance: "light",
		description: "The default light theme for Browser.js.",
		preview: {
			toolbar: "#f6fcff",
			field: "#e6f0f7",
			text: "#181b20",
			accent: "#0070cc",
		},
		tokens: {
			frame: "#cedae1",
			toolbar: "#f6fcff",
			toolbar_text: "#181b20",
			tab_background_text: "#181b20",
			toolbar_field: "#e6f0f7",
			toolbar_field_text: "#181b20",
			tab_line: "#0070cc",
			popup: "#ffffff",
			popup_text: "#181b20",
			icons: "#5b6266",
			ntp_background: "#ebf1f4",
			ntp_text: "#15141a",
			popup_border: "#e6f0f7",
			toolbar_top_separator: "#f0f0f4",
			tab_loading: "#0070cc",
		},
	},
	{
		id: "light-high-contrast",
		name: "High Contrast Light",
		appearance: "light",
		description:
			"High-contrast variant of the default light theme for improved readability.",
		preview: {
			toolbar: "#ffffff",
			field: "#ffffff",
			text: "#000000",
			accent: "#005fcc",
		},
		tokens: {
			frame: "#e4e7eb",
			toolbar: "#ffffff",
			toolbar_text: "#000000",
			tab_background_text: "#000000",
			toolbar_field: "#ffffff",
			toolbar_field_text: "#000000",
			tab_line: "#005fcc",
			popup: "#ffffff",
			popup_text: "#000000",
			icons: "#1f2328",
			ntp_background: "#ffffff",
			ntp_text: "#000000",
			popup_border: "#60676f",
			toolbar_top_separator: "#b1b9c2",
			tab_loading: "#005fcc",
		},
	},
	{
		id: "dark",
		name: "Default Dark",
		appearance: "dark",
		description: "The default dark theme for Browser.js.",
		preview: {
			toolbar: "#1f2429",
			field: "#131719",
			text: "#eaf2f7",
			accent: "#5bb4f4",
		},
		tokens: {
			frame: "#131719",
			toolbar: "#1f2429",
			toolbar_text: "#eaf2f7",
			tab_background_text: "#eaf2f7",
			toolbar_field: "#131719",
			toolbar_field_text: "#eaf2f7",
			tab_line: "#5bb4f4",
			popup: "#1a1f23",
			popup_border: "#3c4046",
			popup_text: "#eaf2f7",
			icons: "#eaf2f7",
			ntp_background: "#0c0f13",
			ntp_text: "#eaf2f7",
			toolbar_top_separator: "#131719",
			tab_loading: "#5bb4f4",
		},
	},
	{
		id: "dark-high-contrast",
		name: "High Contrast Dark",
		appearance: "dark",
		description:
			"High-contrast variant of the default dark theme for improved readability.",
		preview: {
			toolbar: "#111317",
			field: "#000000",
			text: "#ffffff",
			accent: "#63b3ff",
		},
		tokens: {
			frame: "#000000",
			toolbar: "#111317",
			toolbar_text: "#ffffff",
			tab_background_text: "#ffffff",
			toolbar_field: "#000000",
			toolbar_field_text: "#ffffff",
			tab_line: "#63b3ff",
			popup: "#000000",
			popup_text: "#ffffff",
			icons: "#ffffff",
			ntp_background: "#000000",
			ntp_text: "#ffffff",
			popup_border: "#8b949e",
			toolbar_top_separator: "#30363d",
			tab_loading: "#63b3ff",
		},
	},
	{
		id: "oled-dark",
		name: "OLED Dark",
		appearance: "dark",
		description:
			"OLED-focused dark theme based on high-contrast dark with deeper blacks and softer borders.",
		preview: {
			toolbar: "#000000",
			field: "#131318",
			text: "#f0f0f0",
			accent: "#63b3ff",
		},
		tokens: {
			frame: "#000000",
			toolbar: "#000000",
			toolbar_text: "#f0f0f0",
			tab_background_text: "#f0f0f0",
			toolbar_field: "#131318",
			toolbar_field_text: "#f0f0f0",
			tab_line: "#63b3ff",
			popup: "#000000",
			popup_text: "#f0f0f0",
			icons: "#f2f6fb",
			ntp_background: "#000000",
			ntp_text: "#f0f0f0",
			popup_border: "#1f242b",
			toolbar_top_separator: "#161b22",
			tab_loading: "#63b3ff",
		},
	},
	{
		id: "catppuccin-mocha",
		name: "Catppuccin Mocha",
		appearance: "dark",
		description: "A soothing dark pastel theme.",
		preview: {
			toolbar: "#1e1e2e",
			field: "#181825",
			text: "#cdd6f4",
			accent: "#cba6f7",
		},
		tokens: {
			toolbar: "#1e1e2e",
			toolbar_text: "#cdd6f4",
			frame: "#181825",
			tab_background_text: "#cdd6f4",
			toolbar_field: "#181825",
			toolbar_field_text: "#cdd6f4",
			tab_line: "#cba6f7",
			popup: "#181825",
			popup_text: "#cdd6f4",
			icons: "#b4befe",
			ntp_background: "#11111b",
			ntp_text: "#cdd6f4",
			popup_border: "#45475a",
			toolbar_top_separator: "#181825",
			tab_loading: "#cba6f7",
		},
	},
	{
		id: "catppuccin-macchiato",
		name: "Catppuccin Macchiato",
		appearance: "dark",
		description: "A lighter variant of the Mocha theme with more contrast.",
		preview: {
			toolbar: "#24273a",
			field: "#1e2030",
			text: "#f4dbd6",
			accent: "#f5bde6",
		},
		tokens: {
			toolbar: "#24273a",
			toolbar_text: "#cad3f5",
			frame: "#1e2030",
			tab_background_text: "#cad3f5",
			toolbar_field: "#1e2030",
			toolbar_field_text: "#cad3f5",
			tab_line: "#c6a0f6",
			popup: "#1e2030",
			popup_text: "#cad3f5",
			icons: "#c6a0f6",
			ntp_background: "#181926",
			ntp_text: "#cad3f5",
			popup_border: "#494d64",
			toolbar_top_separator: "#1e2030",
			tab_loading: "#c6a0f6",
		},
	},
	{
		id: "catppuccin-frappe",
		name: "Catppuccin Frappé",
		appearance: "dark",
		description:
			"An even lighter variant of the Mocha theme with more contrast and brighter accents.",
		preview: {
			toolbar: "#303446",
			field: "#292c3c",
			text: "#f2d5cf",
			accent: "#ca9ee6",
		},
		tokens: {
			toolbar: "#303446",
			toolbar_text: "#c6d0f5",
			frame: "#292c3c",
			tab_background_text: "#c6d0f5",
			toolbar_field: "#292c3c",
			toolbar_field_text: "#c6d0f5",
			tab_line: "#ca9ee6",
			popup: "#292c3c",
			popup_text: "#c6d0f5",
			icons: "#babbf1",
			ntp_background: "#232634",
			ntp_text: "#c6d0f5",
			popup_border: "#51576d",
			toolbar_top_separator: "#292c3c",
			tab_loading: "#ca9ee6",
		},
	},
	{
		id: "catppuccin-latte",
		name: "Catppuccin Latte",
		appearance: "light",
		description: "A soothing light pastel theme.",
		preview: {
			toolbar: "#e6e9ef",
			field: "#eff1f5",
			text: "#4c4f69",
			accent: "#8839ef",
		},
		tokens: {
			toolbar: "#e6e9ef",
			toolbar_text: "#4c4f69",
			frame: "#dce0e8",
			tab_background_text: "#4c4f69",
			toolbar_field: "#eff1f5",
			toolbar_field_text: "#4c4f69",
			tab_line: "#8839ef",
			popup: "#eff1f5",
			popup_text: "#4c4f69",
			icons: "#7287fd",
			ntp_background: "#e6e9ef",
			ntp_text: "#4c4f69",
			popup_border: "#bcc0cc",
			toolbar_top_separator: "#dce0e8",
			tab_loading: "#8839ef",
		},
	},
	{
		id: "dracula",
		name: "Dracula",
		appearance: "dark",
		description: "Dark theme with vibrant purple and pink accents.",
		preview: {
			toolbar: "#282A36",
			field: "#44475A",
			text: "#F8F8F2",
			accent: "#BD93F9",
		},
		tokens: {
			toolbar: "#282A36",
			toolbar_text: "#F8F8F2",
			frame: "#282A36",
			tab_background_text: "#F8F8F2",
			toolbar_field: "#44475A",
			toolbar_field_text: "#F8F8F2",
			tab_line: "#BD93F9",
			popup: "#282A36",
			popup_text: "#F8F8F2",
			icons: "#FF79C6",
			ntp_background: "#282A36",
			ntp_text: "#F8F8F2",
			popup_border: "#6272A4",
			toolbar_top_separator: "#6272A4",
			tab_loading: "#8BE9FD",
		},
	},
	{
		id: "nord",
		name: "Nord Dark",
		appearance: "dark",
		description: "An arctic, north-bluish color palette.",
		preview: {
			toolbar: "#3B4252",
			field: "#3B4252",
			text: "#ECEFF4",
			accent: "#88C0D0",
		},
		tokens: {
			toolbar: "#3B4252",
			toolbar_text: "#ECEFF4",
			frame: "#2E3440",
			tab_background_text: "#ECEFF4",
			toolbar_field: "#3B4252",
			toolbar_field_text: "#ECEFF4",
			tab_line: "#88C0D0",
			popup: "#3B4252",
			popup_text: "#ECEFF4",
			icons: "#81A1C1",
			ntp_background: "#2E3440",
			ntp_text: "#ECEFF4",
			popup_border: "#4C566A",
			toolbar_top_separator: "#434C5E",
			tab_loading: "#88C0D0",
		},
	},
	{
		id: "nord-light",
		name: "Nord Light",
		appearance: "light",
		description: "A light variant of Nord.",
		preview: {
			toolbar: "#E5E9F0",
			field: "#ECEFF4",
			text: "#2E3440",
			accent: "#5E81AC",
		},
		tokens: {
			toolbar: "#E5E9F0",
			toolbar_text: "#2E3440",
			frame: "#ECEFF4",
			tab_background_text: "#2E3440",
			toolbar_field: "#ECEFF4",
			toolbar_field_text: "#2E3440",
			tab_line: "#5E81AC",
			popup: "#ECEFF4",
			popup_text: "#2E3440",
			icons: "#4C566A",
			ntp_background: "#ECEFF4",
			ntp_text: "#2E3440",
			popup_border: "#D8DEE9",
			toolbar_top_separator: "#D8DEE9",
			tab_loading: "#88C0D0",
		},
	},
	{
		id: "gruvbox-dark-soft",
		name: "Gruvbox Dark (Soft)",
		appearance: "dark",
		description:
			"Gruvbox dark mode with softer contrast and bright accent palette.",
		preview: {
			toolbar: "#32302F",
			field: "#3C3836",
			text: "#EBDBB2",
			accent: "#FE8019",
		},
		tokens: {
			toolbar: "#32302F",
			toolbar_text: "#EBDBB2",
			frame: "#32302F",
			tab_background_text: "#EBDBB2",
			toolbar_field: "#3C3836",
			toolbar_field_text: "#EBDBB2",
			tab_line: "#FE8019",
			popup: "#32302F",
			popup_text: "#EBDBB2",
			icons: "#FABD2F",
			ntp_background: "#32302F",
			ntp_text: "#B8BB26",
			popup_border: "#504945",
			toolbar_top_separator: "#3C3836",
			tab_loading: "#FE8019",
		},
	},
	{
		id: "gruvbox-dark",
		name: "Gruvbox Dark (Normal)",
		appearance: "dark",
		description:
			"Gruvbox dark mode with medium (default) contrast and bright accents.",
		preview: {
			toolbar: "#282828",
			field: "#3c3836",
			text: "#EBDBB2",
			accent: "#FE8019",
		},
		tokens: {
			toolbar: "#282828",
			toolbar_text: "#EBDBB2",
			frame: "#282828",
			tab_background_text: "#EBDBB2",
			toolbar_field: "#3c3836",
			toolbar_field_text: "#EBDBB2",
			tab_line: "#FE8019",
			popup: "#282828",
			popup_text: "#EBDBB2",
			icons: "#FABD2F",
			ntp_background: "#282828",
			ntp_text: "#B8BB26",
			popup_border: "#504945",
			toolbar_top_separator: "#3c3836",
			tab_loading: "#FE8019",
		},
	},
	{
		id: "gruvbox-dark-hard",
		name: "Gruvbox Dark (Hard)",
		appearance: "dark",
		description:
			"Gruvbox dark mode with higher contrast and bright accent palette.",
		preview: {
			toolbar: "#1D2021",
			field: "#3C3836",
			text: "#EBDBB2",
			accent: "#FE8019",
		},
		tokens: {
			toolbar: "#1D2021",
			toolbar_text: "#EBDBB2",
			frame: "#1D2021",
			tab_background_text: "#EBDBB2",
			toolbar_field: "#3C3836",
			toolbar_field_text: "#EBDBB2",
			tab_line: "#FE8019",
			popup: "#1D2021",
			popup_text: "#EBDBB2",
			icons: "#FABD2F",
			ntp_background: "#1D2021",
			ntp_text: "#B8BB26",
			popup_border: "#504945",
			toolbar_top_separator: "#3C3836",
			tab_loading: "#FE8019",
		},
	},
	{
		id: "gruvbox-light-soft",
		name: "Gruvbox Light (Soft)",
		appearance: "light",
		description:
			"Gruvbox light mode with softer contrast and faded accent palette.",
		preview: {
			toolbar: "#F2E5BC",
			field: "#EBDBB2",
			text: "#3C3836",
			accent: "#AF3A03",
		},
		tokens: {
			toolbar: "#F2E5BC",
			toolbar_text: "#3C3836",
			frame: "#F2E5BC",
			tab_background_text: "#3C3836",
			toolbar_field: "#EBDBB2",
			toolbar_field_text: "#3C3836",
			tab_line: "#AF3A03",
			popup: "#F2E5BC",
			popup_text: "#3C3836",
			icons: "#B57614",
			ntp_background: "#F2E5BC",
			ntp_text: "#79740E",
			popup_border: "#D5C4A1",
			toolbar_top_separator: "#EBDBB2",
			tab_loading: "#AF3A03",
		},
	},
	{
		id: "gruvbox-light",
		name: "Gruvbox Light (Normal)",
		appearance: "light",
		description:
			"Gruvbox light mode with medium (default) contrast and faded accents.",
		preview: {
			toolbar: "#FBF1C7",
			field: "#EBDBB2",
			text: "#3C3836",
			accent: "#AF3A03",
		},
		tokens: {
			toolbar: "#FBF1C7",
			toolbar_text: "#3C3836",
			frame: "#FBF1C7",
			tab_background_text: "#3C3836",
			toolbar_field: "#EBDBB2",
			toolbar_field_text: "#3C3836",
			tab_line: "#AF3A03",
			popup: "#FBF1C7",
			popup_text: "#3C3836",
			icons: "#B57614",
			ntp_background: "#FBF1C7",
			ntp_text: "#79740E",
			popup_border: "#D5C4A1",
			toolbar_top_separator: "#EBDBB2",
			tab_loading: "#AF3A03",
		},
	},
	{
		id: "gruvbox-light-hard",
		name: "Gruvbox Light (Hard)",
		appearance: "light",
		description:
			"Gruvbox light mode with higher contrast and faded accent palette.",
		preview: {
			toolbar: "#F9F5D7",
			field: "#EBDBB2",
			text: "#3C3836",
			accent: "#AF3A03",
		},
		tokens: {
			toolbar: "#F9F5D7",
			toolbar_text: "#3C3836",
			frame: "#F9F5D7",
			tab_background_text: "#3C3836",
			toolbar_field: "#EBDBB2",
			toolbar_field_text: "#3C3836",
			tab_line: "#AF3A03",
			popup: "#F9F5D7",
			popup_text: "#3C3836",
			icons: "#B57614",
			ntp_background: "#F9F5D7",
			ntp_text: "#79740E",
			popup_border: "#D5C4A1",
			toolbar_top_separator: "#EBDBB2",
			tab_loading: "#AF3A03",
		},
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		appearance: "dark",
		description: "Clean dark theme inspired by Tokyo's night skyline.",
		preview: {
			toolbar: "#1A1B26",
			field: "#24283B",
			text: "#A9B1D6",
			accent: "#7AA2F7",
		},
		tokens: {
			toolbar: "#1A1B26",
			toolbar_text: "#A9B1D6",
			frame: "#1A1B26",
			tab_background_text: "#C0CAF5",
			toolbar_field: "#24283B",
			toolbar_field_text: "#C0CAF5",
			tab_line: "#7AA2F7",
			popup: "#24283B",
			popup_text: "#A9B1D6",
			icons: "#7DCFFF",
			ntp_background: "#1A1B26",
			ntp_text: "#9AA5CE",
			popup_border: "#414868",
			toolbar_top_separator: "#24283B",
			tab_loading: "#2AC3DE",
		},
	},
	{
		id: "tokyo-night-light",
		name: "Tokyo Night Light",
		appearance: "light",
		description: "Light variant of Tokyo Night.",
		preview: {
			toolbar: "#E6E7ED",
			field: "#E6E7ED",
			text: "#343B58",
			accent: "#2959AA",
		},
		tokens: {
			toolbar: "#E6E7ED",
			toolbar_text: "#343B58",
			frame: "#E6E7ED",
			tab_background_text: "#343B58",
			toolbar_field: "#E6E7ED",
			toolbar_field_text: "#343B58",
			tab_line: "#2959AA",
			popup: "#E6E7ED",
			popup_text: "#40434F",
			icons: "#0F4B6E",
			ntp_background: "#E6E7ED",
			ntp_text: "#40434F",
			popup_border: "#6C6E75",
			toolbar_top_separator: "#6C6E75",
			tab_loading: "#006C86",
		},
	},
	{
		id: "solarized-dark",
		name: "Solarized Dark",
		appearance: "dark",
		description: "Precision colors for machines and people.",
		preview: {
			toolbar: "#002B36",
			field: "#073642",
			text: "#839496",
			accent: "#268BD2",
		},
		tokens: {
			toolbar: "#002B36",
			toolbar_text: "#839496",
			frame: "#073642",
			tab_background_text: "#839496",
			toolbar_field: "#073642",
			toolbar_field_text: "#93A1A1",
			tab_line: "#268BD2",
			popup: "#073642",
			popup_text: "#839496",
			icons: "#93A1A1",
			ntp_background: "#002B36",
			ntp_text: "#839496",
			popup_border: "#586E75",
			toolbar_top_separator: "#073642",
			tab_loading: "#268BD2",
		},
	},
	{
		id: "solarized-light",
		name: "Solarized Light",
		appearance: "light",
		description: "Light variant of Solarized.",
		preview: {
			toolbar: "#FDF6E3",
			field: "#EEE8D5",
			text: "#657B83",
			accent: "#268BD2",
		},
		tokens: {
			toolbar: "#FDF6E3",
			toolbar_text: "#657B83",
			frame: "#EEE8D5",
			tab_background_text: "#657B83",
			toolbar_field: "#EEE8D5",
			toolbar_field_text: "#586E75",
			tab_line: "#268BD2",
			popup: "#EEE8D5",
			popup_text: "#657B83",
			icons: "#93A1A1",
			ntp_background: "#FDF6E3",
			ntp_text: "#657B83",
			popup_border: "#93A1A1",
			toolbar_top_separator: "#EEE8D5",
			tab_loading: "#268BD2",
		},
	},
	{
		id: "citrus",
		name: "Citrus Burst",
		appearance: "light",
		description: "Bright pastel surfaces with energetic citrus accents.",
		preview: {
			toolbar: "#FDF5E6",
			field: "#FFFFFF",
			text: "#2E2F36",
			accent: "#FF9A3C",
		},
		tokens: {
			toolbar: "#FDF5E6",
			toolbar_text: "#2E2F36",
			frame: "#F8EBD4",
			tab_background_text: "#2E2F36",
			toolbar_field: "#FFFFFF",
			toolbar_field_text: "#2E2F36",
			tab_line: "#FF9A3C",
			popup: "#FFFFFF",
			popup_text: "#2E2F36",
			icons: "#FF7849",
			ntp_background: "#FFF9EE",
			ntp_text: "#2E2F36",
			popup_border: "#F4D9B6",
			toolbar_top_separator: "#F2E2C9",
			tab_loading: "#44C2A4",
		},
	},
] as const;

export const themeMap: Record<ThemeId, ThemeDefinition> = THEMES.reduce(
	(acc, theme) => {
		acc[theme.id] = theme;
		return acc;
	},
	Object.create(null) as Record<ThemeId, ThemeDefinition>
);

export function getTheme(themeId: ThemeId): ThemeDefinition {
	return themeMap[themeId] || themeMap[DEFAULT_THEME_ID];
}

export function isThemeId(value: string): value is ThemeId {
	return value in themeMap;
}

export const DEFAULT_THEME_ID: ThemeId = "dark";
