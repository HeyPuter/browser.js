# Common brief for v3 per-commit reviewers

You are reviewing part of scramjet (a web proxy that rewrites JS/HTML/CSS and intercepts browser APIs so a site can't tell it's proxied) for **regressions** before the v3 release.

- Repo: /home/velzie/src/browser.js. Scramjet lives at `packages/scramjet/` (core: `packages/core/src`, controller: `packages/controller/src`).
- Baseline: `upstream/main` (MercuryWorkshop/scramjet main; scramjet at the repo root, so paths lack the `packages/scramjet/` prefix). Read its version with `git show upstream/main:packages/core/src/<file>`.
- Our main: `HEAD`. Your unit is the listed commit(s). Read the full diff (`git show <sha>`), then the surrounding code at HEAD, since later commits may have changed it. Note when a later commit already fixes or changes something.
- **The goal is behaving like Chrome**, not following the spec. Where they disagree, Chrome wins.
- A finding matters most if it is a **regression**: it worked on upstream main and is broken at HEAD. Also report bugs in new code even if there's no baseline equivalent (label those NEW-BUG), and pre-existing issues the commit touched but didn't fix (PRE-EXISTING, briefly).
- Weigh real-site impact. Sending a bit more than Chrome usually goes unnoticed; sending less, or something wrong, breaks logins and forms. Errors on hot paths (every page, every request) matter more than contrived cases. Mark contrived cases as such.
- Also look at: complexity that exists only for a contrived case; proxied URLs that vary by context (same resource → different URL means double loads); trusting page-provided info over browser-provided info; leaks of the real proxy URL/origin to the page; escapes (a request or navigation that bypasses the proxy).
- **Do not run runway, builds, or browsers.** This is a reading review. Others are using the CPU for baselines.
- **Say plainly when you find nothing.** Don't pad. Ten real findings beat thirty speculative ones.

## Output

Your sandbox is read-only. Put all findings in your FINAL message, in this format, one block per finding:

```
### <unit>-<n>. <one-line claim>
Kind: REGRESSION | NEW-BUG | PRE-EXISTING | DESIGN-CONCERN   Confidence: high|medium|low   Impact: site-breaking|visible|fingerprint|contrived
Where: file:line (HEAD) [and upstream file:line if regression]
Mechanism: what the code does wrong, concretely.
Failure scenario: concrete page/input → wrong output, vs what Chrome does.
Repro sketch: a minimal page/script runway could use (serverTest / playwrightTest in packages/scramjet/packages/runway/src/testcommon.ts; look at existing tests for the style), and what to assert.
```

Finish with a "Checked and fine" list: the things you examined that look correct, so the next reviewer doesn't redo them.

# Your unit: U10-turnstile-132

Commit: f914b6a4 ("[TURNSTILE] [core][controller] small fingerprint fixes: doctype, network errors, shim globals, frame ids (#132)"). Also 5f8a6135 ("hand out client ids from the box, not Math.random (#131)") for the frame-id context. Read the full commit messages first.

Focus on:

- Doctype: what changes in the served (rewritten) HTML's doctype and quirks mode? Can any page flip between standards and quirks mode compared with Chrome loading it directly? That breaks layout on every page it hits. Check: no doctype, a BOM, leading comments or whitespace, uppercase/legacy doctypes (HTML 4.01 transitional with and without a system id, which select limited-quirks vs quirks), XHTML served as application/xhtml+xml, and documents served as text/plain or image/svg+xml. Also `document.doctype`, `document.compatMode`, and `document.documentElement.outerHTML` readback.
- Network errors: how do fetch/XHR/navigation failures surface now (TypeError message, XHR status 0 + error event, an error page for navigations)? Do they match Chrome? Could a real upstream 4xx/5xx now become a network error, or a network error become a 200 page the site parses as success? What do iframes and top-level navigations show?
- Shim globals: which globals were added, removed or hidden? Could a page's feature detection (`'X' in window`, `typeof X`) now take a different path than in Chrome? Does any global leak scramjet's presence via `Object.keys(window)`, for-in, `getOwnPropertyNames`, property order, or Error stacks?
- Frame ids: uniqueness across tabs and frames, persistence across reloads/bfcache, collisions, and whether ids leak to the page.
- The controller-side changes in this commit.
- Anything added only for a contrived anti-bot check that now runs on a hot path for every site.
