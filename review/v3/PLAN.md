# scramjet v3 regression review

Goal: a regression-free scramjet v3. Started 2026-11-20. **Read this file first when resuming.**

## Standing instructions (from the user, do not lose)

1. Follow `.claude/skills/review-fix-cycle`: every finding is a hypothesis until a test shows it in scramjet **and** bare Chrome, then on the **upstream baseline**. Sort into regression / pre-existing / not real. Chrome behaviour wins over spec.
2. Scope: MercuryWorkshop/scramjet `main` vs browser.js `main` `packages/scramjet`.
3. Commits made before the review skill (`0d9180c4`, 2026-11-20) get **extra scrutiny**.
4. Multi-day. Cover both specific commits / narrow gaps **and** the broad picture: how the changes interact.
5. Fixes: regression test for each. **Clump related fixes into PRs** (`gh pr create` against HeyPuter/browser.js `main`), **merge them once confirmed good**. **Small fixes: commit directly to main.**
6. **Novel non-regression issues → Linear** team `Scramjet` (SCR), label **`v3-review`**. Check existing SCR issues for duplicates first. Decide whether the added complexity is worth a fix; contrived cases may stay open.
7. External reviewer: codex (`/usr/bin/codex`), plus my own reading. **Never fan out subagents** (user, 2026-11-20, after I launched 10): do the reading myself, at most one helper at a time, ask first. Brief it per the skill (scope, out of scope, prior fixes; say "nothing found" plainly).
8. Ask the user before design trade-offs, cutting features, or choosing between imperfect behaviours.
9. Commit attribution lines per the session's system reminder.
10. **Runway guidance:**
    - Neither branch's `failing_tests.json` is correct. Get a real baseline first (each branch's own runway against its own build) and **commit the corrected list to both** (our main; upstream scramjet main, which needs a push to MercuryWorkshop/scramjet, so confirm before pushing).
    - Run parallel (`--parallel N`).
    - **Measure how long each runway run takes** (log it in "Runway timings" below). Avoid spamming long runs; prefer targeted subsets.

## Scope facts

