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

# Your unit: U2-top-siteflags-hash

Commits: 5268e0d1 ("do not cache topurl, add bust to flagcache"), b23f6355 ("replace siteFlags regex with dumb hostname matcher"), 57f3f2fa ("move siteFlags to controller and make them weaker"), 3bcc37ba ("several fixes related to hash urls (#139)").

Context: an earlier review found that popups cached topUrl as about:blank and that `$top` went stale across pushState and hash navigation (reload double-loading, anchors reloading, hash traversal, self-navigation). Those prior repros now pass. Focus on what these commits might have broken or left half-done:

- Proxied URL stability: does the same resource still get the same proxied URL in every context (who loaded it, when, before/after pushState or a hash change, from a popup or iframe)? Unstable URLs cause double module execution and cache misses.
- Hash navigation: fragment-only changes must never reload. `hashchange`/`popstate` must fire like Chrome. `location.hash`, `document.URL` and `:target` must be right, and same-document `#` links must not reload.
- siteFlags: semantic changes vs upstream (regex → hostname matcher, moved to the controller, "weaker"). Is this an API break for embedders who configured siteFlags with regexes in v2? Do flags apply to subframes, workers and popups?
- Keep it practical: the bar is a regression vs upstream with a plausible real-world pattern. Don't report contrived cases, and say plainly if there's nothing.
  Already known (skip): SCR-19, SCR-20 (reload/pushState Referer, Sec-Fetch-Site); the `fragment-nav-*` tests flake under parallel load.
