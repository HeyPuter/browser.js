/// <reference types="vite/client" />
/// <reference types="@mercuryworkshop/scramjet" />

interface ImportMetaEnv {
	readonly VITE_PUTER_BRANDING: boolean;
	readonly VITE_SENTRY_URL: string;
	readonly VITE_ISOLATION_ORIGIN: string;
	readonly VITE_WISP_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare const puter: any;

/** Inlined by vite.config.ts's `define`. */
declare const __COPYRIGHT_YEAR__: number;

/**
 * Build-time defaults for the UI style tweaks, inlined by vite.config.ts's
 * `define` from the VITE_TWEAK_* environment variables. See src/tweaks.ts.
 */
declare const __DEFAULT_TWEAKS__: import("./tweaks").Tweaks;
