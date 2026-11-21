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

# Your unit: U5-controller-sw

Commits: 5d09a91e ("fix legacy broken sw revival behavior"), 01ab48d0 ("[controller] fix broken sw revival behavior"), c76f6324 ("[controller] fix service worker revival issues with cache storage", the newest, by percs), dac63876 ("fix throw when injecting into already loaded client"), plus every other change to `packages/scramjet/packages/controller/**` between upstream/main and HEAD (`git diff upstream/main HEAD:packages/scramjet -- packages/controller`; upstream paths lack the `packages/scramjet/` prefix).

The controller runs the service worker that intercepts proxied requests and injects the client into frames. Browsers kill idle service workers. On revival, in-memory state (transport, config, tab registry, cookies, client-hint grants) is gone. Focus on:

- After the SW is killed and revived: do in-flight and new requests from already-open pages still work? Which state is lost? Any request that hangs forever, falls back to the network unproxied (an escape and IP leak), or is sent twice?
- Races between the first fetch after revival and re-initialisation (message ports, Cache Storage / IndexedDB reads, the transport handshake). c76f6324 adds Cache Storage persistence: what's stored, is it ever stale or cross-tab-contaminated, does it grow without bound, and what happens when storage is unavailable (private mode, quota)?
- Multiple tabs and multiple controller instances, and SW updates (skipWaiting/clients.claim) with an old page still open.
- Injecting into frames that aren't controlled yet (about:blank, srcdoc, javascript: URLs, sandboxed frames without allow-same-origin).
- Public API changes in the controller vs upstream that would break embedders (exports, config shape, method names, events). Upstream's newest controller work (45fb6c68, version compatibility) isn't in ours yet; note what porting it involves.
- Already decided, don't re-report: the SW buffers request bodies with `arrayBuffer()` on purpose (Content-Length fidelity). Known: SCR-31 item 3 (a lost controller gives a synthetic 503).
