/**
 * @fileoverview
 * Implements the WHATWG encoding sniffing algorithm for HTML documents.
 *
 * References:
 *   - HTML Standard §13.2.3.1 "Determining the character encoding"
 *     https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding
 *   - HTML Standard §13.2.3.2 "Prescan a byte stream to determine its encoding"
 *     https://html.spec.whatwg.org/multipage/parsing.html#prescan-a-byte-stream-to-determine-its-encoding
 *   - Encoding Standard §4.2 "Names and labels"
 *     https://encoding.spec.whatwg.org/#names-and-labels
 */

// ── WHATWG Encoding label → name mapping (Encoding Standard §4.2) ──────
// Maps every recognized label (lowercased) to its canonical encoding name.
// Only includes encodings that TextDecoder supports.
const ENCODING_LABELS: Record<string, string> = {
	// UTF-8
	"unicode-1-1-utf-8": "UTF-8",
	"unicode11utf8": "UTF-8",
	"unicode20utf8": "UTF-8",
	utf8: "UTF-8",
	"utf-8": "UTF-8",
	"x-unicode20utf8": "UTF-8",

	// IBM866
	"866": "IBM866",
	"cp866": "IBM866",
	csibm866: "IBM866",
	ibm866: "IBM866",

	// ISO-8859-2
	csisolatin2: "ISO-8859-2",
	"iso-8859-2": "ISO-8859-2",
	"iso-ir-101": "ISO-8859-2",
	"iso8859-2": "ISO-8859-2",
	iso88592: "ISO-8859-2",
	"iso_8859-2": "ISO-8859-2",
	"iso_8859-2:1987": "ISO-8859-2",
	l2: "ISO-8859-2",
	latin2: "ISO-8859-2",

	// ISO-8859-3
	csisolatin3: "ISO-8859-3",
	"iso-8859-3": "ISO-8859-3",
	"iso-ir-109": "ISO-8859-3",
	"iso8859-3": "ISO-8859-3",
	iso88593: "ISO-8859-3",
	"iso_8859-3": "ISO-8859-3",
	"iso_8859-3:1988": "ISO-8859-3",
	l3: "ISO-8859-3",
	latin3: "ISO-8859-3",

	// ISO-8859-4
	csisolatin4: "ISO-8859-4",
	"iso-8859-4": "ISO-8859-4",
	"iso-ir-110": "ISO-8859-4",
	"iso8859-4": "ISO-8859-4",
	iso88594: "ISO-8859-4",
	"iso_8859-4": "ISO-8859-4",
	"iso_8859-4:1988": "ISO-8859-4",
	l4: "ISO-8859-4",
	latin4: "ISO-8859-4",

	// ISO-8859-5
	csisolatincyrillic: "ISO-8859-5",
	cyrillic: "ISO-8859-5",
	"iso-8859-5": "ISO-8859-5",
	"iso-ir-144": "ISO-8859-5",
	"iso8859-5": "ISO-8859-5",
	iso88595: "ISO-8859-5",
	"iso_8859-5": "ISO-8859-5",
	"iso_8859-5:1988": "ISO-8859-5",

	// ISO-8859-6
	arabic: "ISO-8859-6",
	"asmo-708": "ISO-8859-6",
	csiso88596e: "ISO-8859-6",
	csiso88596i: "ISO-8859-6",
	csisolatinarabic: "ISO-8859-6",
	"ecma-114": "ISO-8859-6",
	"iso-8859-6": "ISO-8859-6",
	"iso-8859-6-e": "ISO-8859-6",
	"iso-8859-6-i": "ISO-8859-6",
	"iso-ir-127": "ISO-8859-6",
	"iso8859-6": "ISO-8859-6",
	iso88596: "ISO-8859-6",
	"iso_8859-6": "ISO-8859-6",
	"iso_8859-6:1987": "ISO-8859-6",

	// ISO-8859-7
	csisolatingreek: "ISO-8859-7",
	"ecma-118": "ISO-8859-7",
	elot_928: "ISO-8859-7",
	greek: "ISO-8859-7",
	greek8: "ISO-8859-7",
	"iso-8859-7": "ISO-8859-7",
	"iso-ir-126": "ISO-8859-7",
	"iso8859-7": "ISO-8859-7",
	iso88597: "ISO-8859-7",
	"iso_8859-7": "ISO-8859-7",
	"iso_8859-7:1987": "ISO-8859-7",
	"sun_eu_greek": "ISO-8859-7",

	// ISO-8859-8
	csiso88598e: "ISO-8859-8",
	csisolatinhebrew: "ISO-8859-8",
	hebrew: "ISO-8859-8",
	"iso-8859-8": "ISO-8859-8",
	"iso-8859-8-e": "ISO-8859-8",
	"iso-ir-138": "ISO-8859-8",
	"iso8859-8": "ISO-8859-8",
	iso88598: "ISO-8859-8",
	"iso_8859-8": "ISO-8859-8",
	"iso_8859-8:1988": "ISO-8859-8",
	visual: "ISO-8859-8",

	// ISO-8859-8-I
	csiso88598i: "ISO-8859-8-I",
	"iso-8859-8-i": "ISO-8859-8-I",
	logical: "ISO-8859-8-I",

	// ISO-8859-10
	csisolatin6: "ISO-8859-10",
	"iso-8859-10": "ISO-8859-10",
	"iso-ir-157": "ISO-8859-10",
	"iso8859-10": "ISO-8859-10",
	iso885910: "ISO-8859-10",
	l6: "ISO-8859-10",
	latin6: "ISO-8859-10",

	// ISO-8859-13
	"iso-8859-13": "ISO-8859-13",
	"iso8859-13": "ISO-8859-13",
	iso885913: "ISO-8859-13",

	// ISO-8859-14
	"iso-8859-14": "ISO-8859-14",
	"iso8859-14": "ISO-8859-14",
	iso885914: "ISO-8859-14",

	// ISO-8859-15
	csisolatin9: "ISO-8859-15",
	"iso-8859-15": "ISO-8859-15",
	"iso8859-15": "ISO-8859-15",
	iso885915: "ISO-8859-15",
	"iso_8859-15": "ISO-8859-15",
	l9: "ISO-8859-15",

	// ISO-8859-16
	"iso-8859-16": "ISO-8859-16",

	// KOI8-R
	cskoi8r: "KOI8-R",
	koi: "KOI8-R",
	koi8: "KOI8-R",
	"koi8-r": "KOI8-R",
	koi8_r: "KOI8-R",

	// KOI8-U
	"koi8-ru": "KOI8-U",
	"koi8-u": "KOI8-U",

	// macintosh
	csmacintosh: "macintosh",
	mac: "macintosh",
	macintosh: "macintosh",
	"x-mac-roman": "macintosh",

	// windows-874
	"dos-874": "windows-874",
	"iso-8859-11": "windows-874",
	"iso8859-11": "windows-874",
	iso885911: "windows-874",
	"tis-620": "windows-874",
	"windows-874": "windows-874",

	// windows-1250
	"cp1250": "windows-1250",
	"windows-1250": "windows-1250",
	"x-cp1250": "windows-1250",

	// windows-1251
	"cp1251": "windows-1251",
	"windows-1251": "windows-1251",
	"x-cp1251": "windows-1251",

	// windows-1252 (also the target for ISO-8859-1 per WHATWG)
	"ansi_x3.4-1968": "windows-1252",
	ascii: "windows-1252",
	"cp1252": "windows-1252",
	"cp819": "windows-1252",
	csisolatin1: "windows-1252",
	ibm819: "windows-1252",
	"iso-8859-1": "windows-1252",
	"iso-ir-100": "windows-1252",
	"iso8859-1": "windows-1252",
	iso88591: "windows-1252",
	"iso_8859-1": "windows-1252",
	"iso_8859-1:1987": "windows-1252",
	l1: "windows-1252",
	latin1: "windows-1252",
	"us-ascii": "windows-1252",
	"windows-1252": "windows-1252",
	"x-cp1252": "windows-1252",

	// windows-1253
	"cp1253": "windows-1253",
	"windows-1253": "windows-1253",
	"x-cp1253": "windows-1253",

	// windows-1254
	"cp1254": "windows-1254",
	csisolatin5: "windows-1254",
	"iso-8859-9": "windows-1254",
	"iso-ir-148": "windows-1254",
	"iso8859-9": "windows-1254",
	iso88599: "windows-1254",
	"iso_8859-9": "windows-1254",
	"iso_8859-9:1989": "windows-1254",
	l5: "windows-1254",
	latin5: "windows-1254",
	"windows-1254": "windows-1254",
	"x-cp1254": "windows-1254",

	// windows-1255
	"cp1255": "windows-1255",
	"windows-1255": "windows-1255",
	"x-cp1255": "windows-1255",

	// windows-1256
	"cp1256": "windows-1256",
	"windows-1256": "windows-1256",
	"x-cp1256": "windows-1256",

	// windows-1257
	"cp1257": "windows-1257",
	"windows-1257": "windows-1257",
	"x-cp1257": "windows-1257",

	// windows-1258
	"cp1258": "windows-1258",
	"windows-1258": "windows-1258",
	"x-cp1258": "windows-1258",

	// x-mac-cyrillic
	"x-mac-cyrillic": "x-mac-cyrillic",
	"x-mac-ukrainian": "x-mac-cyrillic",

	// GBK / gb18030
	chinese: "GBK",
	csgb2312: "GBK",
	csiso58gb231280: "GBK",
	"gb2312": "GBK",
	"gb_2312": "GBK",
	"gb_2312-80": "GBK",
	gbk: "GBK",
	"iso-ir-58": "GBK",
	"x-gbk": "GBK",
	gb18030: "gb18030",

	// Big5
	big5: "Big5",
	"big5-hkscs": "Big5",
	"cn-big5": "Big5",
	csbig5: "Big5",
	"x-x-big5": "Big5",

	// EUC-JP
	cseucpkdfmtjapanese: "EUC-JP",
	"euc-jp": "EUC-JP",
	"x-euc-jp": "EUC-JP",

	// ISO-2022-JP
	csiso2022jp: "ISO-2022-JP",
	"iso-2022-jp": "ISO-2022-JP",

	// Shift_JIS
	csshiftjis: "Shift_JIS",
	ms932: "Shift_JIS",
	ms_kanji: "Shift_JIS",
	"shift-jis": "Shift_JIS",
	shift_jis: "Shift_JIS",
	sjis: "Shift_JIS",
	"windows-31j": "Shift_JIS",
	"x-sjis": "Shift_JIS",

	// EUC-KR
	cseuckr: "EUC-KR",
	csksc56011987: "EUC-KR",
	"euc-kr": "EUC-KR",
	"iso-ir-149": "EUC-KR",
	korean: "EUC-KR",
	"ks_c_5601-1987": "EUC-KR",
	"ks_c_5601-1989": "EUC-KR",
	ksc5601: "EUC-KR",
	ksc_5601: "EUC-KR",
	"windows-949": "EUC-KR",

	// UTF-16BE
	"utf-16be": "UTF-16BE",

	// UTF-16LE
	"utf-16": "UTF-16LE",
	"utf-16le": "UTF-16LE",

	// x-user-defined
	"x-user-defined": "x-user-defined",
};

