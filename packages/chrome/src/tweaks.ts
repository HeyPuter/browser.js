/**
 * "Tweaks" — the independent axes of the browser's visual style.
 *
 * Each axis is a separate user setting (see `Settings` in
 * services/SettingsService.ts) and a separate `body` class, so they compose
 * freely: sharp corners with attached tabs and bouncy motion is as valid a
 * combination as any other. The Chromium-flavoured value of every axis is the
 * non-default one, so picking all of them together reproduces Chrome's look.
 *
 * The default for each axis is baked in at build time. `resolveDefaultTweaks`
 * is run from vite.config.ts against `process.env` and inlined into the bundle
 * as `__DEFAULT_TWEAKS__`, which SettingsService folds into its defaults.
 * That's why this module has no imports: it is loaded both by the Vite config
 * in Node and by the app in the browser.
 *
 * To add an axis: add its key to `Tweaks`, add an entry to `TWEAKS`, and
 * consume `body.<slug>-<id>` from CSS. The settings UI and the `body` classes
 * are both generated from `TWEAKS`, so nothing else needs updating.
 */

/** Corner radius scale. Consumed as the `--radius-*` tokens in style.css. */
export type Roundness = "sharp" | "balanced" | "round";

/** How tabs meet the toolbar. See the shaping rules in DragTab.style. */
export type TabStyle = "floating" | "attached";

/** Which glyph set `<Icon>` draws. See icons.ts. */
export type IconSet = "ionicons" | "material";

/** Easing curve family. Consumed as the `--ease-*` tokens; see easing.ts. */
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
	/** Section heading in the Tweaks settings pane. */
	title: string;
	/** Section subheading in the Tweaks settings pane. */
	description: string;
	/**
	 * Prefix for this axis' `body` class (`<slug>-<option id>`) and for the
	 * radio group's `name`/`id` attributes.
	 */
	slug: string;
	/**
	 * Environment variable read at build time to override `fallback`. Its value
	 * must be one of the option ids or the build fails; see
	 * `resolveDefaultTweaks`.
	 */
	env: string;
	/** Default used when the build-time environment variable is unset. */
	fallback: Tweaks[K];
	options: readonly TweakOption<K>[];
};

export const TWEAKS: { readonly [K in TweakKey]: TweakDefinition<K> } = {
	roundness: {
		title: "Roundness",
		description: "How rounded corners are across the interface.",
		slug: "roundness",
		env: "VITE_TWEAK_ROUNDNESS",
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
		env: "VITE_TWEAK_TAB_STYLE",
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
		env: "VITE_TWEAK_ICONS",
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
		env: "VITE_TWEAK_ANIMATIONS",
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

/** Every tweak key, in the order the settings pane lists them. */
export const TWEAK_KEYS = Object.keys(TWEAKS) as readonly TweakKey[];

/** The `body` class this axis contributes for a given value. */
export function tweakClass<K extends TweakKey>(key: K, value: Tweaks[K]) {
	return `${TWEAKS[key].slug}-${value}`;
}

/**
 * Resolve the build-time default for every axis from an environment.
 *
 * Called from vite.config.ts, i.e. in Node during config load, *not* in the
 * browser. An unset variable falls back to the axis' `fallback`; a variable
 * set to anything other than an option id throws, so a typo fails the build
 * rather than silently shipping the default.
 */
export function resolveDefaultTweaks(
	env: Record<string, string | undefined>
): Tweaks {
	const resolved: Record<string, string> = {};

	for (const key of TWEAK_KEYS) {
		const definition: TweakDefinition<TweakKey> = TWEAKS[key];
		const raw = env[definition.env]?.trim();

		if (!raw) {
			resolved[key] = definition.fallback;
			continue;
		}

		const match = definition.options.find((option) => option.id === raw);
		if (!match) {
			const valid = definition.options.map((option) => option.id).join(", ");
			throw new Error(
				`${definition.env}="${raw}" is not a valid ${key} tweak. Expected one of: ${valid}.`
			);
		}

		resolved[key] = match.id;
	}

	return resolved as Tweaks;
}
