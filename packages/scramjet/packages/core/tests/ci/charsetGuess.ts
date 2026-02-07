/**
 * @fileoverview
 * Tests for WHATWG encoding sniffing algorithm.
 * Tests charsetFromHeaders, charsetFromHtml, guessCharset, sniffBOM,
 * resolveEncoding, and sniffEncoding functions.
 */

import test from "ava";
import {
	charsetFromHeaders,
	charsetFromHtml,
	guessCharset,
	sniffBOM,
	resolveEncoding,
	sniffEncoding,
} from "../../src/fetch/charsetGuess.ts";

// ─── charsetFromHeaders ────────────────────────────────────────────────

test("charsetFromHeaders: returns null for null input", (t) => {
	t.is(charsetFromHeaders(null), null);
});

test("charsetFromHeaders: returns null for empty string", (t) => {
	t.is(charsetFromHeaders(""), null);
});

test("charsetFromHeaders: returns null when no charset param", (t) => {
	t.is(charsetFromHeaders("text/html"), null);
});

test("charsetFromHeaders: extracts charset from standard header", (t) => {
	t.is(charsetFromHeaders("text/html; charset=utf-8"), "utf-8");
});

test("charsetFromHeaders: extracts charset without space after semicolon", (t) => {
	t.is(charsetFromHeaders("text/html;charset=utf-8"), "utf-8");
});

test("charsetFromHeaders: extracts charset with double quotes", (t) => {
	t.is(charsetFromHeaders('text/html; charset="utf-8"'), "utf-8");
});

test("charsetFromHeaders: extracts charset with single quotes", (t) => {
	t.is(charsetFromHeaders("text/html; charset='utf-8'"), "utf-8");
});

test("charsetFromHeaders: extracts charset with uppercase", (t) => {
	t.is(charsetFromHeaders("text/html; charset=UTF-8"), "UTF-8");
});

test("charsetFromHeaders: extracts charset with mixed case key", (t) => {
	t.is(charsetFromHeaders("text/html; Charset=utf-8"), "utf-8");
});

test("charsetFromHeaders: handles charset with extra params after", (t) => {
	t.is(
		charsetFromHeaders("text/html; charset=utf-8; boundary=something"),
		"utf-8"
	);
});

test("charsetFromHeaders: handles shift_jis charset", (t) => {
	t.is(charsetFromHeaders("text/html; charset=shift_jis"), "shift_jis");
});

test("charsetFromHeaders: handles iso-8859-1", (t) => {
	t.is(charsetFromHeaders("text/html; charset=iso-8859-1"), "iso-8859-1");
});

test("charsetFromHeaders: handles windows-1252", (t) => {
	t.is(charsetFromHeaders("text/html; charset=windows-1252"), "windows-1252");
});

test("charsetFromHeaders: handles euc-jp", (t) => {
	t.is(charsetFromHeaders("text/html; charset=euc-jp"), "euc-jp");
});

test("charsetFromHeaders: handles quoted charset with trailing params", (t) => {
	t.is(
		charsetFromHeaders('text/html; charset="iso-8859-1"; boundary=foo'),
		"iso-8859-1"
	);
});

test("charsetFromHeaders: handles extra whitespace around value", (t) => {
	t.is(charsetFromHeaders("text/html; charset= utf-8 "), "utf-8");
});

test("charsetFromHeaders: returns null for empty charset value", (t) => {
	t.is(charsetFromHeaders("text/html; charset="), null);
});

test("charsetFromHeaders: non-html content type with charset", (t) => {
	t.is(
		charsetFromHeaders("application/json; charset=utf-8"),
		"utf-8"
	);
});

// ─── charsetFromHtml ───────────────────────────────────────────────────

test("charsetFromHtml: returns null for empty string", (t) => {
	t.is(charsetFromHtml(""), null);
});

test("charsetFromHtml: returns null for html without charset", (t) => {
	t.is(charsetFromHtml("<html><head><title>Test</title></head></html>"), null);
});

test('charsetFromHtml: extracts charset from <meta charset="...">', (t) => {
	t.is(
		charsetFromHtml('<html><head><meta charset="utf-8"></head></html>'),
		"utf-8"
	);
});

