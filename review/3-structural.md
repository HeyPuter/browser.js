# Bucket 3: structural gaps (not easily fixable)

These limits come from the architecture, from the transport, or from what a same-origin proxy can emulate. Most exist on main and develop alike. Repro paths are relative to `packages/scramjet/packages/runway/src/tests/review/`.

1. **Incumbent attribution for postMessage through a foreign bound function** (the "foreign bound" gap). A `postMessage` bound in one realm and handed to another realm's host API is attributed to the realm that bound it, and cases where Chrome itself departs from the spec (the backup incumbent for promise jobs) are only approximated. develop's pst stack walk can't see a caller that put no script on the stack, so it falls back to the bind-time guess recorded in `installBind`. The design is documented in `client/shared/incumbency.ts`.
   Repro: develop's `incumbent-postmessage-backup-foreign-bound` plus the `incumbent-{location,window-open,document-open}-*` rows in `failing_tests.json` (`src/tests/incumbent*.ts`)

2. **Cross-origin isolation between proxied frames and popups isn't emulated.** Every proxied page is same-origin to the proxy, so a page can read a cross-origin `parent.location.href` or `opener.location.href`, and a cross-origin `iframe.contentDocument` is non-null. Isolation-based checks ("am I framed by a foreign origin?") give different answers.
   CONFIRMED on both. Repro: [a5/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a5/frames.ts) :: `rv5-frames-nested-cross-origin-sandwich`, `rv5-frames-frames-collection`, `rv5-frames-popup-cross-origin-opener`

3. **Stylesheet attribute selectors on URL attributes never match** (`a[href$=".pdf"]`, `a[href^="http"]`, `img[src*="logo"]`, `a[href="#"]`). The live attribute holds the proxied URL. querySelector/matches are fixed on develop by the selector mirror, but CSS rendering isn't. develop's `scramjet-attr-*` mirrors make a CSS-side fix feasible now: rewrite `[href<op>v]` to `:is([scramjet-attr-href<op>v], :not([scramjet-attr-href])[href<op>v])`.
   CONFIRMED on both. Repro: [a0/cssselectors.ts](../packages/scramjet/packages/runway/src/tests/review/a0/cssselectors.ts) :: `rv0-cssattr-selectors` (run without `RUNWAY_FAST`)

4. **`navigator.serviceWorker` and the Navigation API (`window.navigation`) are hidden.** Sites that call `navigator.serviceWorker.register()` without feature-detecting throw at boot; SPA routers that prefer the Navigation API fall back.
   CONFIRMED on both. Repro: [a0/surface.ts](../packages/scramjet/packages/runway/src/tests/review/a0/surface.ts) :: `rv0-surface` (`serviceWorkerContainer`, `swGetRegistrations`, `navigationAPI`) (run without `RUNWAY_FAST`)

5. **WebSocket protocol and close information is lost in the transport.** `WebSocket.protocol` is always `""`, server close codes and reasons are lost (develop reports 1005, main reported 0), and the harness transport never reports refused connections or dropped links. This breaks graphql-ws style subprotocol checks and apps that act on close codes (Discord gateway 4004/4014). The limit is in the bare transport, not in core.
   CONFIRMED on both. Repro: [a4/net.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net.ts) :: `rv4-ws-basics`, `rv4-ws-server-close-and-text`

6. **`getComputedStyle` and typed-OM reads expose proxy URLs,** for example `getComputedStyle(el).backgroundImage`. The engine resolves the URL, and un-rewriting every computed value is costly; the source comments call it deliberate.
   Repro: [a7/css-gaps.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-gaps.ts) :: `rv7-css-gaps`; [a7/css-nav-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe.ts) :: `rv7-probe` (`computed_style`)

7. **CORS isn't enforced.** A cross-origin image never taints a canvas, `crossorigin` images load without CORS headers, and cross-origin fonts load without them. Everything is same-origin to the proxy, and the SW would have to emulate the checks. (Not enforcing Subresource Integrity is by design: the browser sees rewritten bodies, so every resource loads whatever its digest. Only integrity _fidelity_ (reflection, serialization, events) has to match Chrome.)
   CONFIRMED on both. Repro: [a7/media.ts](../packages/scramjet/packages/runway/src/tests/review/a7/media.ts), [a7/media-attrs.ts](../packages/scramjet/packages/runway/src/tests/review/a7/media-attrs.ts)

8. **Bodyless POSTs go upstream without `content-length: 0`,** which Chrome always sends, so HTTP/2 servers that require it answer 411 Length Required (seen on TikTok's webcast API). This is the libcurl-over-wisp transport, not core, and it's the same on both builds. `curl` confirms the server's rule.
   Repro: live only (a local HTTP/1.1 server accepts it). See a1 findings, "Pass 2"; [a1/bodyless.ts](../packages/scramjet/packages/runway/src/tests/review/a1/bodyless.ts) is the local control.

9. **No storage or cookie partitioning for third-party frames.** Current upstream Chrome partitions third-party storage and cookies by top-level site; under the proxy every frame shares one partition. Our Playwright Chromium doesn't partition in the bare run either, so this is PLAUSIBLE rather than measured.
   Repro: [a19/partition.ts](../packages/scramjet/packages/runway/src/tests/review/a19/partition.ts) :: `rv19-partition-thirdparty-storage`

10. **Browser-extension content scripts receive the raw `$scramjet$` envelope** from the page's `window.postMessage`, so page-to-extension bridges (MetaMask-style wallets, React/Redux devtools) silently do nothing. Same on both builds.
    PLAUSIBLE (extensions couldn't be loaded in runway). See a21 findings.

11. **A page can forge another proxied site's `e.origin`/`e.source`** by passing a hand-built envelope to a native `postMessage` taken from an unhooked frame. Low: cross-site DOM access is already possible anyway (#2).
    PLAUSIBLE. See a21 findings.

12. **Cross-origin and no-cors responses expose every header** (both builds report `type:"basic"`). develop also exposes the CSP, X-Frame-Options and HSTS headers that main stripped, because carriers are copied before stripping: api.github.com shows 27 headers on develop, 22 on main and 12 in bare Chrome. Mostly a detectability issue.
    CONFIRMED. Repro: [a24/hdr2.ts](../packages/scramjet/packages/runway/src/tests/review/a24/hdr2.ts) :: `rv24-cors`, [a24/site.ts](../packages/scramjet/packages/runway/src/tests/review/a24/site.ts) :: `rv24-site-github-api`
