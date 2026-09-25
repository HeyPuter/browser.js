# develop vs main: scramjet core regression review

Scope: `git diff main...develop` in scramjet core, the 17 commits from #90 through c5d59ce5. Items touched by later develop commits were rechecked on 9ea38938 (`~/.cache/sjreview/dev2`, port base 4960). Only bucket 1 #3 changed status: it is fixed. Chrome only (the default `pst` incumbency mode).

| File                                     | Contents                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| [1-regressions.md](1-regressions.md)     | worked on main, broken on develop. Ordered by real-site impact               |
| [2-new-code-bugs.md](2-new-code-bugs.md) | bugs in code develop added or rewrote that aren't regressions against main   |
| [3-structural.md](3-structural.md)       | gaps that are inherent to the architecture, or not easily fixable            |
| [4-preexisting.md](4-preexisting.md)     | broken on main and develop alike, in code develop didn't meaningfully change |

## Reproductions

Every issue links to a runway test under `packages/scramjet/packages/runway/src/tests/review/<reviewer>/`. The files are untracked: delete that folder to get rid of them. Run a single repro by name filter:

```sh
OMIT_WPT=1 pnpm runway test <test-name>                        # also compares against bare Chrome
RUNWAY_FAST=1 OMIT_WPT=1 pnpm runway test rv4-g-revoke-non-blob  # scramjet only, faster
```

This runs against your checkout's current `packages/scramjet/packages/core/dist`, so rebuild it first (`pnpm rewriter:build` then `pnpm -C packages/scramjet/packages/core build`). To compare with main, use the prebuilt worktrees. Each has the same tests under `runway-a0/src/tests/review/aN/` and a port-base switch:

```sh
cd ~/.cache/sjreview/main/packages/scramjet/packages/runway-a0 && OMIT_WPT=1 RUNWAY_FAST=1 RUNWAY_PORT_BASE=4950 node --experimental-strip-types --no-warnings src/index.ts <test-name>
cd ~/.cache/sjreview/dev/packages/scramjet/packages/runway-a0  && OMIT_WPT=1 RUNWAY_FAST=1 RUNWAY_PORT_BASE=4900 node --experimental-strip-types --no-warnings src/index.ts <test-name>
```

**`RUNWAY_FAST=1` turns `assertConsistent` into a no-op.** Any repro that compares against bare Chrome (every `rv3-*`, the `rv2-cons*` tests, `rv7-mo-style-feedback-loop`, `rv8-javascript-url-iframe` and the develop-suite tests) only reproduces without it. Items say so where it matters. When in doubt, drop `RUNWAY_FAST`.

"CONFIRMED" means the same test was run against a main build and a develop build: it passes on main and fails on develop for bucket 1, and it fails on both for bucket 4. "PLAUSIBLE" means found by reading the code, without a runnable repro. Tests named `*-perf-*` always "fail" and print their timings; compare the numbers between builds.

The main and develop builds used for this review are worktrees under `~/.cache/sjreview/{main,dev}`. Each has patched runway copies (a port-base env var, and failure names printed outside GitHub Actions) and the full raw logs.

## Coverage