test("charsetFromHtml: extracts charset from <meta charset='...'>", (t) => {
	t.is(
		charsetFromHtml("<html><head><meta charset='utf-8'></head></html>"),
		"utf-8"
	);
});

test("charsetFromHtml: extracts charset from <meta charset=...> without quotes", (t) => {
	t.is(
		charsetFromHtml("<html><head><meta charset=utf-8></head></html>"),
		"utf-8"
	);
});

test("charsetFromHtml: handles case-insensitive charset attribute", (t) => {
	t.is(
		charsetFromHtml('<html><head><meta CHARSET="utf-8"></head></html>'),
		"utf-8"
	);
});

test("charsetFromHtml: handles case-insensitive meta tag", (t) => {
	t.is(
		charsetFromHtml('<html><head><META charset="utf-8"></head></html>'),
		"utf-8"
	);
});

test("charsetFromHtml: extracts charset from http-equiv meta tag", (t) => {
	t.is(
		charsetFromHtml(
			'<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head></html>'
		),
		"utf-8"
	);
});

test("charsetFromHtml: handles http-equiv with single quotes", (t) => {
	t.is(
		charsetFromHtml(
			"<html><head><meta http-equiv='Content-Type' content='text/html; charset=shift_jis'></head></html>"
		),
		"shift_jis"
	);
});

test("charsetFromHtml: handles http-equiv with reversed attribute order", (t) => {
	t.is(
		charsetFromHtml(
			'<html><head><meta content="text/html; charset=euc-jp" http-equiv="Content-Type"></head></html>'
		),
		"euc-jp"
	);
});

test("charsetFromHtml: handles iso-8859-1 in meta charset", (t) => {
	t.is(
		charsetFromHtml('<html><head><meta charset="iso-8859-1"></head></html>'),
		"iso-8859-1"
	);
});

test("charsetFromHtml: handles windows-1252 in meta charset", (t) => {
	t.is(
		charsetFromHtml('<html><head><meta charset="windows-1252"></head></html>'),
		"windows-1252"
	);
});

test("charsetFromHtml: handles shift_jis in meta charset", (t) => {
	t.is(
		charsetFromHtml('<html><head><meta charset="shift_jis"></head></html>'),
		"shift_jis"
	);
});

test("charsetFromHtml: handles extra spaces in meta tag", (t) => {
	t.is(
		charsetFromHtml(
			'<html><head><meta   charset = "utf-8" ></head></html>'
		),
		"utf-8"
	);
});

test("charsetFromHtml: only scans first 1024 bytes", (t) => {
	const padding = "x".repeat(1024);
	t.is(
		charsetFromHtml(padding + '<meta charset="shift_jis">'),
		null
	);
});

test("charsetFromHtml: finds charset within first 1024 bytes", (t) => {
	const padding = "x".repeat(900);
	t.is(
		charsetFromHtml(padding + '<meta charset="shift_jis">'),
		"shift_jis"
	);
});

test("charsetFromHtml: handles self-closing meta tag", (t) => {
	t.is(
		charsetFromHtml('<html><head><meta charset="utf-8" /></head></html>'),
		"utf-8"
	);
});

test("charsetFromHtml: handles meta tag with other attributes before charset", (t) => {
	t.is(
		charsetFromHtml(
			'<html><head><meta name="viewport" charset="utf-8"></head></html>'
		),
		"utf-8"
	);
});

test("charsetFromHtml: handles no html structure, just meta tag", (t) => {
	t.is(charsetFromHtml('<meta charset="utf-8">'), "utf-8");
});

test("charsetFromHtml: does not match charset in script or text content", (t) => {
	t.is(
		charsetFromHtml("<html><body>charset=shift_jis</body></html>"),
		null
	);
});

test("charsetFromHtml: handles doctype before meta", (t) => {
	t.is(
		charsetFromHtml(
			'<!DOCTYPE html><html><head><meta charset="utf-8"></head></html>'
		),
		"utf-8"
	);
});

// ─── sniffBOM ──────────────────────────────────────────────────────────

test("sniffBOM: detects UTF-8 BOM", (t) => {
	t.is(sniffBOM(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])), "UTF-8");
});

