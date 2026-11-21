# v3 review findings

Verdicts: **REGRESSION** (worked on upstream main, broken on ours) · **PRE-EXISTING** · **NOT REAL** · **INFRA** (tooling/CI, not product behaviour).
Linear: novel non-regressions go to SCR with label `v3-review`.

## INFRA

### I1. CI on browser.js main never runs the tests (fixed in e442b7eb→pushed as part of 6725a7bf; verify CI)

Every main CI run since the cv switch fails in "Validate Package Structure": the job extracts the packed core tarball over `packages/scramjet/packages/core` (pnpm pack rewrites `catalog:` versions in package.json), then `./cv validate` runs its install check, i.e. `pnpm install --frozen-lockfile` → `ERR_PNPM_OUTDATED_LOCKFILE`. The tests and rewriter jobs are then skipped. Upstream ran `pnpm test:package`, with no install.
Fix: `./cv validate --no-install` (deps are already installed by the job).

### I2. Runway discovery crashed on any machine but the old reviewer's

`src/tests/review/a7/media{,2}.ts` read fixtures from `/home/velzie/.cache/sjreview/...` at import, so the whole suite died with ENOENT on discovery (CI would hit it once I1 is fixed). About 20 files under `tests/review/` hardcode that dir; most only write sweep output at runtime.
Fix (user decision 2026-11-20): `tests/review/` is opt-in (`RUNWAY_REVIEW=1`). Fixture reads in a7/media* tolerate a missing fixture.

### I3. Both committed failing lists were wrong

See PLAN "Baseline notes". Regenerated from 3 runs each.

### I4. Upstream `e99d5953` (release tag prefix) is not in our `packages/scramjet/.github/workflows/main.yml`

That copy is dead inside browser.js but becomes upstream's CI when v3 is pushed. Port it in P5.

### I5. up's `wpt/referrer.ts` depends on browser.js's `external/playwright` cert

Standalone scramjet can't run the `*-fetch-http-html` referrer WPT tests (ENOENT). Check whether ours still has this in P5.

## P3: suite diff (our runway on up build vs head build)

Our 2509 tests run on the up build (1 run) vs head (3 runs): **31 pass on up and fail on head in all runs**; reproduced alone on both builds (`~/.cache/sjreview-v3/logs/p3-cand-{up,head}.log`). 784 tests fail on up and pass on head. upstream's own 807 tests: none pass on up and fail on head; the 7 `referer-*` tests #135 deleted pass on head (except one that fails on up too).

| #    | tests                                                                                                                                                                                                      | verdict                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| P3-1 | `fragment-base-ignores-template` (+ `-svg`, `-math`, which fail on both)                                                                                                                                   | REGRESSION (template only; upstream passed by accident with last-wins). **FIXED** 74cd0192 (pushed in 6725a7bf's series). |
| P3-2 | 12× `elshape-members-*` `order:` labels                                                                                                                                                                    | known: prior #68. Filed **SCR-26**.                                                                                       |
| P3-3 | `elattr-onclick-attribute-behaviour`, `incumbency-regression-pst-inline-handler-source`, `eltext-mutations-{data,append-string,connected-empty-append,normalize,removechild,splittext,style}`              | known: prior #57/#65. Filed **SCR-24**.                                                                                   |
| P3-4 | `eltext-range-tostring`, `eltext-exec-movebefore`, `eltext-exec-currentscript-two-parts`, `eltext-script-rendered-innertext`, `elshape-innertext-outertext`, `events-handleevent-not-callable-is-reported` | known: prior #58. Filed **SCR-25** (+ handleEvent: **SCR-29**).                                                           |
| P3-5 | `incumbency-regression-{stamp,lazystamp}-htmldda-is-not-nullish`                                                                                                                                           | non-default incumbency modes only. Filed **SCR-28**.                                                                      |
| P3-6 | `referrer-long-document-url`, `referrer-init-new-target-after-conversion`                                                                                                                                  | long-document: REGRESSION, user chose to leave it: **SCR-27**. new-target-after-conversion: TODO with U6.                 |

The P3-2..4 items were judged low-impact/contrived by the prior review and left open. They're fingerprint surfaces (`$scramjet$registerrealm` visible in `onclick.toString()` and MutationObserver `oldValue`) that an anti-bot script could read. User (2026-11-21): fix only trivial ones, file the rest. None was trivial; all filed.

### I6. CI's prebuilt jobs couldn't start (fixed 9090baae)

With I1 fixed, "Run Scramjet Tests" and "Build Frontend" died in cv: `CV_PREBUILT=core` still required every declared output of core's tasks, incl. `core:wasm`'s `rewriter/wasm/out/wasm.js`, which isn't in the downloaded dist artifact. Prebuilt now warns on a missing output.

### I7. Formatter drift on main

