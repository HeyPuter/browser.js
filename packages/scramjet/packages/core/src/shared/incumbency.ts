import { flagValue, ScramjetContext } from "@/shared";
import { IncumbencyMode } from "@/types";
import { Array_isArray, Error } from "@/shared/snapshot";
import { RAWFRAMES } from "@/symbols";

/** V8's CallSite, of which only what is needed here is named */
export type CallSite = {
	getScriptHash?: () => string;
	getScriptNameOrSourceURL?: () => string | undefined;
	getFileName?: () => string | undefined;
	isEval?: () => boolean;
};

/**
 * The CallSites for the current stack, past the formatter a page sees.
 *
 * Null off V8, or when neither route to raw frames is open: `shared/error.ts`
 * honouring {@link RAWFRAMES}, or - if that formatter is not installed -
 * setting one for the length of the call and putting the old one back.
 */
export function rawCallSites(): CallSite[] | null {
	const err = new Error();
	err[RAWFRAMES] = true;

	try {
		const asis = err.stack as unknown;
		if (Array_isArray(asis)) return asis as CallSite[];
	} catch {
		// a formatter that throws is not one to keep asking
	}

	try {
		const saved = (Error as any).prepareStackTrace;
		try {
			(Error as any).prepareStackTrace = (_e: Error, frames: CallSite[]) =>
				frames;
			const frames = new Error().stack as unknown;

			return Array_isArray(frames) ? (frames as CallSite[]) : null;
		} finally {
			(Error as any).prepareStackTrace = saved;
		}
	} catch {
		return null;
	}
}

/**
 * Whether this engine can do `pst`: `Error.prepareStackTrace` handing back
 * CallSites, and `getScriptHash` populated on them.
 *
 * Probed once while the bundle is still evaluating, which is before any client
 * module traps `Error.prepareStackTrace` and before the page has run.
 *
 * It measures the bundle's own script, so a deployment that injects scramjet
 * somewhere a hash is not computed for - CDP evaluation, where the hash comes
 * back empty - reads as unavailable even though the page's own scripts would
 * have had one. The defaults select `lazystamp` when this probe fails.
 */
export const pstAvailable: boolean = (() => {
	const frames = rawCallSites();
	if (!frames || frames.length === 0) return false;

	try {
		const hash = frames[0].getScriptHash?.();

		return typeof hash === "string" && hash.length > 0;
	} catch {
		return false;
	}
})();

/**
 * The configured mode, as configured. Nothing is substituted for anything:
 * which mode an engine can actually do is decided once, where the defaults are
 * built ({@link pstAvailable}), and a `pst` handed to an engine without the
 * two V8-only pieces it needs simply does not attribute anything.
 */
export function incumbencyMode(
	context: ScramjetContext,
	url: URL
): IncumbencyMode {
	return flagValue("incumbency", context, url);
}
