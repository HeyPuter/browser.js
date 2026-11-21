# scramjet v3 review: wrap-up (2026-11-21)

The scope was MercuryWorkshop/scramjet `main` (== browser.js `a35c422c`) against browser.js `main`. Plan and log: [PLAN.md](PLAN.md); per-item detail: [findings.md](findings.md); codex reports: [codex/](codex/); embedder notes: [v3-migration-notes.md](v3-migration-notes.md).

## What was done

- **CI made real.** It hadn't run a test since the cv switch: validate failed on a frozen install, the prebuilt jobs died in cv, and runway discovery crashed on missing fixtures. The failing lists for both repos were regenerated from three runs each. Main's CI now runs the full runway suite.
- **Every commit with no prior review** was read by codex with a brief, and I verified each finding against bare Chrome, upstream and head (units U1–U10).
- **The old main-vs-develop review's 80 confirmed regressions were rechecked**: 15 were still open on v3. Of those, 8 are fixed, 2 were accepted by decision, and the rest are filed.
- **Broad picture:** the full suite diffed across builds, a 53-site live sweep, a cross-subsystem review, and the old review's perf probes.

## Fixed on main (with a test for each)

| commit                                           | what                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 0e488f9f, 0b8a03e8                               | CI / cv / runway infrastructure                                                         |
| c3bd287a                                         | Link-header `modulepreload` fetched twice                                               |
| e7daeb29 (#149)                                  | `import()` through an import-map prefix ran the module twice                            |
| 84758649 (#151)                                  | `_` snapshot constructors made instances on the page's prototypes (`_URL`, `_Map`, ...) |
| 59a56f4f                                         | inline style writes looped page MutationObservers (prior #14)                           |
| b885adc0                                         | import maps with a root scope (prior #11)                                               |
| 61ac0a6a                                         | `revokeObjectURL` threw on non-blob input (prior #13)                                   |
| 17ac5538                                         | about:blank base URL for popups and the Cache API (prior #41, #42)                      |
| e3dac9b6 (#148)                                  | embedder layering: page wrappers, array names, static `super` before hook               |
| 961f236f                                         | entry-route fragment links reloaded after a pushState round trip                        |
| 7f0e25be (#152)                                  | XML via `DOMParser` (prior #7)                                                          |
| d7a7489d                                         | `return(0,f)()` in stamp mode                                                           |
| b404bc57                                         | `import()` re-parsed import maps on every call (119ms → 0.1ms at 3000 entries)          |
| 12152ded (#154)                                  | growing a `<style>` was quadratic (CSS-in-JS 7-9× slower)                               |

Reverted by decision, and removed from history: the base-in-template/svg fix (SCR-36) and the javascript: URL preludes (SCR-34). Closed without merging: #150 (SW race, no repro) and #153 (`prepareStackTrace`, no real-site evidence).

## Regressions vs upstream knowingly left in v3

| issue                | what                                                                                                          | why left                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SCR-24               | rewritten script source visible (`onclick.toString`, MutationObserver records)                                | needs text/attribute-layer work; fingerprint, not breakage |
| SCR-25               | script-text edge cases (Range, moveBefore, innerText)                                                         | contrived                                                  |
| SCR-26               | brand check after argument conversion                                                                         | fingerprint only                                           |
| SCR-27               | Referer cut to origin for long page URLs                                                                      | user decision                                              |
| SCR-28               | `document.all?.x()` in stamp/lazystamp                                                                        | non-default modes                                          |
| SCR-34               | javascript: URL frames throw (preludes)                                                                       | fix needed core-API surface; reverted                      |
| SCR-36               | `<base>` in template/svg/math                                                                                 | reverted, contrived                                        |
| SCR-37               | foreign-realm nodes, CookieStore `change`, worker edge cases                                                  | rare or large                                              |
| SCR-38 #1, SCR-40 #2 | strict inline handler `arguments[0]`; stamp optional chains                                                   | rare                                                       |
| SCR-39               | page `Error.prepareStackTrace` ignored with cleanErrors                                                       | no real-site evidence                                      |
| SCR-44               | perf: dead iframes 6.4×, inline onclick 2.4×, others                                                          | design-level                                               |
| (accepted)           | `RawProxy(instance)` patches every instance; v2 storage keys not migrated; `siteFlags` moved to `createFrame` | user decisions, in the migration notes                     |

Pre-existing and newly filed: SCR-23, 29–33, 35, 41–43.

## Confidence

- **High** for what runway covers in Chrome: on the final main, the full suite has no unexpected failures against the corrected list. Every fix was checked against the full suite, or a family subset for the small ones, and against the upstream build.
- **Medium** on real sites: the 53-site sweep found no head-only breakage, but it checks that a key element renders and a basic step works, not deep flows (logins, payments).

## Not verified

- **Engines other than Chromium.** Every run was Chromium via Playwright. `lazystamp`, the default off V8, was only exercised by the incumbency tests, which run all modes in Chromium.
- **browser.js's own frontend (`packages/inject`) end to end.** The layering fixes were tested at the core API level only.
- **Service-worker restore in the wild.** Only CDP-forced idle stops were tested; the empty-cache failure is synthetic (SCR-32).
- **Every codex finding marked "not reproduced"** in SCR-30, 31, 32, 38, 40, 41, 42 came from reading the code.
- **The live sweep's failures from the libcurl transport's TLS errors** under load. Such sites were compared only where both builds rendered.
- **Upstream changes made after the fork** (45fb6c68, e99d5953) are deliberately not ported; a proper sync is planned.
- **CI flakiness:** the live `site-google-*` tests can fail on GitHub's runners and pass on rerun.