The pre-commit hook (`./cv format`) formats the whole repo; 7 files on main are unformatted (`packages/scramjet/.github/ISSUE_TEMPLATE/*`, `controller/src/inject.ts`, `demo/src/pages/{BrowserView,Playground}.tsx`, `demo/vite.config.ts`, `utils/src/http-cache-plugin.ts`), so every commit reformats them in the worktree. I revert them each time. A one-off format commit would end it (ask).

### I8. `urlfidelity-empty-query` fails only in CI (SCR-23)

Pre-existing (upstream's old list had it). Listed as an expected failure in both lists.

### I9. Upstream moved during the review

New on MercuryWorkshop/scramjet main: `f6a1ed73` (already in ours as dac63876), `45fb6c68` **version compatibility (#241), not in ours: port in P5**, `2b2adc6e` 2.x version bumps (superseded). Pushed upstream's corrected failing list as `32ffe62c`.

## P2 per-commit review

### U4 integrity / Link header (556a1397, 4e3e8299): subagent review, verified by me

- U4-1 Link-header `imagesrcset` preload bypasses the proxy: **upstream bug, NOT REAL on v3** (header-only repro: up sends `/srcset.png` straight to the site, head doesn't). Guard test `linkheader-imagesrcset-preload-is-proxied`.
- U4-2 Link-header `modulepreload` without `isModule` → module fetched twice: **PRE-EXISTING, FIXED** dbbf6139 (`linkheader-modulepreload-fetched-once`).
- U4-3 (fetch-preload integrity kept "to avoid a double fetch" doesn't avoid it): design note, harmless. Not filed.
- U4-4 SRI not enforced on rewritten bodies: unchanged from upstream; only matters for deliberately wrong digests. Not filed (contrived).

### U6 referer #135 (16659a94): codex (`codex/U6-referer.md`), verified by me

| id   | claim                                                                  | verdict                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U6-1 | prefix import map + static & dynamic import → module runs twice        | **PRE-EXISTING** (head and up `runs=2`, bare 1). Repro `review/v3/importmap.ts` (`v3-importmap-prefix-static-and-dynamic`). Site-breaking for registry-style modules → **fix queue**. |
| U6-2 | CDN module deps under `Referrer-Policy: origin` get the page's Referer | PRE-EXISTING (`referrer-module-import-map-cross-origin` fails on up too)                                                                                                              |
| U6-3 | Origin after CORS redirect chain should be `null`                      | PRE-EXISTING (`referrer-cors-redirect-*tainted-origin` fail on up)                                                                                                                    |
| U6-4 | form POST under no-referrer sends real Origin (Chrome: `null`)         | PRE-EXISTING (`referrer-post-navigation-no-referrer-origin-null`)                                                                                                                     |
| U6-5 | Origin on same-origin fetch/XHR GET                                    | PRE-EXISTING (`referrer-origin-header-by-request-kind`)                                                                                                                               |
| U6-6 | dynamic import loses script element's referrerpolicy                   | PRE-EXISTING (`referrer-module-no-referrer-dynamic-import`)                                                                                                                           |
| U6-7 | Request ctor reads init getters before throwing newTarget.prototype    | REGRESSION, contrived (`referrer-init-new-target-after-conversion`)                                                                                                                   |

### U1 interceptors (10ebe8e3, d6c0de3a): codex (`codex/U1-interceptors.md`), verified by me

Repros `runway/src/tests/review/v3/layers.ts`; every one passes on up and fails on head:

- U1-1 **REGRESSION, accepted by the user (2026-11-21):** `RawProxy(instance, key)` changes every instance (prior #2). "It's okay to break it". Not fixed.
- U1-2 **REGRESSION** a new layer drops a page wrapper installed in between (slot cached forever, render writes over the page's function). `v3-layers-page-wrapper-survives-new-layer`.
- U1-3 **REGRESSION (API)** `Proxy`/`Trap` no longer accept an array of names (v2 API). No in-repo callers. `v3-layers-proxy-array-names`.
- U1-4 **REGRESSION** embedder `Proxy` on a static before `hook()` + core's Intercept → static `super` recurses (`URL.createObjectURL` throws). `v3-layers-static-proxy-before-hook`.
- U1-5..8 are browser.js `inject`/`utils` alwaysLastBubble/history emulator issues (outside the scramjet core diff except utils' copy). TODO: triage after the core fixes.
- Heritage loader: verified wired for all core variants; only `GlobalScope` + local `WebSocket`/`WebSocketStream` bindings are skipped (safe: read from the target realm at hook time).
- Prior #4 (parent globals) **verified fixed**: all 10 `rv12-parentglobals-*` pass on head.

→ **PR #148 "layering"**: U1-2..4. User found the first version (own-property instance slots + page-replacement detection) too much code; simplified to: render skips an unchanged site. Design constraint (author's): installs land on the owning object, never a visible shadow. U1-1 fix = receiver-scoped layer in the shared slot; U1-2 fix = new slot over the page's current function when the site no longer holds ours; U1-3 = array overload.

### U9 TURNSTILE #130 (f3c16041): codex (`codex/U9-turnstile-130.md`)

Client-hints edge cases U9-1..4 (one regression: Accept-CH withdrawal) + U9-5 pre-existing TT `new Function`: **filed SCR-30, unverified** (need HTTPS/SW-restart repros; low impact). U9-6 (cold worker awaits UA data): read, negligible (one browser-internal call per worker; rejection caught). codex found nothing in CSP meta / TT sinks / header order beyond these, and notes #130 doesn't actually touch hasFocus.

### U1-4 extra: `rv8p3-proxy-before-hook` (prior #1, embedder-before-hook order) still fails on frozen head. TODO: investigate on the layering branch.

### U10 TURNSTILE #132 (f914b6a4): codex (`codex/U10-turnstile-132.md`)

- U10-1 SW buffers request bodies instead of streaming: **deliberate design** (Content-Length fidelity; a stream made POSTs chunked, which servers reject). Not acted on.
- U10-2/3 (`$scramjet*` page globals hidden from reflection; page `scramjet-injected` attr stripped) contrived, U10-4 (503 instead of network error when the controller is gone) pre-existing: **filed SCR-31**, left open.
- Checked fine (codex): doctype/quirks mode handling, HTTP/network error surfacing, frame ids.

### Fixes in flight

- PR #148 `v3/layering`: U1-1..4.
- PR #149 `v3/importmap`: U6-1.

### U2 top/siteFlags/hash (5268e0d1, b23f6355, 57f3f2fa, 3bcc37ba): codex (`codex/U2-top-siteflags-hash.md`)

- U2-1 **REGRESSION, FIXED** d635bdaa: a parsed link to the entry route (`/catalog#reviews`) reloads the page after a pushState round trip. Test `fragment-nav-parsed-link-after-pushstate-round-trip`.
- U2-2 v2 `siteFlags` (regex, in core config) silently ignored: deliberate API change (57f3f2fa). → **P5 migration notes**.
- U2-3 = SCR-38 item 4.

### U3 rewriter (fb97bd59, 0bab40f9, e3c4d13f + rewriter diff): codex (`codex/U3-rewriter-asi.md`)

- U3-1 **REGRESSION (stamp mode only), FIXED** 49cc890b: `return(0,f)()` → `return$scramjet$call`. Test `incumbency-return-paren-call-*`.
- U3-2..6 filed **SCR-40** (eval/import with trivia pre-existing; stamp-mode optional chain semantics; quadratic span search; dump CLI).
- codex: both ASI fixes look complete for statement lists, arrows, directives, hashbang, HTML comments.

### P5 so far

- Upstream changes since the fork (45fb6c68 version compat, e99d5953 CI tag prefix) are **not ported here**: ports were wiped from main at the user's request (2026-11-21); there will be a proper upstream sync later.
- Draft embedder migration notes: `review/v3/v3-migration-notes.md`.

## P4: broad picture

### Live-site sweep (rv9, 53 sites, head vs up, `-p 3`, ~10 min per build; results `~/.cache/sjreview-v3/sweep/results/{head,up}`)

- Worse on head in the first pass: espn, weather. **Both pass on 2 reruns on both builds: live-site noise. No real-site regression found.**
- Better on head: amazon, netflix, nextjs-docs (render on head, not on up).
- amazon (head): double-proxied requests aborted by the controller's "same origin" alarm. A proxied URL leaks to the page, likely via computed style (pre-existing: `cssurls-computed-style` fails on both) → **SCR-43**.

### Cross-subsystem review (codex, `codex/P4-interactions.md`)

- Popup → reloaded opener postMessage attributed to the opener (separate SingletonBoxes); `_top` fragment link from an iframe carries `$iframe` → **SCR-42** (unreproduced, rare).

### U8 frame names (f9d3a88d): codex (`codex/U8-framenames.md`) → **SCR-41** (shadow-root form `_parent`, `window.name` in iframe proxy URLs, base target after target removal; unreproduced). No MutationObserver installed.

### Performance (prior review perf probes, `-p 1`, head vs up; logs `~/.cache/sjreview-v3/logs/perf-{head,up}.log`)

- import() with a large import map: 119.5ms vs 0.077ms per call at 3000 entries → **FIXED** 2d9df252 (0.095ms).
- growing a `<style>` (CSS-in-JS): 7-9× → **PR #154** (now ≈ upstream to 2×).
- rest (dead realms 6.4×, rawtext 3.1×, trampolines 2.7×, error stack 2.6×, inline onclick 2.4×) → **SCR-44**.
