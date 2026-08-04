export type Roundness = "sharp" | "balanced" | "round";
export type TabStyle = "floating" | "attached";
export type IconSet = "ionicons" | "material";
export type AnimationStyle = "bouncy" | "smooth";

export type Tweaks = {
	roundness: Roundness;
	tabStyle: TabStyle;
	iconSet: IconSet;
	animations: AnimationStyle;
};

export type TweakKey = keyof Tweaks;

export type TweakOption<K extends TweakKey> = {
	id: Tweaks[K];
	name: string;
	description: string;
};

export type TweakDefinition<K extends TweakKey> = {
	title: string;
	description: string;
	slug: string;
	fallback: Tweaks[K];
	options: readonly TweakOption<K>[];
};

export const TWEAKS: { readonly [K in TweakKey]: TweakDefinition<K> } = {
	roundness: {
		title: "Roundness",
		description: "How rounded corners are across the interface.",
		slug: "roundness",
		fallback: "balanced",
		options: [
			{
				id: "sharp",
				name: "Sharper",
				description: "Tight corners and hard edges.",
			},
			{
				id: "balanced",
				name: "Balanced",
				description: "Moderate rounding throughout.",
			},
			{
				id: "round",
				name: "Rounder",
				description:
					"Generous rounding, with circular toolbar buttons and a pill-shaped address bar.",
			},
		],
	},
	tabStyle: {
		title: "Tab Style",
		description:
			"How tabs meet the toolbar. Only applies to the default layout, where tabs sit directly above the toolbar.",
		slug: "tabs",
		fallback: "floating",
		options: [
			{
				id: "floating",
				name: "Floating",
				description: "Rounded tabs that sit apart from the toolbar.",
			},
			{
				id: "attached",
				name: "Attached",
				description:
					"Tabs join onto the toolbar, curving outward where they meet it.",
			},
		],
	},
	iconSet: {
		title: "Icons",
		description: "Which set of icons the browser uses.",
		slug: "icons",
		fallback: "ionicons",
		options: [
			{
				id: "ionicons",
				name: "Ionicons",
				description: "Lighter, thinner line icons.",
			},
			{
				id: "material",
				name: "Material Symbols",
				description: "Rounded icons with a fuller, more even weight.",
			},
		],
	},
	animations: {
		title: "Animations",
		description: "How the interface moves.",
		slug: "anim",
		fallback: "bouncy",
		options: [
			{
				id: "bouncy",
				name: "Bouncy",
				description:
					"Things spring a little past where they're going, then settle.",
			},
			{
				id: "smooth",
				name: "Smooth",
				description: "Things glide straight to where they're going.",
			},
		],
	},
};

export const TWEAK_KEYS = Object.keys(TWEAKS) as readonly TweakKey[];
export function tweakClass<K extends TweakKey>(key: K, value: Tweaks[K]) {
	return `${TWEAKS[key].slug}-${value}`;
}
