/**
 * @fileoverview
 * Runway tests for charset guessing.
 * Run directly with: node --experimental-strip-types tests/runway/charsetGuess.ts
 */

import {
	charsetFromHeaders,
	charsetFromHtml,
	guessCharset,
} from "../../src/fetch/charsetGuess.ts";

let passed = 0;
let failed = 0;

function assert(actual, expected, label) {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		console.error(`  FAIL: ${label}`);
		console.error(`    expected: ${JSON.stringify(expected)}`);
		console.error(`    actual:   ${JSON.stringify(actual)}`);
	}
}

// ─── charsetFromHeaders ────────────────────────────────────────────────

console.log("charsetFromHeaders:");

assert(charsetFromHeaders(null), null, "null input");
assert(charsetFromHeaders(""), null, "empty string");
assert(charsetFromHeaders("text/html"), null, "no charset param");
assert(charsetFromHeaders("text/html; charset=utf-8"), "utf-8", "standard");
assert(charsetFromHeaders("text/html;charset=utf-8"), "utf-8", "no space after semicolon");
assert(charsetFromHeaders('text/html; charset="utf-8"'), "utf-8", "double quotes");
assert(charsetFromHeaders("text/html; charset='utf-8'"), "utf-8", "single quotes");
assert(charsetFromHeaders("text/html; charset=UTF-8"), "UTF-8", "uppercase value");
assert(
	charsetFromHeaders("text/html; charset=utf-8; boundary=something"),
	"utf-8",
	"extra params after charset"
);
assert(charsetFromHeaders("text/html; charset=shift_jis"), "shift_jis", "shift_jis");
assert(charsetFromHeaders("text/html; charset=iso-8859-1"), "iso-8859-1", "iso-8859-1");
assert(charsetFromHeaders("text/html; charset=windows-1252"), "windows-1252", "windows-1252");
assert(charsetFromHeaders("text/html; charset=euc-jp"), "euc-jp", "euc-jp");
assert(
	charsetFromHeaders('text/html; charset="iso-8859-1"; boundary=foo'),
	"iso-8859-1",
	"quoted charset with trailing params"
);
assert(charsetFromHeaders("text/html; charset= utf-8 "), "utf-8", "extra whitespace around value");
assert(charsetFromHeaders("text/html; charset="), null, "empty charset value");
assert(
	charsetFromHeaders("application/json; charset=utf-8"),
	"utf-8",
	"non-html content type"
);
assert(
	charsetFromHeaders("text/html; charset=big5"),
	"big5",
	"big5 charset"
);
assert(
	charsetFromHeaders("text/html; charset=gb2312"),
	"gb2312",
	"gb2312 charset"
);
assert(
	charsetFromHeaders("text/html; charset=koi8-r"),
	"koi8-r",
	"koi8-r charset"
);

// ─── charsetFromHtml ───────────────────────────────────────────────────

console.log("charsetFromHtml:");

assert(charsetFromHtml(""), null, "empty string");
assert(
	charsetFromHtml("<html><head><title>Test</title></head></html>"),
	null,
	"no charset declaration"
);
assert(
	charsetFromHtml('<html><head><meta charset="utf-8"></head></html>'),
	"utf-8",
	'meta charset="utf-8"'
);
assert(
	charsetFromHtml("<html><head><meta charset='utf-8'></head></html>"),
	"utf-8",
	"meta charset='utf-8'"
);
assert(
	charsetFromHtml("<html><head><meta charset=utf-8></head></html>"),
	"utf-8",
	"meta charset=utf-8 (no quotes)"
);
assert(
	charsetFromHtml('<html><head><meta CHARSET="utf-8"></head></html>'),
	"utf-8",
	"case-insensitive charset attribute"
);
assert(
	charsetFromHtml('<html><head><META charset="utf-8"></head></html>'),
	"utf-8",
	"case-insensitive meta tag"
);
assert(
	charsetFromHtml(
		'<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head></html>'
	),
	"utf-8",
	"http-equiv Content-Type"
);
assert(
	charsetFromHtml(
		"<html><head><meta http-equiv='Content-Type' content='text/html; charset=shift_jis'></head></html>"
	),
	"shift_jis",
	"http-equiv with single quotes"
);
assert(
	charsetFromHtml(
		'<html><head><meta content="text/html; charset=euc-jp" http-equiv="Content-Type"></head></html>'
	),
	"euc-jp",
	"http-equiv with reversed attribute order"
);
assert(
	charsetFromHtml('<html><head><meta charset="iso-8859-1"></head></html>'),
	"iso-8859-1",
	"iso-8859-1 in meta charset"
);
assert(
	charsetFromHtml('<html><head><meta charset="windows-1252"></head></html>'),
	"windows-1252",
	"windows-1252 in meta charset"
);
assert(
	charsetFromHtml('<html><head><meta charset="shift_jis"></head></html>'),
	"shift_jis",
	"shift_jis in meta charset"
);
assert(
	charsetFromHtml('<html><head><meta   charset = "utf-8" ></head></html>'),
	"utf-8",
	"extra spaces in meta tag"
);