- main's runway suite (668 tests), run on the main build and on the develop build: **0 regressions**, 69 tests fixed by develop.
- develop's suite (1934 tests), run on both builds: 40 pass on main and fail on develop (the tail of bucket 1). 514 fail on main and pass on develop.
- Speedometer 3.1, run through both builds: every suite completes (199/199 metrics each). develop logs 0 page errors and fixes main's TodoMVC `className` TypeErrors (attribute selectors now match). The geomean is level with main; TodoMVC-Svelte-Complex-DOM is about 1.33x slower (bucket 1 #30).
- Production builds of real app templates (Vite react/vue/svelte/preact/lit/solid, Astro, SvelteKit, Nuxt, Angular, Next.js export, React Router, webpack 5) behave the same as plain Chrome on both builds, including lazy chunks, CSS, assets and module workers. The exception is **Parcel 2**, where every lazy chunk fails on develop only (bucket 1 #10).
- 14 rich-text and code editors (ProseMirror, TipTap, Lexical, Slate, Quill 2, CKEditor 5, TinyMCE 7, Draft.js, CodeMirror 6, Monaco, Ace, Trix, Editor.js, Toast UI): typing, formatting, undo, selection and paste are correct on develop, and per-key latency is within 0.2ms of main. develop fixes CKEditor 5, which dies after two characters on main.
- Every bucket-1 repro was rerun 3x per build by a QA pass. None was flaky.
- Games and interactive apps (Krunker, Minecraft Classic, monkeytype, tetr.io, Unity Play, GeoGuessr, Coolmath, lichess, Google Maps, Translate, Desmos, GeoGebra, CodeSandbox, StackBlitz, the Discord QR login, Twitch, and YouTube playback) behave the same on both builds, and develop fixes Scratch, diep.io and slither.io. The one develop-only break is CrazyGames (bucket 1 #17). Some sites (agar.io, skribbl, js-dos, Godot, Ruffle, now.gg) couldn't be compared because of transport TLS failures under load.
- A 52-site mainstream sweep plus a 52-site long-tail sweep, compared on main and develop: the only develop-only breakage was bucket 1 #3 (11 sites), which 9ea38938 has since fixed. A live re-run on 9ea38938 of the affected sites shows 0 controller errors. A 26-site sequential timing pass puts develop at 1.03x main for time-to-UI and 1.01x for network settle. Note that the stock libcurl transport fails TLS to many real hosts under load; the a9 harness copies add a `RUNWAY_TRANSPORT=epoxy` option.
- A final gap-analysis probe set (attributes/NamedNodeMap, SRI, SVG xlink, templates and declarative shadow DOM, style text, foreign-realm nodes, frames/sandbox, events), compared on main, develop and bare Chrome: develop fixes about 40 mismatches and adds two (bucket 1 #19, pushState/hash `$top`; and #69, shadow-root style read-back).
- A fresh-eyes gap analysis over the whole diff found no further site-breaking regression; it added bucket 1 #70 (a spurious SharedStorage deprecation report) and five bucket-4 items. Turbo Drive/Frames, htmx, DOMPurify, 30 script-insertion paths, consent-style script activation, the "clean natives from a fresh iframe" pattern and worker globals all behave the same on develop as in bare Chrome. Its per-file coverage map is in `~/.cache/sjreview/findings/a11.md`.
- Workers: the full matrix (file, blob, data:, module, shared, nested, iframe and popup workers) and real worker libraries (Comlink, pdf.js, Monaco, esbuild-wasm, sql.js, plus live sql.js GUI, pdf.js viewer, TS playground, babel REPL, excalidraw) behave the same on develop as in bare Chrome, apart from the data:-worker scope, `SharedWorker(url, 5)` and slower start-up items in bucket 1.
- SPA routers: React Router 6/7 (browser and hash), Vue Router 4, page.js, Backbone, Navigo, History.js, TanStack Router, Turbo 8, Swup, Barba and pjax behave like main and bare Chrome on develop (develop fixes Turbo's `replaceWith` errors). The exceptions are the stale-`$top` history items in bucket 1: reload double-loading, anchors reloading, hash traversal, and self-navigation.
- Messaging: about 30 postMessage call shapes across siblings, 3-deep nesting, sandboxed, data:, blob: and srcdoc frames, OAuth popups and unload-time messages attribute `origin`/`source` like Chrome on develop. So do the stand-in event semantics. The real libraries and embeds work: post-robot, PayPal buttons, comlink, penpal, iframe-resizer, Turnstile, Twitter, hCaptcha, Spotify and SoundCloud (several fail on main). Window postMessage is about 33x faster than main.
- Response headers: duplicates, `Set-Cookie` hiding, XHR header formatting, redirects, blob/data, cross-realm, Cache API round trips, compression, SSE and streaming latency all match bare Chrome on develop. It fixes several main bugs (lost duplicate headers, rewritten `Link` targets, leaked `Location`, `cache.add` rejection).
- Security features: nonce propagation (`currentScript.nonce`, webpack, Vite, emotion, clones, frames) now matches Chrome where main returned `""`. Cross-origin isolation, iframe `allow` and opener/noopener are unchanged. YouTube, Gmail, Docs and LinkedIn show no develop-only Trusted Types or CSP errors live. The develop-only Trusted Types issues are limited to pages that enforce TT via an inserted CSP `<meta>` (bucket 1).
- A second real-site sweep over the reliable epoxy transport (109 sites plus 14 multi-step app flows, two rounds per build) found no new develop-only regression. Its differences trace to the controller crash (bucket 1 #3, now fixed in 9ea38938), import-map and `postMessage(document.referrer)` items. No site's key UI or flow step broke on develop only, and median develop/main timing was 1.04x to UI. Earlier sweeps' `a[href^=…]` click selectors never matched the rewritten DOM, so the a23 harness widens them. Still blocked on both builds by bot walls: codepen, npm, stackoverflow, x, nytimes, ebay, fandom, quora, canva, etsy.
- core vitest 217/217, tools tests 49/49, `tsc` and eslint are all clean on develop.

The existing tests catch almost none of the regressions below. Nearly every bucket-1 item comes from a new probe; the exceptions are the develop-suite rows folded into bucket 1 #57-58.
