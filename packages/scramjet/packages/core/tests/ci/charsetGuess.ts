/**
 * @fileoverview
 * Tests for charset guessing from Content-Type headers and HTML meta tags.
 * Tests charsetFromHeaders, charsetFromHtml, and guessCharset functions.
 */

import test from "ava";
import {
	charsetFromHeaders,
	charsetFromHtml,
	guessCharset,
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
	// This should still match because it's within 1024 bytes and looks like a meta tag
	// but this test ensures we don't false-match plain text
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

// ─── guessCharset ──────────────────────────────────────────────────────

test("guessCharset: prefers Content-Type header over HTML meta tag", (t) => {
	t.is(
		guessCharset(
			"text/html; charset=iso-8859-1",
			'<html><head><meta charset="utf-8"></head></html>'
		),
		"iso-8859-1"
	);
});

test("guessCharset: falls back to HTML meta when header has no charset", (t) => {
	t.is(
		guessCharset(
			"text/html",
			'<html><head><meta charset="shift_jis"></head></html>'
		),
		"shift_jis"
	);
});

test("guessCharset: falls back to utf-8 when neither source has charset", (t) => {
	t.is(
		guessCharset("text/html", "<html><head><title>Test</title></head></html>"),
		"utf-8"
	);
});

test("guessCharset: falls back to utf-8 with null header and no meta", (t) => {
	t.is(
		guessCharset(null, "<html><head><title>Test</title></head></html>"),
		"utf-8"
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
		"euc-jp"
	);
});

test("guessCharset: defaults to utf-8 for empty html and null header", (t) => {
	t.is(guessCharset(null, ""), "utf-8");
});

test("guessCharset: defaults to utf-8 for empty html and empty header", (t) => {
	t.is(guessCharset("", ""), "utf-8");
});