test("sniffBOM: detects UTF-16BE BOM", (t) => {
	t.is(sniffBOM(new Uint8Array([0xfe, 0xff, 0x00, 0x48])), "UTF-16BE");
});

test("sniffBOM: detects UTF-16LE BOM", (t) => {
	t.is(sniffBOM(new Uint8Array([0xff, 0xfe, 0x48, 0x00])), "UTF-16LE");
});

test("sniffBOM: returns null for no BOM", (t) => {
	t.is(sniffBOM(new Uint8Array([0x48, 0x69])), null);
});

test("sniffBOM: returns null for empty bytes", (t) => {
	t.is(sniffBOM(new Uint8Array([])), null);
});

test("sniffBOM: returns null for single byte", (t) => {
	t.is(sniffBOM(new Uint8Array([0xef])), null);
});

test("sniffBOM: partial UTF-8 BOM (2 bytes) returns null", (t) => {
	t.is(sniffBOM(new Uint8Array([0xef, 0xbb])), null);
});

test("sniffBOM: UTF-8 BOM with minimal content", (t) => {
	t.is(sniffBOM(new Uint8Array([0xef, 0xbb, 0xbf])), "UTF-8");
});

// ─── resolveEncoding ───────────────────────────────────────────────────

test("resolveEncoding: resolves utf-8", (t) => {
	t.is(resolveEncoding("utf-8"), "UTF-8");
});

test("resolveEncoding: resolves UTF-8 (case insensitive)", (t) => {
	t.is(resolveEncoding("UTF-8"), "UTF-8");
});

test("resolveEncoding: resolves utf8 (no hyphen)", (t) => {
	t.is(resolveEncoding("utf8"), "UTF-8");
});

test("resolveEncoding: resolves ascii to windows-1252 per WHATWG", (t) => {
	t.is(resolveEncoding("ascii"), "windows-1252");
});

test("resolveEncoding: resolves us-ascii to windows-1252 per WHATWG", (t) => {
	t.is(resolveEncoding("us-ascii"), "windows-1252");
});

test("resolveEncoding: resolves iso-8859-1 to windows-1252 per WHATWG", (t) => {
	t.is(resolveEncoding("iso-8859-1"), "windows-1252");
});

test("resolveEncoding: resolves latin1 to windows-1252 per WHATWG", (t) => {
	t.is(resolveEncoding("latin1"), "windows-1252");
});

test("resolveEncoding: resolves shift_jis to Shift_JIS", (t) => {
	t.is(resolveEncoding("shift_jis"), "Shift_JIS");
});

test("resolveEncoding: resolves sjis to Shift_JIS", (t) => {
	t.is(resolveEncoding("sjis"), "Shift_JIS");
});

test("resolveEncoding: resolves euc-jp to EUC-JP", (t) => {
	t.is(resolveEncoding("euc-jp"), "EUC-JP");
});

test("resolveEncoding: resolves windows-1252 to windows-1252", (t) => {
	t.is(resolveEncoding("windows-1252"), "windows-1252");
});

test("resolveEncoding: resolves gb2312 to GBK", (t) => {
	t.is(resolveEncoding("gb2312"), "GBK");
});

test("resolveEncoding: resolves big5 to Big5", (t) => {
	t.is(resolveEncoding("big5"), "Big5");
});

test("resolveEncoding: resolves euc-kr to EUC-KR", (t) => {
	t.is(resolveEncoding("euc-kr"), "EUC-KR");
});

test("resolveEncoding: resolves koi8-r to KOI8-R", (t) => {
	t.is(resolveEncoding("koi8-r"), "KOI8-R");
});

test("resolveEncoding: returns null for unknown encoding", (t) => {
	t.is(resolveEncoding("not-a-real-encoding"), null);
});

test("resolveEncoding: strips leading/trailing whitespace", (t) => {
	t.is(resolveEncoding("  utf-8  "), "UTF-8");
});

test("resolveEncoding: strips tabs and newlines", (t) => {
	t.is(resolveEncoding("\t\nutf-8\r\n"), "UTF-8");
});

test("resolveEncoding: resolves iso-8859-9 to windows-1254 per WHATWG", (t) => {
	t.is(resolveEncoding("iso-8859-9"), "windows-1254");
});

