import { Object_getOwnPropertyDescriptor } from "@/shared/snapshot";
import { SCRAMJETCLIENT } from "@/symbols";
// type-only: `client.ts` imports from here, and a value import would close the
// cycle at runtime
import type { ScramjetClient } from "./client";

export function getOwnPropertyDescriptorHandler(target, prop) {
	const realDescriptor = Object_getOwnPropertyDescriptor(target, prop);

	return realDescriptor;
}

/**
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-open-steps
 *
 * Shared by `window.open` and the three-argument `document.open`, which is the
 * same operation reached under another name.
 *
 */
export function openWindowSteps(
	client: ScramjetClient,
	nativeOpen: (
		url?: string,
		target?: string,
		features?: string
	) => Window | null,
	url?: string,
	target?: string,
	features?: string
): Window | null {
	// `url` defaults to the empty string, which opens about:blank - so an absent
	// argument and an explicit "" mean the same thing and neither is a URL to
	// rewrite. Anything else is.
	const href = url === undefined || url === "" ? url : client.rewriteUrl(url);

	if (target !== undefined && target !== null) {
		if (target === "_top" || target === "_unfencedTop") {
			target = client.meta.topFrameName;
		}
		if (target === "_parent") {
			target = client.meta.parentFrameName;
		}
	}

	const realwin = nativeOpen(href, target, features);
	if (!realwin) return realwin;

	if (!(SCRAMJETCLIENT in realwin)) {
		// i don't believe it's possible for a just-opened window to already have scramjet loaded but just in case
		client.init.hookSubcontext(realwin as Self);
	}

	return realwin;
}