/**
 * Resolves an encoding label to a canonical encoding name per the
 * WHATWG Encoding Standard §4.2.
 *
 * Strips leading/trailing ASCII whitespace and lowercases before lookup.
 * Returns null if the label is not recognized.
 */
export function resolveEncoding(label: string): string | null {
	const trimmed = label.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
	return ENCODING_LABELS[trimmed.toLowerCase()] || null;
}

// ── BOM sniffing (HTML Standard §13.2.3.1 step 1) ─────────────────────

/**
 * Sniffs the Byte Order Mark from raw bytes.
 * Returns the encoding indicated by the BOM, or null if none found.
 *
 * Per the HTML Standard:
 *   - EF BB BF → UTF-8
 *   - FE FF    → UTF-16BE
 *   - FF FE    → UTF-16LE
 */
export function sniffBOM(bytes: Uint8Array): string | null {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return "UTF-8";
	}
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		return "UTF-16BE";
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
		return "UTF-16LE";
	}
	return null;
}

// ── Content-Type header charset extraction ─────────────────────────────

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

// ── Prescan a byte stream (HTML Standard §13.2.3.2) ────────────────────

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
 * Prescans HTML content to extract a charset declaration from meta tags.
 * Implements the WHATWG HTML Standard §13.2.3.2
 * "Prescan a byte stream to determine its encoding".
 *
 * Only searches the first 1024 bytes.
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
				// Parse charset from the content value using the
				// "algorithm for extracting a character encoding from a
				// meta element" (WHATWG HTML §2.6.8)
				const charset = extractCharsetFromMeta(content);
				if (charset) return charset;
			}
		}

		pos = tagEnd + 1;
	}

	return null;
}

