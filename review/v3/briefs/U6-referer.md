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

# Your unit: U6-referer

Commit: 16659a94 ("much better referer handling (#135)"). Then read how f3c16041 (#130, TURNSTILE: request headers, referrer, CSP meta...) changed the same code afterwards, because the interaction matters. Main files at HEAD: `packages/scramjet/packages/core/src/fetch/{headers,util,parse,index,fetch}.ts`, `src/client/shared/requests/fetch.ts`, `src/client/webidl.ts`, `src/client/dom/document.ts`, `src/shared/rewriters/url.ts`, plus the rewriter flag in `core/rewriter/*/src`.

Referer correctness affects logins, CSRF checks, hotlink protection, analytics and fingerprinting. Focus on:

- For each request kind (navigations top/iframe/popup, form POST, fetch/XHR, subresources img/script/css/font, CSS-initiated url()/@import, workers, importScripts, module imports, WebSocket, EventSource, sendBeacon, prefetch/preload, redirects), does the upstream server see the Referer **and Origin** Chrome would send? Apply referrerPolicy (header, meta, attribute, fetch init), the default strict-origin-when-cross-origin, downgrade rules, and no-referrer / rel=noreferrer.
- `document.referrer`, including after redirects, for about:blank/srcdoc children, and after pushState.
- Where the referrer comes from: browser-reported info (request.referrer / client) vs page-provided state (stamped query params like `$io`, `$rff`, `$ro`). Can a page spoof it, or can it get stale (pushState, bfcache, SW revival)?
- Leaks of the proxy origin as Referer/Origin to the upstream site, or sending nothing where Chrome sends something.
- Proxied URL stability: #135 changed what's stamped on module/worker URLs. Does any resource now get different URLs in different contexts (double module execution, cache misses, import-map mismatch)?
- The client-side `RequestInit` conversion rewrite in fetch.ts/webidl.ts: anything that now throws, hangs or behaves differently from Chrome for ordinary inputs (Request objects, Headers objects, FormData/Blob/stream bodies, `signal`, `keepalive`, `duplex`, `priority`, cloned Requests, subclassed Request).

Already known (don't re-report): SCR-19 (location.reload() repeats the loader's Sec-Fetch-Site), SCR-20 (reload after pushState sends the pre-push URL as Referer), SCR-27 (long page URLs give an origin-only Referer when the proxied URL passes 4096 bytes). The runway test `referrer-init-new-target-after-conversion` fails; explain it if you get to it.
