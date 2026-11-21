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

# Your unit: U3-rewriter-asi

Commits: fb97bd59 ("fix asi clobbering with location rewrite"), 0bab40f9 ("fix another asi regression"), e3c4d13f ("rewriter: add dump command to native cli"). Also review every other change to the JS rewriter between upstream/main and HEAD: `git diff upstream/main HEAD:packages/scramjet -- packages/core/rewriter` (upstream paths lack the `packages/scramjet/` prefix) and `packages/core/src/shared/rewriters/js.ts`.

The JS rewriter (Rust, oxc) rewrites `location`, `eval`, `import()`, `postMessage`, `top`, etc., and adds preludes (sourcemap, incumbency `$scramjet$registerrealm`). Focus on:

- ASI hazards: every place an insertion (wrapping an identifier, a prepended call or prelude) can change how the program parses. Lines starting with `(`, `[`, `` ` ``, `+`, `-`, `/`; restricted productions (return/throw/yield/await/break/continue + newline); arrow bodies; class fields without semicolons; `let` as an identifier; comments between tokens; HTML-like comments (`<!--`, `-->` at line start); hashbangs; directive prologues (anything inserted before `"use strict"` breaks strict mode).
- Are the two fixes complete, or do they only cover the reported shape? Enumerate the code paths that emit insertions and check each.
- Regressions vs upstream: input upstream rewrote correctly that HEAD mis-rewrites (syntax error, different semantics, or an unrewritten `location`/`eval` = escape).
- The bar is a regression vs upstream with a plausible real-world pattern (minified bundles, common frameworks). Don't report contrived inputs as high impact; say plainly if there's nothing.
  You may read the native rewriter tests (`packages/core/rewriter/native`). Don't run cargo.
