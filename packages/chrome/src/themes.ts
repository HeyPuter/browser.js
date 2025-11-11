export type AppearancePreference = "system" | "light" | "dark";

export type ThemeId =
	| "light"
	| "dark"
	| "catppuccin-mocha"
	| "catppuccin-macchiato"
	| "catppuccin-frappe"
	| "catppuccin-latte"
	| "dracula"
	| "nord"
	| "gruvbox-dark"
	| "tokyo-night"
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
		name: "Light",
		appearance: "light",
		description: "Original light theme with clean neutral surfaces.",
		preview: {
			toolbar: "#F9F9FB",
			field: "#E6E6E6",
			text: "#15141A",
			accent: "#5B5B66",
		},
		tokens: {
			frame: "rgb(240, 240, 244)",
			toolbar: "rgb(249, 249, 251)",
			toolbar_text: "rgb(21, 20, 26)",
			tab_background_text: "black",
			toolbar_field: "rgb(230, 230, 230)",
			toolbar_field_text: "black",
			tab_line: "rgb(91, 91, 102)",
			popup: "rgb(255, 255, 255)",
			popup_text: "black",
			icons: "rgb(91, 91, 102)",
			ntp_background: "rgb(249, 249, 251)",
			ntp_text: "rgb(21, 20, 26)",
			popup_border: "rgb(230, 230, 230)",
			toolbar_top_separator: "rgb(240, 240, 244)",
			tab_loading: "rgb(91, 91, 102)",
		},
	},
	{
		id: "dark",
		name: "Dark",
		appearance: "dark",
		description: "Original dark theme with purple-gray tones.",
		preview: {
			toolbar: "#2b2a33",
			field: "#1C1B22",
			text: "#FFFFFF",
			accent: "#42414d",
		},
		tokens: {
			frame: "#1c1b22",
			toolbar: "#2b2a33",
			toolbar_text: "white",
			tab_background_text: "white",
			toolbar_field: "#1C1B22",
			toolbar_field_text: "white",
			tab_line: "white",
			popup: "#1C1B22",
			popup_text: "white",
			icons: "white",
			ntp_background: "#121117",
			ntp_text: "white",
			popup_border: "#42414d",
			toolbar_top_separator: "#1c1b22",
			tab_loading: "white",
		},
	},
	{
		id: "catppuccin-mocha",
		name: "Catppuccin Mocha",
		appearance: "dark",
		description: "Muted mauve surfaces with soft lavender highlights.",
		preview: {
			toolbar: "#2D293B",
			field: "#1E1E28",
			text: "#ECD5BF",
			accent: "#C6AAE8",
		},
		tokens: {
			toolbar: "rgb(45, 41, 59)",
			toolbar_text: "rgb(236, 191, 189)",
			frame: "rgb(30, 30, 40)",
			tab_background_text: "rgb(215, 218, 224)",
			toolbar_field: "rgb(30, 30, 40)",
			toolbar_field_text: "rgb(236, 191, 189)",
			tab_line: "rgb(236, 191, 189)",
			popup: "rgb(30, 30, 40)",
			popup_text: "rgb(236, 191, 189)",
			icons: "rgb(198, 170, 232)",
			ntp_background: "rgb(21, 18, 28)",
			ntp_text: "rgb(164, 185, 239)",
			popup_border: "rgb(236, 191, 189)",
			toolbar_top_separator: "rgb(30, 30, 40)",
			tab_loading: "rgb(236, 191, 189)",
		},
	},
	{
		id: "catppuccin-macchiato",
		name: "Catppuccin Macchiato",
		appearance: "dark",
		description: "Warm rosewater tones with pink accents.",
		preview: {
			toolbar: "#24273A",
			field: "#1E2030",
			text: "#F4DBD6",
			accent: "#F5BDE6",
		},
		tokens: {
			toolbar: "#24273A",
			toolbar_text: "#F4DBD6",
			frame: "#1E2030",
			tab_background_text: "#CAD3F5",
			toolbar_field: "#1E2030",
			toolbar_field_text: "#F4DBD6",
			tab_line: "#F5BDE6",
			popup: "#1E2030",
			popup_text: "#F4DBD6",
			icons: "#C6A0F6",
			ntp_background: "#181926",
			ntp_text: "#A6DA95",
			popup_border: "#F4DBD6",
			toolbar_top_separator: "#1E2030",
			tab_loading: "#F5BDE6",
		},
	},
	{
		id: "catppuccin-frappe",
		name: "Catppuccin Frappé",
		appearance: "dark",
		description: "Cool blue-gray with vibrant mauve highlights.",
		preview: {
			toolbar: "#303446",
			field: "#292C3C",
			text: "#F2D5CF",
			accent: "#CA9EE6",
		},
		tokens: {
			toolbar: "#303446",
			toolbar_text: "#F2D5CF",
			frame: "#292C3C",
			tab_background_text: "#C6D0F5",
			toolbar_field: "#292C3C",
			toolbar_field_text: "#F2D5CF",
			tab_line: "#CA9EE6",
			popup: "#292C3C",
			popup_text: "#F2D5CF",
			icons: "#BABBF1",
			ntp_background: "#232634",
			ntp_text: "#A6D189",
			popup_border: "#F2D5CF",
			toolbar_top_separator: "#292C3C",
			tab_loading: "#CA9EE6",
		},
	},
	{
		id: "catppuccin-latte",
		name: "Catppuccin Latte",
		appearance: "light",
		description: "Soft latte with warm lavender accents.",
		preview: {
			toolbar: "#E6E9EF",
			field: "#EFF1F5",
			text: "#4C4F69",
			accent: "#8839EF",
		},
		tokens: {
			toolbar: "#E6E9EF",
			toolbar_text: "#4C4F69",
			frame: "#DCE0E8",
			tab_background_text: "#4C4F69",
			toolbar_field: "#EFF1F5",
			toolbar_field_text: "#4C4F69",
			tab_line: "#8839EF",
			popup: "#EFF1F5",
			popup_text: "#4C4F69",
			icons: "#7287FD",
			ntp_background: "#E6E9EF",
			ntp_text: "#40A02B",
			popup_border: "#ACB0BE",
			toolbar_top_separator: "#DCE0E8",
			tab_loading: "#8839EF",
		},
	},
	{
		id: "dracula",
		name: "Dracula",
		appearance: "dark",
		description: "Dark theme with vibrant purple and pink accents.",
		preview: {
			toolbar: "#282A36",
			field: "#21222C",
			text: "#F8F8F2",
			accent: "#BD93F9",
		},
		tokens: {
			toolbar: "#282A36",
			toolbar_text: "#F8F8F2",
			frame: "#21222C",
			tab_background_text: "#F8F8F2",
			toolbar_field: "#21222C",
			toolbar_field_text: "#F8F8F2",
			tab_line: "#BD93F9",
			popup: "#21222C",
			popup_text: "#F8F8F2",
			icons: "#FF79C6",
			ntp_background: "#1A1B26",
			ntp_text: "#50FA7B",
			popup_border: "#6272A4",
			toolbar_top_separator: "#21222C",
			tab_loading: "#BD93F9",
		},
	},
	{
		id: "nord",
		name: "Nord",
		appearance: "dark",
		description: "Arctic, north-bluish color palette.",
		preview: {
			toolbar: "#3B4252",
			field: "#2E3440",
			text: "#ECEFF4",
			accent: "#88C0D0",
		},
		tokens: {
			toolbar: "#3B4252",
			toolbar_text: "#ECEFF4",
			frame: "#2E3440",
			tab_background_text: "#ECEFF4",
			toolbar_field: "#2E3440",
			toolbar_field_text: "#ECEFF4",
			tab_line: "#88C0D0",
			popup: "#2E3440",
			popup_text: "#ECEFF4",
			icons: "#81A1C1",
			ntp_background: "#2E3440",
			ntp_text: "#A3BE8C",
			popup_border: "#4C566A",
			toolbar_top_separator: "#2E3440",
			tab_loading: "#88C0D0",
		},
	},
	{
		id: "gruvbox-dark",
		name: "Gruvbox Dark",
		appearance: "dark",
		description: "Retro groove with warm earthy tones.",
		preview: {
			toolbar: "#282828",
			field: "#1D2021",
			text: "#EBDBB2",
			accent: "#FE8019",
		},
		tokens: {
			toolbar: "#282828",
			toolbar_text: "#EBDBB2",
			frame: "#1D2021",
			tab_background_text: "#EBDBB2",
			toolbar_field: "#1D2021",
			toolbar_field_text: "#EBDBB2",
			tab_line: "#FE8019",
			popup: "#1D2021",
			popup_text: "#EBDBB2",
			icons: "#FABD2F",
			ntp_background: "#1D2021",
			ntp_text: "#B8BB26",
			popup_border: "#504945",
			toolbar_top_separator: "#1D2021",
			tab_loading: "#FE8019",
		},
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		appearance: "dark",
		description: "Clean dark theme inspired by Tokyo's night skyline.",
		preview: {
			toolbar: "#1A1B26",
			field: "#16161E",
			text: "#C0CAF5",
			accent: "#7AA2F7",
		},
		tokens: {
			toolbar: "#1A1B26",
			toolbar_text: "#C0CAF5",
			frame: "#16161E",
			tab_background_text: "#C0CAF5",
			toolbar_field: "#16161E",
			toolbar_field_text: "#C0CAF5",
			tab_line: "#7AA2F7",
			popup: "#16161E",
			popup_text: "#C0CAF5",
			icons: "#BB9AF7",
			ntp_background: "#16161E",
			ntp_text: "#9ECE6A",
			popup_border: "#292E42",
			toolbar_top_separator: "#16161E",
			tab_loading: "#7AA2F7",
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
			text: "#FDF6E3",
			accent: "#268BD2",
		},
		tokens: {
			toolbar: "#002B36",
			toolbar_text: "#FDF6E3",
			frame: "#073642",
			tab_background_text: "#FDF6E3",
			toolbar_field: "#073642",
			toolbar_field_text: "#FDF6E3",
			tab_line: "#268BD2",
			popup: "#073642",
			popup_text: "#FDF6E3",
			icons: "#2AA198",
			ntp_background: "#002B36",
			ntp_text: "#859900",
			popup_border: "#586E75",
			toolbar_top_separator: "#073642",
			tab_loading: "#268BD2",
		},
	},
	{
		id: "solarized-light",
		name: "Solarized Light",
		appearance: "light",
		description: "Light variant of the precision color scheme.",
		preview: {
			toolbar: "#FDF6E3",
			field: "#EEE8D5",
			text: "#002B36",
			accent: "#268BD2",
		},
		tokens: {
			toolbar: "#FDF6E3",
			toolbar_text: "#002B36",
			frame: "#EEE8D5",
			tab_background_text: "#002B36",
			toolbar_field: "#EEE8D5",
			toolbar_field_text: "#002B36",
			tab_line: "#268BD2",
			popup: "#EEE8D5",
			popup_text: "#002B36",
			icons: "#2AA198",
			ntp_background: "#FDF6E3",
			ntp_text: "#859900",
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
