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

# Your unit: U8-framenames

Commit: f9d3a88d ("frame names and navigation targets (smaller #137) (#145)"). Files: `core/src/client/framename.ts`, `client/targets.ts`, `client/dom/name.ts`, `shared/targets.ts`, and related ones.

Design decisions already made by the author. Don't report these:

- The emulated top frame gets a random per-tab real `window.name`.
- `window.name` is cleared on cross-origin top-level navigation, following the spec (Chrome doesn't clear).
- The SW writes `_top`/`_parent` as `_self` in nested documents and the client corrects them after parse with a MutationObserver.
- Subframe and popup real names equal the page's names, because named access (`window.foo`) depends on it.
- `top`/`parent` aren't emulated for the top frame (a known gap).

Focus on:

- Link/form/area `target` and `window.open(url, name)`: `_blank`, `_self`, `_parent`, `_top`, named frames, `noopener`/`noreferrer`, `<base target>`, and form `formtarget`. Do they navigate the frame Chrome would, without escaping the proxy UI (a real top-level navigation to a raw proxy URL, or leaving the emulated top)?
- Reading back `window.name`, `iframe.name`, the `name` attribute vs property, and `getAttribute('target')`.
- Anything upstream did that's now broken: `target=_top` from a nested iframe replacing the emulated top document, a popup opened by name then reused by name, OAuth/payment popups.
- Cost: is a MutationObserver attached to every document? What does it cost on DOM-heavy pages?
- Bar: a regression vs upstream with a plausible real-world pattern, and no core-API bloat for edge cases. Say plainly if there's nothing.
  Tests: `runway/src/tests/adversarial/frame-names.ts`.
