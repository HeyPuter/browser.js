/**
 * Selectors that name scramjet's own attributes.
 *
 * A page cannot see `scramjet-attr-*`, so a selector that tests for one has to
 * behave as though the attribute were absent - which is not the same as the
 * whole selector matching nothing. `div, [scramjet-attr-src]` still matches
 * every div, and `:not([scramjet-attr-src])` matches everything. So each such
 * attribute selector is replaced, in place, by one that never matches, and the
 * rest of the selector is left to mean what it meant.
 *
 * https://drafts.csswg.org/selectors/#attribute-selectors
 */

import { isInternalAttribute } from "@client/attributes";
import {
	Number_parseInt,
	String_charCodeAt,
	String_fromCodePoint,
	String_substring,
} from "@/shared/snapshot";

/** A simple selector that matches no element, valid anywhere `[attr]` is. */
const NEVER = ":not(*)";

function isHex(c: number): boolean {
	return (
		(c >= 0x30 && c <= 0x39) ||
		(c >= 0x41 && c <= 0x46) ||
		(c >= 0x61 && c <= 0x66)
	);
}

function isWhitespace(c: number): boolean {
	return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

/**
 * The index just past the `]` closing the attribute selector opened at
 * `start`, skipping strings and escapes, or -1 when it is never closed.
 */
function closingBracket(selector: string, start: number): number {
	let quote = 0;
	for (let i = start + 1; i < selector.length; i++) {
		const c = String_charCodeAt(selector, i);
		if (c === 0x5c) {
			i++;
			continue;
		}
		if (quote) {
			if (c === quote) quote = 0;
			continue;
		}
		if (c === 0x22 || c === 0x27) quote = c;
		else if (c === 0x5d) return i + 1;
	}

	return -1;
}

/**
 * The attribute name an attribute selector's body tests for, with its CSS
 * escapes decoded and its namespace prefix dropped.
 */
function attributeName(body: string): string {
	let i = 0;
	while (i < body.length && isWhitespace(String_charCodeAt(body, i))) i++;

	const ident = (): string => {
		let out = "";
		while (i < body.length) {
			const c = String_charCodeAt(body, i);
			if (c === 0x5c) {
				i++;
				let hex = "";
				while (
					hex.length < 6 &&
					i < body.length &&
					isHex(String_charCodeAt(body, i))
				) {
					hex += body[i++];
				}
				if (hex.length > 0) {
					if (i < body.length && isWhitespace(String_charCodeAt(body, i))) {
						i++;
					}
					const point = Number_parseInt(hex, 16);
					out += String_fromCodePoint(
						point === 0 || point > 0x10ffff ? 0xfffd : point
					);
				} else if (i < body.length) {
					out += body[i++];
				}
				continue;
			}
			// the end of a name: whitespace, a namespace separator, a matcher,
			// or the case-sensitivity flag after one
			if (
				isWhitespace(c) ||
				c === 0x7c || // |
				c === 0x3d || // =
				c === 0x7e || // ~
				c === 0x5e || // ^
				c === 0x24 || // $
				c === 0x2a // *
			) {
				break;
			}
			out += body[i++];
		}

		return out;
	};

	// `*|name`, `ns|name` and `|name` - the part before a lone `|` (one that
	// is not the start of `|=`) is a namespace prefix
	let name = String_charCodeAt(body, i) === 0x2a ? (i++, "*") : ident();
	if (
		String_charCodeAt(body, i) === 0x7c &&
		String_charCodeAt(body, i + 1) !== 0x3d
	) {
		i++;
		name = ident();
	}

	return name;
}

/**
 * `selector` with every attribute selector naming an internal attribute
 * replaced by one that never matches, or null when it names none - the
 * common case, which callers answer with the native result they already have.
 */
export function hideInternalAttributes(selector: string): string | null {
	let out = "";
	let last = 0;
	let changed = false;
	let quote = 0;

	for (let i = 0; i < selector.length; i++) {
		const c = String_charCodeAt(selector, i);
		if (c === 0x5c) {
			i++;
			continue;
		}
		if (quote) {
			if (c === quote) quote = 0;
			continue;
		}
		if (c === 0x22 || c === 0x27) {
			quote = c;
			continue;
		}
		if (c !== 0x5b) continue;

		const end = closingBracket(selector, i);
		// unterminated: the parser closes it at the end of the input
		const stop = end === -1 ? selector.length : end;
		const body = String_substring(
			selector,
			i + 1,
			end === -1 ? stop : stop - 1
		);
		if (isInternalAttribute(attributeName(body))) {
			out += String_substring(selector, last, i) + NEVER;
			last = stop;
			changed = true;
		}
		i = stop - 1;
	}

	if (!changed) return null;

	return out + String_substring(selector, last);
}
