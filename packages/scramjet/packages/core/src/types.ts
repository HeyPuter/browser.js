/**
 * Version information for the current Scramjet build.
 * Contains both the semantic version string and the git commit hash for build identification.
 */
export interface ScramjetVersionInfo {
	/** The semantic version */
	version: string;
	/** The git commit hash that this build was created from */
	build: string;
	/** The date of the build */
	date: string;
}

/**
 * Scramjet Feature Flags, configured at build time
 */
/**
 * How a stack frame is traced back to the script that owns it, which is what
 * lets an incumbent settings object be identified.
 *
 * - `pst`   `Error.prepareStackTrace` plus `CallSite.getScriptHash`, both V8
 *           only. Costs nothing observable: the hash is already on every
 *           frame, eval'd ones included, and is not part of what a page reads.
 * - `nonce` A `//# sourceURL` carrying a per-rewrite nonce. Works wherever a
 *           stack can be read, but the sourceURL *is* what the page reads - in
 *           stack traces, in `onerror`, and in `ErrorEvent.filename` - so
 *           every one of those has to be emulated back.
 * - `stamp` Not implemented yet.
 * - `lazystamp`
 *           Not implemented yet.
 * - `none`  No attribution.
 *
 * The two stamp modes are recognised and carried through everywhere a mode is
 * read, but have no behaviour yet: they currently act as `none`.
 */
export type IncumbencyMode = "pst" | "nonce" | "stamp" | "lazystamp" | "none";

export type ScramjetFlags = {
	syncxhr: boolean;
	disableComputedWrap: boolean;
	rewriterLogs: boolean;
	captureErrors: boolean;
	cleanErrors: boolean;
	scramitize: boolean;
	sourcemaps: boolean;
	destructureRewrites: boolean;
	allowInvalidJs: boolean;
	debugTrampolines: boolean;
	debugSourceURL: boolean;
	incumbency: IncumbencyMode;
	encapsulateWorkers: boolean;
};

export interface ScramjetConfig {
	globals: {
		wrapfn: string;
		wrappropertybase: string;
		wrappropertyfn: string;
		cleanrestfn: string;
		importfn: string;
		rewritefn: string;
		metafn: string;
		pushsourcemapfn: string;
		registerrealmfn: string;
		trysetfn: string;
		templocid: string;
		tempunusedid: string;
	};
	flags: ScramjetFlags;
	siteFlags: Record<string, Partial<ScramjetFlags>>;
	maskedfiles: string[];
}

/**
 * The config for Scramjet initialization.
 */
export interface ScramjetInitConfig
	extends Omit<ScramjetConfig, "codec" | "flags"> {
	flags: Partial<ScramjetFlags>;
	codec: {
		encode: (url: string) => string;
		decode: (url: string) => string;
	};
}

//eslint-disable-next-line
export type AnyFunction = Function;
