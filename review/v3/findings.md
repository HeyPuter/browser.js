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
| P3-2 | 12× `elshape-members-*` `order:` labels                                                                                                                                                                    | known: prior review bucket 1 #68 (brand check after argument conversion). Contrived/fingerprint. Still open.              |
| P3-3 | `elattr-onclick-attribute-behaviour`, `incumbency-regression-pst-inline-handler-source`, `eltext-mutations-{data,append-string,connected-empty-append,normalize,removechild,splittext,style}`              | known: prior #57/#65 (rewritten source in `onclick.toString()`, MutationObserver records). Still open.                    |
| P3-4 | `eltext-range-tostring`, `eltext-exec-movebefore`, `eltext-exec-currentscript-two-parts`, `eltext-script-rendered-innertext`, `elshape-innertext-outertext`, `events-handleevent-not-callable-is-reported` | known: prior #58. Still open.                                                                                             |
| P3-5 | `incumbency-regression-{stamp,lazystamp}-htmldda-is-not-nullish`                                                                                                                                           | non-default incumbency modes only (`pst`, the default, passes). Fails at f9d3a88d too. TODO: decide.                      |
| P3-6 | `referrer-long-document-url`, `referrer-init-new-target-after-conversion`                                                                                                                                  | added by #135 and already in the committed failing list (the author knew). TODO: review with U6.                          |

The P3-2..4 items were judged low-impact/contrived by the prior review and left open. They're fingerprint surfaces (`$scramjet$registerrealm` visible in `onclick.toString()` and MutationObserver `oldValue`) that an anti-bot script could read. TODO: ask the user whether v3 should close them.

### I6. CI's prebuilt jobs couldn't start (fixed 9090baae)

With I1 fixed, "Run Scramjet Tests" and "Build Frontend" died in cv: `CV_PREBUILT=core` still required every declared output of core's tasks, incl. `core:wasm`'s `rewriter/wasm/out/wasm.js`, which isn't in the downloaded dist artifact. Prebuilt now warns on a missing output.

### I7. Formatter drift on main

The pre-commit hook (`./cv format`) formats the whole repo; 7 files on main are unformatted (`packages/scramjet/.github/ISSUE_TEMPLATE/*`, `controller/src/inject.ts`, `demo/src/pages/{BrowserView,Playground}.tsx`, `demo/vite.config.ts`, `utils/src/http-cache-plugin.ts`), so every commit reformats them in the worktree. I revert them each time. A one-off format commit would end it (ask).