/**
 * Implements the WHATWG "algorithm for extracting a character encoding
 * from a meta element" (HTML Standard §2.6.8).
 *
 * Scans for "charset" in the content attribute value, then extracts the
 * encoding label that follows.
 */
function extractCharsetFromMeta(s: string): string | null {
	const lower = s.toLowerCase();
	let pos = 0;

	while (pos < lower.length) {
		const idx = lower.indexOf("charset", pos);
		if (idx === -1) return null;
		pos = idx + "charset".length;

		// Skip whitespace
		while (pos < lower.length && " \t\n\r".includes(lower[pos])) pos++;

		// Must have =
		if (pos >= lower.length || lower[pos] !== "=") continue;
		pos++;

		// Skip whitespace
		while (pos < lower.length && " \t\n\r".includes(lower[pos])) pos++;

		if (pos >= lower.length) return null;

		// Read the value
		const quote = s[pos];
		if (quote === '"' || quote === "'") {
			pos++;
			const end = s.indexOf(quote, pos);
			if (end === -1) return null;
			return s.slice(pos, end);
		}

		// Unquoted — grab until semicolon or whitespace
		const start = pos;
		while (
			pos < s.length &&
			s[pos] !== ";" &&
			!" \t\n\r".includes(s[pos])
		) {
			pos++;
		}
		return s.slice(start, pos);
	}

	return null;
}

