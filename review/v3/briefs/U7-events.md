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

# Your unit: U7-events

Commit: dd4878e6 ("Rework event interception (#140)"). Also read the earlier event rewrite 87697d64 (#103) for context. An earlier review covered that one (review/1-regressions.md; search for "event" and "stand-in"), so focus on what #140 changed. Main file: `packages/scramjet/packages/core/src/client/shared/event.ts` and whatever #140 touched.

Events carry proxied information (MessageEvent.origin/source/data, HashChangeEvent.oldURL/newURL, PopStateEvent.state, StorageEvent.url, SecurityPolicyViolationEvent.blockedURI/documentURI, ErrorEvent.filename, PageTransitionEvent, NavigateEvent, beforeunload, and more). Focus on:

- Every event type upstream handled: is it still handled at HEAD? List any dropped.
- Listener identity: removeEventListener with the same function, the same listener added twice, `once`, `signal` (AbortSignal), `handleEvent` objects, `on*` property handlers vs attributes, capture-flag matching.
- Event object identity and fidelity: `e instanceof MessageEvent`, `isTrusted`, `target`/`currentTarget`, `composedPath()`, `stopImmediatePropagation` across wrapped and unwrapped listeners, and the same event being one object for every listener.
- Listener ordering vs Chrome, especially when scramjet-internal listeners mix with page listeners.
- Per-dispatch cost on hot paths (mousemove, scroll, pointer, rAF-heavy pages). Is work done for events that need no translation?
- Synthetic events (`dispatchEvent(new MessageEvent(...))`) must not be translated twice or treated as proxy-internal.
- Worker/SharedWorker message events, BroadcastChannel, MessagePort.
- Already known, don't re-report: SCR-5 (event wrapper gap with descriptors), SCR-16 (inline handler attributes bypass the interceptor), SCR-29 (non-callable handleEvent reported early).
