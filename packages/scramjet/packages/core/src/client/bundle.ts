/**
 * The client bundle's own source text, for evaluating a fresh copy of it in
 * another realm.
 *
 * A window scramjet hooks from outside - a `window.open` popup - used to run
 * the opener's module code against its own global. Everything that code
 * creates then belongs to the opener's realm, and once the opener navigates
 * away Chrome drops every job queued for it: an interceptor's `await` never
 * resumes, and listeners and timers wrapped by the opener's code never fire.
 * A copy evaluated in the popup belongs to the popup.
 *
 * The iife build wraps the whole bundle in `function __scramjetBundle() {}`
 * (see rspack.config.ts), whose source V8 keeps anyway. Handing back the same
 * text every time also lets V8 reuse what it compiled for the last copy.
 *
 * Null in a build without the wrapper (the ES module builds), where the caller
 * has to fall back to hooking with this realm's code.
 */
import { Function_toString } from "@/shared/snapshot";

declare const __scramjetBundle: ((...args: any[]) => any) | undefined;

export function bundleSource(): string | null {
	if (typeof __scramjetBundle !== "function") return null;

	return Function_toString(__scramjetBundle);
}