// ── Main encoding sniffing algorithm (HTML Standard §13.2.3.1) ─────────

/**
 * Determines the character encoding of an HTML response following the
 * WHATWG HTML Standard §13.2.3.1 "Determining the character encoding".
 *
 * Steps (simplified for our use case — no user override or cached encoding):
 *   1. BOM sniffing on raw bytes
 *   2. Transport layer (Content-Type header charset)
 *   3. Prescan the byte stream for meta tags
 *   4. Default to UTF-8
 *
 * All results are resolved through the WHATWG encoding label table.
 */
export function sniffEncoding(
	bytes: Uint8Array,
	contentTypeHeader: string | null,
	htmlContent: string
): string {
	// Step 1: BOM sniffing (highest priority)
	const bom = sniffBOM(bytes);
	if (bom) return bom;

	// Step 2: Transport layer — Content-Type header
	const headerCharset = charsetFromHeaders(contentTypeHeader);
	if (headerCharset) {
		const resolved = resolveEncoding(headerCharset);
		if (resolved) return resolved;
		// If not recognized by WHATWG table, try using it as-is since
		// TextDecoder might still support it
		return headerCharset;
	}

	// Step 3: Prescan the byte stream
	const metaCharset = charsetFromHtml(htmlContent);
	if (metaCharset) {
		const resolved = resolveEncoding(metaCharset);
		if (resolved) return resolved;
		return metaCharset;
	}

	// Step 4: Default
	return "UTF-8";
}

/**
 * Backwards-compatible wrapper. Guesses the charset of an HTML response
 * by checking, in order:
 *   1. The Content-Type header
 *   2. Meta tags in the HTML
 *   3. Defaults to "utf-8"
 *
 * Does NOT do BOM sniffing (use sniffEncoding for the full algorithm).
 */
export function guessCharset(
	contentTypeHeader: string | null,
	htmlContent: string
): string {
	const headerCharset = charsetFromHeaders(contentTypeHeader);
	if (headerCharset) {
		return resolveEncoding(headerCharset) || headerCharset;
	}

	const metaCharset = charsetFromHtml(htmlContent);
	if (metaCharset) {
		return resolveEncoding(metaCharset) || metaCharset;
	}

	return "UTF-8";
}