// Edge case: charset declaration beyond first 1024 bytes should be ignored
const padding1024 = "x".repeat(1024);
assert(
	charsetFromHtml(padding1024 + '<meta charset="shift_jis">'),
	null,
	"charset beyond 1024 bytes"
);

// Edge case: charset declaration within first 1024 bytes
const padding900 = "x".repeat(900);
assert(
	charsetFromHtml(padding900 + '<meta charset="shift_jis">'),
	"shift_jis",
	"charset within 1024 bytes"
);

assert(
	charsetFromHtml('<html><head><meta charset="utf-8" /></head></html>'),
	"utf-8",
	"self-closing meta tag"
);
assert(
	charsetFromHtml(
		'<html><head><meta name="viewport" charset="utf-8"></head></html>'
	),
	"utf-8",
	"meta tag with other attributes before charset"
);
assert(charsetFromHtml('<meta charset="utf-8">'), "utf-8", "bare meta tag, no html wrapper");
assert(
	charsetFromHtml("<html><body>charset=shift_jis</body></html>"),
	null,
	"charset in text content (not a meta tag)"
);
assert(
	charsetFromHtml(
		'<!DOCTYPE html><html><head><meta charset="utf-8"></head></html>'
	),
	"utf-8",
	"doctype before meta"
);
assert(
	charsetFromHtml('<meta charset="gb2312">'),
	"gb2312",
	"gb2312 in meta charset"
);
assert(
	charsetFromHtml('<meta charset="big5">'),
	"big5",
	"big5 in meta charset"
);
assert(
	charsetFromHtml('<meta charset="koi8-r">'),
	"koi8-r",
	"koi8-r in meta charset"
);
assert(
	charsetFromHtml('<meta charset="euc-kr">'),
	"euc-kr",
	"euc-kr in meta charset"
);

// ─── guessCharset ──────────────────────────────────────────────────────

console.log("guessCharset:");

assert(
	guessCharset(
		"text/html; charset=iso-8859-1",
		'<html><head><meta charset="utf-8"></head></html>'
	),
	"iso-8859-1",
	"header takes priority over html meta"
);
assert(
	guessCharset("text/html", '<html><head><meta charset="shift_jis"></head></html>'),
	"shift_jis",
	"falls back to html meta when header has no charset"
);
assert(
	guessCharset("text/html", "<html><head><title>Test</title></head></html>"),
	"utf-8",
	"falls back to utf-8 when neither source has charset"
);
assert(
	guessCharset(null, "<html><head><title>Test</title></head></html>"),
	"utf-8",
	"null header, no html charset -> utf-8"
);
assert(
	guessCharset(
		"text/html; charset=windows-1252",
		'<html><head><meta charset="utf-8"></head></html>'
	),
	"windows-1252",
	"header charset wins over html charset"
);
assert(
	guessCharset(
		null,
		'<meta http-equiv="Content-Type" content="text/html; charset=euc-jp">'
	),
	"euc-jp",
	"null header, html http-equiv charset"
);
assert(guessCharset(null, ""), "utf-8", "null header, empty html -> utf-8");
assert(guessCharset("", ""), "utf-8", "empty header, empty html -> utf-8");

// ─── Summary ───────────────────────────────────────────────────────────

console.log();
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
	process.exit(1);
}
