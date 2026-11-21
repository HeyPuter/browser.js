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

# Your unit: U9-turnstile-130

Commit: f3c16041 ("[TURNSTILE] [core] request headers, referrer, CSP meta, Trusted Types and hasFocus fidelity (#130)"). It lands right after 16659a94 (referer, #135) and dd4878e6 (events, #140); look at how it interacts with them. Read the full commit message (it's long and explains every change), then check each claim against the code.

These are anti-bot fidelity fixes (Cloudflare Turnstile and similar). Each change trades risk of breaking real sites against fingerprint fidelity. Focus on:

- Request headers: which are added, removed or changed on proxied requests (Sec-Fetch-_, Sec-CH-UA_ incl. the high-entropy hints from Accept-CH and the Critical-CH re-issue, Accept, Accept-Language, Origin, Referer, Upgrade-Insecure-Requests, Priority, header order)? For each, does it match Chrome for that request type, and could it break a site? Examples: CORS preflights the upstream rejects, Origin mismatches failing CSRF checks, wrong Accept changing content negotiation, a Critical-CH re-issue that loops or double-submits a POST, Accept-CH state that leaks between sites or never expires.
- CSP meta: what HEAD does with `<meta http-equiv=Content-Security-Policy>`, parsed and script-inserted. Could a CSP now block scramjet's own injected scripts or rewritten URLs, or fail to block what the page expects? Known, don't re-report: SCR-22 (a script-built CSP meta can still be enforced by the browser against proxy URLs), SCR-15 (iframe sandbox/CSP emulation).
- Trusted Types: pages enforcing `require-trusted-types-for 'script'`. Does scramjet's own sink use (innerHTML rewriting, eval wrapping, script src setting) still work under enforcement, and do page policies still apply? Any TypeError on YouTube/Gmail-like pages?
- document.hasFocus() and focus/blur in the emulated top frame.
- Anything added only for a contrived anti-bot check that now runs on a hot path for every site (every request, every document).
- Already found by the U6 review, don't re-report: Origin on same-origin fetch/XHR GETs, Origin after CORS redirects (should be "null"), Origin on no-referrer form POSTs.
