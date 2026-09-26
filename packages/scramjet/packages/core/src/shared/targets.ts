/**
 * Navigation targets - the `target` and `formtarget` attributes, and the
 * `target` argument of `window.open` - as far as the rewriters are concerned.
 *
 * https://html.spec.whatwg.org/multipage/document-sequences.html#the-rules-for-choosing-a-navigable
 *
 * A proxied site's top-level document is really an iframe in its embedder, so
 * the two keywords that climb - `_top`, and `_parent` from that document - would
 * navigate the embedder rather than the site. Which navigable they mean depends
 * on where the document is in the tree, and nothing about a request says where
 * the navigable it will load into sits: the HTML rewriter cannot know. What it
 * writes is only a placeholder that is safe whoever reads it, and the client
 * running in the document puts the real value in place before anything can act
 * on the attribute - see `client/targets.ts`.
 */

import { String_charCodeAt, String_fromCharCode } from "@/shared/snapshot";

/**
 * https://infra.spec.whatwg.org/#ascii-lowercase - the keywords are matched
 * ASCII case-insensitively, and `toLowerCase` also folds characters outside
 * ASCII (U+212A KELVIN SIGN lowercases to "k").
 */
export function asciiLowercase(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const c = String_charCodeAt(value, i);
		out += String_fromCharCode(c >= 0x41 && c <= 0x5a ? c + 0x20 : c);
	}

	return out;
}

/**
 * The keyword `value` is, if it is one of the two that climb out of the
 * current navigable. `_unfencedTop` is not among them: outside a fenced frame
 * it is not a keyword the rules know, and a browser treats it as the name of a
 * navigable that does not exist yet.
 */
export function climbingKeyword(value: string): "_top" | "_parent" | null {
	// cheap rejection first: nearly every target is `_blank` or a plain name
	if (value.length !== 4 && value.length !== 7) return null;
	const lower = asciiLowercase(value);
	if (lower === "_top") return "_top";
	if (lower === "_parent") return "_parent";

	return null;
}

/**
 * The destinations a response is fetched for when it will become the document
 * of a child navigable - one with a parent, so one whose `_top` and `_parent`
 * lead somewhere else.
 */
export function isNestedDestination(destination: string | undefined): boolean {
	return (
		destination === "iframe" ||
		destination === "frame" ||
		destination === "object" ||
		destination === "embed" ||
		destination === "fencedframe"
	);
}

/**
 * What the HTML rewriter writes for a target in a document it knows will load
 * into a child navigable, not knowing which one.
 *
 * `_self` is where both keywords land in a top-level document - the one place
 * they cannot climb from - and anywhere else it keeps the navigation inside
 * the frame instead of letting it escape into the embedder. The client
 * replaces it before a click or a submission can read it.
 */
export function placeholderTarget(value: string): string {
	return climbingKeyword(value) ? "_self" : value;
}

/**
 * Whether a target the page wrote might have to be something else in the live
 * DOM - which only its document's client can answer. A climbing keyword, or a
 * name: the emulated top-level may be the navigable that goes by it. The empty
 * string, `_self` and `_blank` never change.
 */
export function targetMayNeedClient(value: string): boolean {
	if (value === "") return false;
	if (climbingKeyword(value)) return true;
	const lower = asciiLowercase(value);

	return lower !== "_self" && lower !== "_blank";
}

/** The attributes that hold a navigation target, and the elements they do it on. */
export const TARGET_ATTRIBUTES: { name: string; tags: string[] }[] = [
	{ name: "target", tags: ["a", "area", "base", "form"] },
	{ name: "formtarget", tags: ["button", "input"] },
];
