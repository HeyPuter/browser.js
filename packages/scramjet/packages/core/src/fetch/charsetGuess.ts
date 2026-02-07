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

	// Try <meta charset="...">
	const metaCharsetMatch = head.match(
		/<meta\s[^>]*charset\s*=\s*["']?\s*([^\s"';>]+)/i
	);
	if (metaCharsetMatch) {
		return metaCharsetMatch[1];
	}

	// Try <meta http-equiv="Content-Type" content="...charset=...">
	const httpEquivMatch = head.match(
		/<meta\s[^>]*http-equiv\s*=\s*["']?\s*Content-Type\s*["']?\s[^>]*content\s*=\s*["']?[^"'>]*charset=\s*([^\s"';>]+)/i
	);
	if (httpEquivMatch) {
		return httpEquivMatch[1];
	}

	// Also try with content before http-equiv (attribute order may vary)
	const httpEquivReverseMatch = head.match(
		/<meta\s[^>]*content\s*=\s*["']?[^"'>]*charset=\s*([^\s"';>]+)[^>]*http-equiv\s*=\s*["']?\s*Content-Type/i
	);
	if (httpEquivReverseMatch) {
		return httpEquivReverseMatch[1];
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