test("resolveEncoding: resolves tis-620 to windows-874", (t) => {
	t.is(resolveEncoding("tis-620"), "windows-874");
});

// ─── sniffEncoding ─────────────────────────────────────────────────────

test("sniffEncoding: BOM takes highest priority", (t) => {
	const bytes = new Uint8Array([
		0xef, 0xbb, 0xbf,
		// UTF-8 BOM followed by HTML with shift_jis meta
		...new TextEncoder().encode('<meta charset="shift_jis">')
	]);
	t.is(
		sniffEncoding(bytes, "text/html; charset=iso-8859-1", '<meta charset="shift_jis">'),
		"UTF-8"
	);
});

test("sniffEncoding: header charset takes priority over meta", (t) => {
	const html = '<meta charset="shift_jis">';
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html; charset=utf-8", html),
		"UTF-8"
	);
});

test("sniffEncoding: falls back to meta charset", (t) => {
	const html = '<meta charset="shift_jis">';
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html", html),
		"Shift_JIS"
	);
});

test("sniffEncoding: defaults to UTF-8", (t) => {
	const html = "<html><body>Hello</body></html>";
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html", html),
		"UTF-8"
	);
});

test("sniffEncoding: resolves iso-8859-1 header to windows-1252", (t) => {
	const html = "<html></html>";
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html; charset=iso-8859-1", html),
		"windows-1252"
	);
});

test("sniffEncoding: resolves ascii header to windows-1252", (t) => {
	const html = "<html></html>";
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html; charset=ascii", html),
		"windows-1252"
	);
});

test("sniffEncoding: resolves meta iso-8859-1 to windows-1252", (t) => {
	const html = '<meta charset="iso-8859-1">';
	const bytes = new TextEncoder().encode(html);
	t.is(
		sniffEncoding(bytes, "text/html", html),
		"windows-1252"
	);
});

test("sniffEncoding: UTF-16BE BOM overrides everything", (t) => {
	const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x3c]);
	t.is(
		sniffEncoding(bytes, "text/html; charset=utf-8", ""),
		"UTF-16BE"
	);
});

test("sniffEncoding: UTF-16LE BOM overrides everything", (t) => {
	const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
	t.is(
		sniffEncoding(bytes, "text/html; charset=utf-8", ""),
		"UTF-16LE"
	);
});

// ─── guessCharset (backwards-compatible wrapper) ───────────────────────

test("guessCharset: prefers Content-Type header over HTML meta tag", (t) => {
	t.is(
		guessCharset(
			"text/html; charset=iso-8859-1",
			'<html><head><meta charset="utf-8"></head></html>'
		),
		"windows-1252"
	);
});

test("guessCharset: falls back to HTML meta when header has no charset", (t) => {
	t.is(
		guessCharset(
			"text/html",
			'<html><head><meta charset="shift_jis"></head></html>'
		),
		"Shift_JIS"
	);
});

test("guessCharset: falls back to UTF-8 when neither source has charset", (t) => {
	t.is(
		guessCharset("text/html", "<html><head><title>Test</title></head></html>"),
		"UTF-8"
	);
});

test("guessCharset: falls back to UTF-8 with null header and no meta", (t) => {
	t.is(
		guessCharset(null, "<html><head><title>Test</title></head></html>"),
		"UTF-8"
	);
});

test("guessCharset: uses header charset even when html also has charset", (t) => {
	t.is(
		guessCharset(
			"text/html; charset=windows-1252",
			'<html><head><meta charset="utf-8"></head></html>'
		),
		"windows-1252"
	);
});

test("guessCharset: handles null header and html with http-equiv", (t) => {
	t.is(
		guessCharset(
			null,
			'<meta http-equiv="Content-Type" content="text/html; charset=euc-jp">'
		),
		"EUC-JP"
	);
});

test("guessCharset: defaults to UTF-8 for empty html and null header", (t) => {
	t.is(guessCharset(null, ""), "UTF-8");
});

test("guessCharset: defaults to UTF-8 for empty html and empty header", (t) => {
	t.is(guessCharset("", ""), "UTF-8");
});
