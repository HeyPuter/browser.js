/**
 * Extracts charset from a Content-Type header value.
 *
 * Handles formats like:
 *   text/html; charset=utf-8
 *   text/html;charset=UTF-8
 *   text/html; charset="utf-8"
 *   text/html; charset='utf-8'
 *   text/html; charset=utf-8; boundary=something
 */
export function charsetFromHeaders(contentType: string | null): string | null {
	if (!contentType) return null;

	const params = contentType.split(";");

	for (let i = 1; i < params.length; i++) {
		const param = params[i].trim();
		if (param.toLowerCase().startsWith("charset=")) {
			let value = param.slice("charset=".length).trim();
			// strip quotes if present
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			return value || null;
		}
	}

	return null;
}

/**
 * Extracts the value of an attribute from a tag body string (text between
 * `<tagname` and `>`). Returns null if the attribute is not found.
 * Handles quoted (single/double) and unquoted attribute values.
 *
 * Iterates through attributes properly so it won't match attribute names
 * that appear inside another attribute's quoted value.
 */
function getAttr(tag: string, name: string): string | null {
	const lower = tag.toLowerCase();
	const needle = name.toLowerCase();
	let pos = 0;

	while (pos < lower.length) {
		// Skip whitespace
		while (pos < lower.length && " \t\n\r".includes(lower[pos])) pos++;
		if (pos >= lower.length) break;

		// Read attribute name
		const nameStart = pos;
		while (
			pos < lower.length &&
			lower[pos] !== "=" &&
			!" \t\n\r>/".includes(lower[pos])
		) {
			pos++;
		}
		const attrName = lower.slice(nameStart, pos);

		// Skip whitespace before potential =
		while (pos < lower.length && " \t\n\r".includes(lower[pos])) pos++;

		if (pos >= lower.length || lower[pos] !== "=") {
			// Boolean attribute (no value) — skip it
			continue;
		}
		pos++; // skip =

		// Skip whitespace after =
		while (pos < lower.length && " \t\n\r".includes(lower[pos])) pos++;
		if (pos >= lower.length) break;

		// Read attribute value
		let value: string;
		const quote = tag[pos];
		if (quote === '"' || quote === "'") {
			pos++; // skip opening quote
			const valEnd = tag.indexOf(quote, pos);
			if (valEnd === -1) {
				value = tag.slice(pos);
				pos = tag.length;
			} else {
				value = tag.slice(pos, valEnd);
				pos = valEnd + 1;
			}
		} else {
			// Unquoted value — ends at whitespace, >, or /
			const valStart = pos;
			while (pos < tag.length && !" \t\n\r>/".includes(tag[pos])) {
				pos++;
			}
			value = tag.slice(valStart, pos);
		}

		if (attrName === needle) {
			return value;
		}
	}

	return null;
}

/**
 * Extracts charset from HTML content by looking at meta tags.
 *
 * Only searches the first 1024 bytes (as per HTML spec recommendation).
 *
 * Handles:
 *   <meta charset="utf-8">
 *   <meta charset='utf-8'>
 *   <meta charset=utf-8>
 *   <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
 *   Mixed case variations
 */
export function charsetFromHtml(html: string): string | null {
	// Only scan the beginning of the document - charset declarations
	// should be within the first 1024 bytes per HTML spec
	const head = html.slice(0, 1024);
	const lower = head.toLowerCase();

	let pos = 0;
	while (pos < lower.length) {
		const tagStart = lower.indexOf("<meta", pos);
		if (tagStart === -1) break;

		// Make sure it's actually a <meta tag and not e.g. <metadata
		const afterMeta = tagStart + 5;
		if (
			afterMeta < lower.length &&
			lower[afterMeta] !== " " &&
			lower[afterMeta] !== "\t" &&
			lower[afterMeta] !== "\n" &&
			lower[afterMeta] !== "\r" &&
			lower[afterMeta] !== "/" &&
			lower[afterMeta] !== ">"
		) {
			pos = afterMeta;
			continue;
		}

		const tagEnd = head.indexOf(">", afterMeta);
		if (tagEnd === -1) break;

		// Extract the content between <meta and >
		const tagBody = head.slice(afterMeta, tagEnd);

		// Check for charset attribute directly on the meta tag
		const charsetVal = getAttr(tagBody, "charset");
		if (charsetVal) {
			return charsetVal;
		}

		// Check for http-equiv="Content-Type" with content="...charset=..."
		const httpEquiv = getAttr(tagBody, "http-equiv");
		if (httpEquiv && httpEquiv.toLowerCase() === "content-type") {
			const content = getAttr(tagBody, "content");
			if (content) {
				// Parse charset from the content value (same format as Content-Type header)
				const charset = charsetFromHeaders(content);
				if (charset) return charset;
			}
		}

		pos = tagEnd + 1;
	}

	return null;
}

/**
 * Guesses the charset of an HTML response by checking, in order:
 *   1. The Content-Type header
 *   2. Meta tags in the HTML
 *   3. Defaults to "utf-8"
 */
export function guessCharset(
	contentTypeHeader: string | null,
	htmlContent: string
): string {
	return (
		charsetFromHeaders(contentTypeHeader) ||
		charsetFromHtml(htmlContent) ||
		"utf-8"
	);
}
