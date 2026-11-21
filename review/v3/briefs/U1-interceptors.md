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

# Your unit: U1-interceptors

Commits: 10ebe8e3 ("fix layered interceptors": +1089/-595 in `packages/scramjet/packages/core/src/client/client.ts`, plus `packages/inject/src/emulators/{alwaysLastBubble,history}.ts`, `packages/scramjet/packages/utils/src/alwaysLastBubble.ts`, test `runway/src/tests/client-layers.ts`) and d6c0de3a (build-time heritage rewrite `core/tools/intercept-heritage-loader.mjs` + `src/client/iface.ts`).

Background: the API is `client.Intercept(class extends X {...})`, `client.Proxy`, `client.RawProxy`, `client.Trap`, `client.RawTrap`, which install wrappers over native members. Embedders (browser.js's `packages/inject`, scramjet `utils`) layer their own emulators on top of core's. An earlier review found that #102 made core refuse to patch a member twice, which silently disabled the embedder's emulators (history, window.open, addEventListener), and that `RawProxy(instance, key)` patched the shared prototype. 10ebe8e3 is the fix. Already verified fixed by test (don't re-report unless you find a remaining case): child realms hooked from a parent losing modules to same-named parent globals (prior #4).

Focus on:

- Layering semantics: core-then-embedder and embedder-then-core install orders; uninstall/unpatch; what each layer's "native"/next call reaches; `this`/receiver and `new.target` through layers; getters/setters vs methods vs constructors; static members.
- RawProxy on an instance: does it now patch only that instance (own property), and is that own property visible to the page (`Object.getOwnPropertyNames(event)`, `hasOwnProperty`)? Any leak of internals via property enumeration, `Function.prototype.toString`, `.name`/`.length`, or stack traces?
- Re-entrancy: a layer that calls the same member again (e.g. addEventListener inside an addEventListener wrapper), and recursion through the incumbency machinery.
- Per-call cost on hot paths (addEventListener, removeEventListener, dispatch-related members, `Event.prototype.*` getters, fetch, setTimeout, element attribute setters): did the layering add allocation or lookups per call?
- Realm correctness: a wrapper installed by one realm's client onto another realm's prototype (parent hooking an about:blank child); does each layer resolve natives from the right realm?
- The inject emulators changed in the same commit (`alwaysLastBubble`, `history`): any behavioural change for browser.js users (address bar following SPA navigation, link/contextmenu handling order).
- The heritage loader: confirm it's wired into every bundle variant after 41a37557 changed rspack.config.ts (`packages/scramjet/rspack.config.ts`). A heritage that's a local binding (`const { WebSocket } = self` in `client/shared/requests/WebSocket.ts`, `WebSocketStream.ts`) is deliberately left alone. Is that safe if the page replaced `self.WebSocket` before the hook ran?