- Upstream `main` tree == our `a35c422c` (2026-11-15). Upstream has one extra commit, `e99d5953` (`.github/workflows/main.yml` only; check that it's ported).
- Ours: 42 linear commits `a35c422c..HEAD` touching `packages/scramjet` (develop was rebased onto a35c422c, author dates preserved).
- Diff: `git diff upstream/main HEAD:packages/scramjet` (~25k lines core/src, ~250 controller, cv build, ~69k runway tests).
- Prior review `review/{1..4}-*.md` covered develop #90 → `dac63876` (was `9ea38938`). Its repros are committed in `runway/src/tests/review/a*/`. Its worktrees (`~/.cache/sjreview`) are gone.

### Commit groups

A. Covered by the prior review (re-verify status only): `cfd48e0a` … `dac63876` (#90, #102–#113, #116, #129, #131, IDL cleanup, safe iteration, siteFlags inherit).

B. **Never reviewed, pre-skill (extra scrutiny):**
`d6c0de3a` parent-frame global deletion exploit · `d689496f` oxcfmt · `5268e0d1` topurl cache · `b5bb70e8` review tests · `10ebe8e3` layered interceptors · `b23f6355` siteFlags matcher · `57f3f2fa` siteFlags → controller · `3bcc37ba` hash urls #139 · `e3c4d13f` rewriter dump · `fb97bd59` asi/location · `5d09a91e` legacy sw revival · `556a1397` integrity #136 · `01ab48d0` sw revival · `4e3e8299` link header attrs · `0bab40f9` asi regression · `16659a94` referer #135 · `dd4878e6` event interception #140 · `f9d3a88d` frame names #145 · `f3c16041` TURNSTILE headers/referrer/CSP/TT/hasFocus #130 · `f914b6a4` TURNSTILE fingerprint #132

C. Post-skill: `204b5b0a` v3 version bump · `41a37557` main build fixes onto cv · `c9af0cba` runway runner.

## Phases

- [ ] **P0 Infra.** Durable worktrees in `~/.cache/sjreview-v3/{up,head}` (upstream/main and HEAD), built; runway runnable against each (port bases); bare-Chrome harness sanity. Record exact build commands here.
- [ ] **P1 Prior findings status.** Rerun every bucket-1 (and bucket-2) repro from `review/1-*.md`/`2-*.md` on up vs head. Table in `review/v3/prior-status.md`. Still-open regressions → fix queue.
- [ ] **P2 Group B per-commit review** (oldest first, but referer/events/frames/TURNSTILE are highest risk). Per commit: read diff myself, codex brief → `review/v3/briefs/<sha>.md`, raw output → `review/v3/codex/<sha>.md`, repros → `runway/src/tests/review/v3/`, verdicts → `review/v3/findings.md`.
- [ ] **P3 Suite diff.** Full runway suite on up and head (separately, saved logs); every up-pass/head-fail triaged.
- [ ] **P4 Interactions / broad picture.** Cross-cutting: incumbency × referer × frame names × event rework × hash urls × siteFlags; SW revival × controller; layered interceptors × browser.js inject. Real-site + framework sweeps (see prior README coverage list for the method). Perf (Speedometer) up vs head.
- [ ] **P5 Package surface for v3.** Public API/exports of core/controller/utils vs upstream (embedder breakage), dist contents, cv build output, versionInfo, CI workflow (`e99d5953`), README/docs.
- [ ] **P6 Wrap-up.** Known-left regressions list, confidence, what wasn't verified.

## Runway timings

| date  | build  | runway                      | filter                                      | tests | -p  | wall time | notes                                                                    |
| ----- | ------ | --------------------------- | ------------------------------------------- | ----- | --- | --------- | ------------------------------------------------------------------------ |
| 11-20 | up     | up's own                    | all, no generated WPT                       | 668   | 8   | 44–59s    | ×3                                                                       |
| 11-20 | up     | up's own                    | all + generated WPT                         | 808   | 8   | ~205s     | ×3; WPT cookie `samesite` tests hit 61s "stuck" timeouts, which dominate |
| 11-21 | head   | head (main checkout)        | all + generated WPT                         | 2509  | 8   | ~295s     | ×3                                                                       |
| 11-21 | up     | head (RUNWAY_SCRAMJET_ROOT) | all + generated WPT                         | 2509  | 8   | 563s      | ×1; many timeouts on up                                                  |
| 11-21 | either | head                        | 31-name subset                              | 32    | 4   | 2–8s      |                                                                          |
| 11-21 | head   | head                        | fragment/elurls/urlfidelity/rewrites subset | 159   | 8   | 19s       |                                                                          |

## Baseline notes

- Generated WPT (`scripts/generate-wpt.ts`) is gitignored; both CIs run `OMIT_WPT=1`. Generated from one pinned clone for both: `~/.cache/sjreview-v3/wpt` @ `108900567c9a` (2026-11-20). Use `WPT_SRC=~/.cache/sjreview-v3/wpt`.
- up's runway `wpt/referrer.ts` reads a cert from browser.js's `external/playwright/...`; in standalone scramjet those `*-fetch-http-html` tests error with ENOENT (upstream test bug).
- up flaky (fails in some of 3 runs): `site-google-apps-menu`, `site-youtube-search` (live sites), `wpt-cookies-path-default-html`, `wpt-cookies-prefix-__host-document-cookie-https-html`.
- up's committed list was stale: 45 entries that pass now (incl. `escapes-*worklet-*` tests that don't exist upstream), 66 real failures missing.
- `RUNWAY_SCRAMJET_ROOT=<scramjet root>` (added to runway) swaps the dist the **browser-side** harness serves. Node-side direct tests still import the workspace's `@mercuryworkshop/scramjet/bundled`, so they always test the main checkout's build. For up-vs-head on direct tests, use up's own runway.
- `RUNWAY_RESULTS_JSON=<path>` (added) writes per-test results incl. which side (scramjet/bare) failed.
- `RUNWAY_REVIEW=1` includes `tests/review/` (opt-in since 2026-11-20).
- Baseline lists: `~/.cache/sjreview-v3/logs/{up,head}-own-wpt-fail-{1,2,3}.json`.

## Progress log

(newest last; date each entry)

- 2026-11-20: scoped diff, created plan, Linear label `v3-review` on SCR.
- 2026-11-20: P0: worktrees `~/.cache/sjreview-v3/{up,head}` built (`scripts/build-baselines.sh`). Runway: added `RUNWAY_SCRAMJET_ROOT`, `RUNWAY_RESULTS_JSON`, `RUNWAY_REVIEW` (opt-in review dir, user decision). Found INFRA I1–I5 (findings.md). up baseline done (3 runs). head baseline running.
- 2026-11-20: P2 wave 1 launched: 10 read-only reviewer subagents, units U1–U10 (briefs/common.md + per-unit prompt below), output → candidates/<unit>.md. Units: U1 d6c0de3a+10ebe8e3 · U2 5268e0d1+b23f6355+57f3f2fa+3bcc37ba · U3 fb97bd59+0bab40f9+e3c4d13f+rewriter diff · U4 556a1397+4e3e8299 · U5 5d09a91e+01ab48d0+dac63876+controller diff · U6 16659a94 · U7 dd4878e6 · U8 f9d3a88d · U9 f3c16041 · U10 f914b6a4(+5f8a6135). codex not used yet (first invocation was interrupted by the user; confirm before using).
- 2026-11-20: **User stopped the 10-agent fan-out.** All killed; only U4 finished (candidates/U4-integrity-linkheader.md, unverified). Units U1–U3, U5–U10 still to review, by me, sequentially.
- 2026-11-21: head baseline done (2509 tests, ~295s/run ×3, 428 always + 5 flaky). P3 suite diff done (findings.md P3 table). Committed+pushed: e442b7eb-equivalent (CI validate --no-install, runway opt-in review dir, results json, multi-filter, failing list) and base-element fix; rebased onto percs' new c76f6324 (SW revival + cache storage; add to U5). Next: verify CI; then P2 per-commit review myself, starting U6 referer (#135) + P3-6.
- 2026-11-21 **user decisions:** (1) prior-known low-impact regressions (P3-2..4: rewritten-source leaks, script-text edge cases, conversion order): **fix only the trivial ones, file the rest on Linear** (v3-review). (2) **Push** upstream's corrected failing_tests.json to MercuryWorkshop/scramjet main: yes. (3) **codex approved** as external reviewer (one run at a time). (4) Long-URL Referer (#135, `referrer-long-document-url`): **leave, file on Linear.**
- 2026-11-21: CI on main green except runway's one CI-only failure (I8), now listed; fixed I6 (cv prebuilt). Pushed upstream failing list (32ffe62c). Filed SCR-23..29. Next: P2 per-commit review with codex, one unit at a time (order: U6 referer, U9 #130, U10 #132, U7 events, U8 frames, U1, U2, U5 (+percs' c76f6324), U3; U4 done by subagent, needs verification).
- 2026-11-21 **user:** RawProxy(instance) owner-wide patching is OK to break (don't fix U1-1). Keep fixes small: the user didn't want a large layering addition they don't understand. Prefer the smallest code that restores the behaviour.
- 2026-11-21 **user: do NOT bring back the static `/~/sj/` prefix in the SW** (my first PR #150 did; reworked to only the U5-4 guard). The evicted-prefix-cache leak is on SCR-32 item 0, to be fixed without the static prefix, if at all.
- 2026-11-21 P1 recheck (68 prior repros, frozen head vs up, `~/.cache/sjreview-v3/logs/p1-verdicts.txt`): 15 prior bucket-1 regressions still open (#7 #8 #11 #13 #14 #40 #41 #42 #43 #44 #47 #48 #55 #77 #78; #47 dropped 2026-11-21: `_` snapshot classes are bespoke routes by design, see below); "fails-both" items inconclusive (repros drifted).
- 2026-11-21 **user:** fix the still-open prior regressions by impact, small PRs (#7, #43, #14, #11, then rest; file anything needing a big change). **#8 storage-key format change: accept the break** (document in changelog, no migration).
- 2026-11-21 **user:** the `_` snapshot classes (`_URL`, `_Map`, ...) are meant to be bespoke routes, not linked to page prototypes. My #47 fix (93e9d634, a `URL_origin` getter snapshot that assumed `_URL` is page-tamperable) was **wiped from main's history** at the user's request, along with its test. Never add workarounds that assume `_` classes are unsafe.
- 2026-11-21: merged #149 (importmap prefix identity) and #151 (bespoke `_` constructors, user-requested proper fix). Direct to main: #43 javascript: URL frames (4db4786f, SCR-34 left), #14 style mirror MO loop (10ce20f9), #11 root-scope import maps (f7dc887e, SCR-35 left). PR #152 open: #7 XML DOMParser (SCR-33 leftovers). PR #148 layering, PR #150 SW race guard: awaiting user OK. Next prior regressions: #13 #40 #41 #42 #44 #48 #55 #77 #78; then P2 units U2 U3 U8 (+ U7 verification), P5 (port 45fb6c68 version compat, e99d5953 CI prefix).
- 2026-11-21 **user:** most main commits are fine; the objection to 4db4786f was that it **added a parameter to a core API (rewriteJs) for an edge case = bloat**. Don't widen core APIs for edge cases; file instead. Fix bar otherwise = "upstream regression + plausible real-world pattern" (small fix). Reverted as contrived: base-in-template/svg/math (6725a7bf → SCR-36) and javascript: URL prelude (4db4786f → SCR-34), in 847e5bd1. Never state real-world prevalence in commit messages without having verified it.
- 2026-11-21: direct to main: #13 revokeObjectURL (66617b3f). PRs: #152 XML DOMParser, #153 prepareStackTrace. Remaining prior regressions to judge against the bar: #40 foreign-realm node append, #41 Cache API in about:blank, #42 popup URL getters, #48 CookieStore change events, #55 unnamed SharedWorker name (contrived), #77 crossorigin blob/data classic scripts, #78 data: worker BroadcastChannel.
- 2026-11-21 **user:** closed PR #153 (prepareStackTrace) → SCR-39: niche/V8-only APIs need evidence of a real site breaking or fingerprinting on them. Merged #148 (layering). Filed SCR-37 (remaining prior regressions), SCR-38 (U7 events). Direct: #41/#42 about:blank base (cb357eb9). codex running on U2.
- 2026-11-21 **user:** wiped my upstream ports (45fb6c68, e99d5953) from main's history: "there's gonna be a proper sync later". Don't port upstream changes in this review. Also: no module-level state in client code (moved d635bdaa's map into the box, 8af6a390→4674637a).
- 2026-11-21 **user:** closed #150 (no repro), dropped the idle-stop guard test; SCR-32 item 0 is synthetic-only (cache deleted by hand).
