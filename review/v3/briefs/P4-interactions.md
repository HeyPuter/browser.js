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

# Your unit: P4-interactions

Not one commit: the **interactions between subsystems** that v3 reworked separately. Each was reviewed on its own (see `review/v3/findings.md` and `review/v3/codex/*.md`; don't re-report what's there or on Linear SCR-5..SCR-41). Look for failures that only appear when two of these meet:

- incumbency (`shared/incumbency.ts`, pst/stamp/lazystamp) × event dispatch (`client/shared/event.ts`, #140) × postMessage origin/source attribution
- referrer/Origin computation (`fetch/headers.ts`, #135/#130) × frame names/targets (#145) × history/hash URL handling (`dom/history.ts`, `rewriters/url.ts` `rewriteHistoryUrl`/`sameDocumentUrl`, #139)
- the element/attribute layer (#112: mirrors `scramjet-attr-*`, `client/attributes.ts`, `dom/css.ts`) × the HTML rewriter/serializer (`shared/htmlparser/*`, `rewriters/html.ts`) × Trusted Types/CSP (#130)
- the interceptor layering machinery (`client.ts` slots, Intercept/Proxy/Trap) × child realms hooked by a parent (about:blank, srcdoc, popups) × the SingletonBox (`client/singletonbox.ts`)
- the service-worker side (`controller/src/sw.ts`, `fetch/*`) × the client's URL stamping (`$top`, `$io`, `$iframe`, module flags): is the same resource always the same proxied URL across these paths?

Prefer concrete, end-to-end failure scenarios on real-world page patterns (SPAs, embeds, OAuth popups, editors, ad iframes). Bar: a regression vs upstream with a plausible real-world pattern. Contrived interactions aren't worth reporting. Say plainly if you find nothing.
