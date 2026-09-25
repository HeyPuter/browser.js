# Bucket 1: regressions (worked on main, broken on develop)

Chrome, default flags. Ordered by how likely each is to break real sites. Every item is CONFIRMED (the same runway repro passes on main and fails on develop) unless marked otherwise. Repro paths are relative to `packages/scramjet/packages/runway/src/tests/review/`. See [README](README.md) for how to run them.

## browser.js frontend (`packages/inject`): hits every page in the product

Confirmed end to end in real browser.js builds of main and develop (devserver plus Playwright, local test site plus react.dev). Details are in the a8 findings, "Pass 4".

1. **Core now refuses to patch a member twice, which silently switches off browser.js's own emulators.** `resolveNative` (`client/client.ts:1013`) skips any member already in its `patched` set, and `Intercept`/`Proxy`/`Trap` all go through it. In the real app core's `hook()` runs first. `packages/inject`'s `client.Proxy` emulators then log "already intercepted … skipped" on every page for `History.prototype.pushState`/`replaceState`/`back`/`forward`/`go`, `window.open` and `EventTarget.prototype.addEventListener`. On main the second patch wrapped the first. User-visible on develop, working on main:
   - **The address bar and tab URL don't follow SPA navigation.** After clicking "Learn" on react.dev, the frame is on `/learn` but the tab still says `https://react.dev/`, the back button stays disabled, and pressing back reloads the home page (on main, back returns to `/learn`). Every SPA is hit, along with session restore, tab duplicate and share. Page-initiated `history.back()`/`forward()`/`go()` are no longer routed through browser.js either (the frame traverses by itself).
   - **`window.open()` throws "hookSubcontext was called, but a frame null was passed".** Before throwing, it opens a stray real top-level window at the raw proxy URL, outside the browser.js UI. Google/Apple sign-in, OAuth and payment popups abort; main opens a browser.js tab. `target=_blank` links still work.
   - **The page's own link and context-menu handlers are overridden.** inject's `alwaysLastBubble` bookkeeping is one of the skipped emulators, so browser.js's link/contextmenu handler runs _first_ instead of last. It then calls `preventDefault()`/`stopPropagation()`/`stopImmediatePropagation()`, so the page's `document`-level handlers never fire. The effects:
     - Sites with their own right-click menu (Google Docs/Sheets, Figma, Discord, VS Code for the web) show browser.js's menu, and never get their own `contextmenu` event.
     - `target=_blank` links that the page cancels through a delegated handler on `document` (routers, jQuery delegation, consent and analytics interceptors) open a tab anyway.
     - A middle-click the page cancels in `auxclick` opens a tab anyway.

     Handlers attached to the link element itself still work.

   - For embedders that install before `hook()`, it's the other way round: core's own interceptors are the ones skipped. The core-level repro shows pushState going unrewritten and message listeners getting the raw `$scramjet$` envelope.

   Cause: 684e46cf (#102), the `patched` guard.
   Repro: [a4/qa-extra.ts](../packages/scramjet/packages/runway/src/tests/review/a4/qa-extra.ts) :: `rv4qa-inject-real-order-hook-then-emulators` (inject's real order: hook first, then emulators; develop reports that none of the emulators ran); [a8/p3-double-patch.ts](../packages/scramjet/packages/runway/src/tests/review/a8/p3-double-patch.ts) :: `rv8p3-proxy-before-hook` (the embed-before-hook order); end-to-end drivers at `~/.cache/sjreview/scratch-a8/e2e/{e2e,e2e2,realsite}.mjs` (results in `result2-{main,dev}.json`).

2. **Latent, and live as soon as #1 is fixed: `client.RawProxy(instance, key)` now patches the shared prototype.** Since #102, installs land on whichever object owns the key (`installNative` onto `native.owner`), not on the object passed in. inject's `alwaysLastBubble.ts` RawProxies `stopPropagation`/`stopImmediatePropagation` on each click/auxclick/contextmenu event that reaches a link. Once that emulator runs again, the first link click replaces `Event.prototype.stopPropagation` page-wide with a handler that throws `stopPropagation called but no desc found?` for every other event. It doesn't show end to end today only because #1 disables the emulator. Fix both together.
   Cause: `client/client.ts` `RawProxy` plus `resolveNative`/`installNative` (#102).
   Repro: [a8/p3-double-patch.ts](../packages/scramjet/packages/runway/src/tests/review/a8/p3-double-patch.ts) :: `rv8p3-rawproxy-on-instance`

## Site-breaking

3. **FIXED on develop in 9ea38938** ("[controller] fix throw when injecting into already loaded client", `navigator.serviceWorker?.controller` at `controller/src/inject.ts:166`). ~~An iframe whose `contentWindow`/`contentDocument` is touched before it loads crashes the controller inject inside it.~~ Kept here for the record. On the old develop (c5d59ce5), the controller crashed with `Cannot read properties of undefined (reading 'controller')` and then `reading 'load'` in every frame touched before load and in every `window.open` popup. This was the biggest real-site item: reCAPTCHA v2, the Twitch embed, own `Set-Cookie` in OAuth popups, and about 40 sites across both sweeps.
   **Re-verified on 9ea38938:** every repro below now passes. `rv5-touched-functional` shows the frame's server cookie again, and `rv19-popupcookie-own-set-cookie` sees its own `Set-Cookie`. In a live re-run of the 16 affected sites from the second sweep (airbnb, bandcamp, bestbuy, codesandbox embed, espn, expedia, miro, netlify, asahi, lefigaro, allbirds, colourpop, soundcloud, spotify, target, teams), the counts went from 2–28 controller errors and up to 14 uncontrolled frames per site to 0 and 0. Page-error counts are back to main's level, and the reCAPTCHA `Timed out` errors on spotify are gone.
   **Not fixed by it**, because the causes are independent: #4 (parent-global interceptor modules, still failing in touched frames), #5 (popup `$top=about:blank`), #6 (popup hangs after the opener navigates; only the controller-crash noise in its log disappeared), #9 (`postMessage(document.referrer)`) and bucket 4 #23 (`target=_top` rename, still renames the parent).
   Repro: [a5/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a5/frames.ts) :: `rv5-frames-touch-contentwindow-before-load-crossorigin` / `-sameorigin` / `-srcdoc`; [a5/touched.ts](../packages/scramjet/packages/runway/src/tests/review/a5/touched.ts) :: `rv5-touched-functional`; [a5/embeds.ts](../packages/scramjet/packages/runway/src/tests/review/a5/embeds.ts) :: `rv5-embed-recaptcha-v2`, `rv5-embed-twitch`; [a8/p2-frames.ts](../packages/scramjet/packages/runway/src/tests/review/a8/p2-frames.ts) :: `rv8p2-frame-touch-before-load`; [a1/earlyhook.ts](../packages/scramjet/packages/runway/src/tests/review/a1/earlyhook.ts); [a9/sites-repros.ts](../packages/scramjet/packages/runway/src/tests/review/a9/sites-repros.ts) :: `rv9-early-contentwindow-child-inject`; [a8/p3-popup.ts](../packages/scramjet/packages/runway/src/tests/review/a8/p3-popup.ts) :: `rv8p3-popup-realm`; [a19/popupcookie.ts](../packages/scramjet/packages/runway/src/tests/review/a19/popupcookie.ts) :: `rv19-popupcookie-own-set-cookie`

4. **Child realms hooked from the parent lose whole interceptor modules when the parent page has a global of the same name.** Frames whose client is installed by the parent run the parent's module code. That covers about:blank and `document.write` iframes, popups the opener touches, and real iframes touched before load. On develop, `class extends X` in each interceptor then resolves `X` in the parent's global scope at hook time, after the page's scripts have run, and `Intercept` keys off `X.name`. If the page's `X` isn't a constructor the module throws; if its name differs, the interface is silently skipped. main resolved string paths against the child's own global.
   - **Triggers:**
     - a top-level `var Storage = {...}` or `var Cache = {}`;
     - XHR wrappers from New Relic, Pace.js and ajax-hook (replacing `window.XMLHttpRequest`/`WebSocket`);
     - Prototype.js replacing `window.Element`.
   - **Effects on develop:**
     - the child's `localStorage` is the raw area shared by every proxied site;
     - a touched child page's XHRs return 404;
     - child `innerHTML`/`setAttribute` loads go straight to the real site, bypassing the proxy and leaking the user's IP.
   - **Related (low):** in those children, `getAttributeNames()`, `performance.getEntries*()`, `caches.keys()`, `cache.keys()`, `indexedDB.databases()` and `cookieStore.getAll()` return arrays and objects from the parent realm.

   Cause: `client.Intercept(class extends X …)` call sites across `client/**` run in the parent's module scope for hooked children (#102). The a12 findings have the full semantics diff.
   Still failing on 9ea38938 (8 of 10 `rv12-parentglobals-*`, same as before). This includes `-xhr-newrelic-touched-page`, so fixing #3's crash didn't help touched real iframes here.
   Repro: [a12/rv12-parentglobals.ts](../packages/scramjet/packages/runway/src/tests/review/a12/rv12-parentglobals.ts) :: `rv12-parentglobals-var-storage-blank`, `rv12-parentglobals-xhr-newrelic-touched-page`, `rv12-parentglobals-xhr-*`, `rv12-parentglobals-ws-pace-blank`, `rv12-parentglobals-element-prototypejs-blank`

5. **Popups opened with `window.open(url)` believe their top page is `about:blank`.** The popup's client is built while it's still the initial blank document and caches that as its `topUrl` (34e8d51f). So:
   - every URL it rewrites (`import()`, fetch, images, iframes, workers) carries `$top=about:blank`;
   - a module imported both statically and via `import()` runs twice (count 2 on develop, 1 on main);
   - site flags for the popup's site are read for `about:blank`, so `siteFlags` entries are ignored.

   This hits OAuth, payment and print popups wherever popups are real windows. `window.open("")` followed by `location.href = url` is unaffected.
   Still failing on 9ea38938 (`count:2`, `$top=about:blank`).
   Repro: [a14/popuptop.ts](../packages/scramjet/packages/runway/src/tests/review/a14/popuptop.ts) :: `rv14-popup-top`

6. **Once a popup's opener navigates away, the popup's `fetch()`, `caches.match()` and `indexedDB.databases()` hang forever.** The popup runs the opener's interception code, and develop made those members `async`. Once the opener's document is gone, Chrome never resumes the `await`s. main's `fetch` works in the same situation. An iframe hooked by a sibling frame that later navigates hangs the same way.
   Still failing on 9ea38938. The #3 controller errors are gone from the popup, but `fetch`/`caches.match`/`indexedDB.databases` still never settle.
   Repro: [a14/openerdeath.ts](../packages/scramjet/packages/runway/src/tests/review/a14/openerdeath.ts) :: `rv14-openerdeath-navigate`; [a14/crosshook.ts](../packages/scramjet/packages/runway/src/tests/review/a14/crosshook.ts) :: `rv14-crosshook-sibling`

7. **`DOMParser.parseFromString` with an XML type returns a `<parsererror>` document for typical XML** (anything with an `<?xml?>` declaration, a processing instruction or `xlink:href`). develop now rewrites `text/xml`, `application/xml`, `image/svg+xml` and `application/xhtml+xml` input in xmlMode; main left them alone. The damage:
   - The tokenizer drops the `?` of processing instructions, so `<?xml version="1.0"?>` is written back as `<?xml version="1.0">` and the whole document fails to parse.
   - `xlink:href` is mirrored as `scramjet-attr-xlink:href`, which uses an undeclared namespace prefix, so SVGs with `xlink:href` fail to parse too.
   - DOCTYPE internal subsets are cut short, entity refs are re-escaped, and malformed input is silently "fixed".
   - Documents that do parse carry `scramjet-attr-*` attributes and rewritten script bodies, which show up through XMLSerializer.

   This hits RSS/Atom/SOAP/XMPP/KML parsing, `jQuery.parseXML` and `$.ajax({dataType:"xml"})`, and SVG icon loaders (svg-inject, iconify, react-svg, angular-svg-icon).
   Cause: `client/dom/markup.ts:389-409`, `shared/htmlparser/Tokenizer.ts:806-813` (#112). develop added the XML rewrite to close its own `domparser-*-adopt` escape tests, so simply reverting to main's behaviour reopens those escapes. The fix needs a real XML path: keep processing instructions and the doctype, don't mirror prefixed attributes, and handle script bodies properly.
   Repro: [a3/rv3-domparser.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-domparser.ts) :: `rv3-domparser-xml` (run without `RUNWAY_FAST`); [a2/xml.ts](../packages/scramjet/packages/runway/src/tests/review/a2/xml.ts) :: `rv2-xml-jquery-parsexml`, `rv2-xml-domparser-declaration`, `rv2-xml-domparser-svg-icon`

8. **Stored site data is silently lost on upgrade (localStorage, sessionStorage, OPFS, Cache API).** This is a one-time hit rather than a persistent breakage, but it logs every user out of every site. The backing-store key formats changed with no migration or fallback:
   - localStorage/sessionStorage keys went from `example.com@k` to `https://example.com@k`, so every user is logged out of every proxied site and loses saved state.
   - The OPFS directory went from `https:--example-com` to `https%3A%2F%2Fexample.com`.
   - Cache entries are now keyed by the real URL instead of the proxied one. `caches.has()` still returns true, but every `match()` misses, which breaks Workbox-style code that trusts `has()`.
   - The old keys are never cleaned up, so they sit in quota forever. IndexedDB names are unchanged, so IDB data survives.

   Cause: `client/dom/storage.ts:37`, `client/shared/opfs.ts:9`, `client/shared/caches.ts:67-76` (#107, #108).
   Repro: [a5/storage.ts](../packages/scramjet/packages/runway/src/tests/review/a5/storage.ts) :: `rv5-persist-localstorage-rawkey-format`, `rv5-persist-opfs-dirname-format`, `rv5-persist-cache-entry-key-format` (control: `rv5-persist-idb-name-format`)

9. **`postMessage(msg, document.referrer)` from an iframe or popup now throws `SyntaxError`, so the message is never sent.** Under the proxy, `document.referrer` is `""` in every iframe and `window.open` popup (on both builds), because it's derived from the frame's own `client.history`. main replaced every `targetOrigin` with `"*"`, so an empty one was harmless. develop's new check (#103) parses it and throws `Invalid target origin ''`, and the widget's script stops there. This hits "ready" handshakes, resize and height messages, and OAuth/payment callback results. Replying to the referrer's origin rather than `"*"` is what postMessage security guides recommend, so it's precisely the hardened widgets that break. Live: a tracking iframe on corriere.it builds its target from the referrer, gets `"//undefined"`, and throws on develop only. The `targetOrigin` check itself is correct; frames and popups need the creator's referrer.
   Cause: `client/dom/document.ts:241` (referrer) meeting `client/shared/postmessage.ts` (targetOrigin parsing, #103/#113).
   Still failing on 9ea38938 (all three `rv21-refpm-*`).
   Repro: [a21/referrerpm.ts](../packages/scramjet/packages/runway/src/tests/review/a21/referrerpm.ts) :: `rv21-refpm-iframe-cross`, `rv21-refpm-iframe-same`, `rv21-refpm-popup`

10. **Dynamic `import()` of an import-map specifier from the page's HTML fails ("Failed to fetch dynamically imported module").** The SW rewrites the inline import map but records no original source for it, unlike other scripts. develop's new client-side resolver (`client/shared/import.ts`) reads back the already-rewritten map and rewrites the result again, so the URL is double-proxied. This hits **every Parcel 2 app** (Parcel emits an inline import map with hash keys and loads each lazy chunk with `import("bbXhI")`, so every lazy chunk fails with HTTP 500 "attempted to fetch from same origin"), Rails 7 importmap apps (Stimulus lazy-loads every controller with `import()`), Shopify themes (colourpop.com's `vendor-swiper-element` chunk fails to load), WordPress 6.5+ script modules, esm.sh/jspm buildless sites and three.js examples. Static imports still work.
    Cause: `shared/rewriters/html.ts:489-526` plus `client/text.ts:252-289` plus `client/shared/import.ts:25-68` (#112).
    Repro: [a8/rewriter-modules.ts](../packages/scramjet/packages/runway/src/tests/review/a8/rewriter-modules.ts) :: `rv8-importmap-exact-static-dynamic`; [a3/rv3-importmap.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-importmap.ts) :: `rv3-importmap-static` (label `dyn.a`, run without `RUNWAY_FAST`); [a3/rv3-apps.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-apps.ts) (Parcel app); [a5/importmap.ts](../packages/scramjet/packages/runway/src/tests/review/a5/importmap.ts) :: `rv5-importmap-parser-dynamic-bare`, `-bare-from-module`. Prefix and scope entries (`-dynamic-prefix`, `-dynamic-scopes`) fail on main too.

11. **Import maps with entries in a root or URL scope stop resolving static imports.** That's `"scopes": {"./": …}`, `{"/": …}` or `{"https://ga.jspm.io/": …}`, which is how jspm-generated maps are laid out. develop rewrites a prefix scope without its trailing slash, so Chrome treats it as an exact scope that never matches, and every bare specifier provided only by that scope fails ("Failed to resolve module specifier"). main left the map raw, so the scope matched and the modules loaded (straight from the CDN, unproxied). Live, generator.jspm.io renders 3 custom elements on main and 0 on develop.
    Cause: `shared/rewriters/importmap.ts` scope rewriting (#112).
    Repro: [a16/scopes.ts](../packages/scramjet/packages/runway/src/tests/review/a16/scopes.ts) :: `rv16-root-scope-xo-dot`, `rv16-root-scope-xo-slash`

12. **Import maps that pass through the client HTML rewriter, or are re-created from another map's text, break.** It's the same root cause as #7, reached through entry points a SW-only fix would miss:

- maps written with `document.write`, inserted with `createContextualFragment`, or inside `iframe.srcdoc` fail on `import()`;
- maps re-created from an existing map's `textContent` break static imports too, and reading such a map back returns the rewritten JSON, which develop then rewrites a second time. That's the pattern Turbo Drive, Swup and pjax use to re-activate scripts on navigation.

Repro: [a16/mod8.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod8.ts) :: `rv16-map-sinks` (labels `docwrite`, `ctxfrag`), `rv16-map-activate-copy`; [a16/mod9.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod9.ts) :: `rv16-map-srcdoc`

13. **`URL.revokeObjectURL(x)` throws synchronously for any argument that isn't a well-formed blob URL** (`undefined`, `""`, `null`, http, data or relative URLs). The native never throws. This aborts unguarded cleanup code: React effect cleanups revoking an unset preview URL, upload widgets, media players revoking `el.src`. Main did the unrewrite inside a timer, so a bad argument never reached the caller.
    Cause: `client/shared/blob.ts:19-31` then `unrewriteBlob`'s `new URL()` (4e8b1139, #109).
    Repro: [a4/net7.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net7.ts) :: `rv4-g-revoke-non-blob`; [a7/misc-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/misc-probe.ts) :: `rv7-misc-probe`

14. **Every CSSOM style write queues an extra `scramjet-attr-style` MutationRecord, even when nothing changed, so observer feedback loops hang the tab.** An observer that re-applies a style in its callback (autosize/height sync, sticky fixers, theme enforcers) runs once on main and in bare Chrome, and loops without end on develop. Every `attributes:true` observer also sees a bogus attribute name, whose `getAttribute(...)` is null; session-replay tools (rrweb, Hotjar, Clarity, FullStory) record it, and animation loops double their mutation traffic.
    Cause: `client/dom/css.ts:37-44` (`touched`), added in 93495e94 (#112).
    Repro: [a7/mo-loop.ts](../packages/scramjet/packages/runway/src/tests/review/a7/mo-loop.ts) :: `rv7-mo-style-feedback-loop`; [a7/css-nav-probe2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe2.ts) :: `rv7-probe2`

15. **SVG `url(#id)` references set through `svgEl.style.X` or `cssRule.style.X` stop rendering (gradients, clip-path, mask, filter, marker).** develop newly wraps `SVGElement.style` and `CSSRule.style` and pushes values through `rewriteCss`, which turns `url(#g)` into an external proxy URL. React/Preact/Vue SVG icons and charts using `style={{fill:'url(#g)'}}` are hit. A pixel check shows red on main and unpainted on develop. The same root cause breaks `url(#id)` in stylesheets on both builds (bucket 4 #3), and one fix covers both: leave fragment-only URLs alone in `handleCss`.
    Cause: `client/dom/css.ts:233-262` (proxy `set`), `354-364` (`SVGElement.style`), `436-487` (`CSSRule` style getters) (#109, #112).
    Repro: [a7/css-svg-frag.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-svg-frag.ts) :: `rv7-svg-fragment-fill`

16. **In subframes, module scripts are evaluated twice.** HTML-attribute URLs rewritten by the JS `rewriteUrl` now carry `&$top=`, while the module specifiers that the wasm rewriter rewrites don't. The module map is keyed by URL, so an entry chunk that other chunks also import (Vite/Rollup `__vitePreload`) runs twice inside iframes. That means double mounts, duplicate `customElements.define` (NotSupportedError) and duplicated singletons. A `target=_top` link or `window.open(url, "_top")` from a script-created iframe carries a stale `$top` into the new top page. That page then double-evaluates too, and so does every page reached from it by an ordinary link. (With iframes from the page's own HTML the link stays in the frame, which is why an earlier repro didn't show it; that's bucket 4.)
    Cause: `shared/rewriters/url.ts:205-213` plus `fetch/parse.ts` `resolveTopUrl` (34e8d51f).
    Repro: [a6/topurl.ts](../packages/scramjet/packages/runway/src/tests/review/a6/topurl.ts) :: `rv6-top-module-dedupe-iframe` (reports `count=1` on main and `count=2` on develop); [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-top-link-from-iframe`, `rv15-top-link-chain`, `rv15-topnav-open`; [a6/topurl-pw.ts](../packages/scramjet/packages/runway/src/tests/review/a6/topurl-pw.ts) :: `rv6-toppw-urls`

17. **Every CrazyGames game fails to boot: in subframes, script-inserted import maps apply to `import()` but not to static imports.** The CrazyGames gameframe (iframed into every game page) inserts an import map with URL-like keys. develop now applies it to `import("./static/js/X.js")`, correctly per spec. The key was rewritten client-side inside a subframe, though, so it carries `$top=`. The chunk's static `import "../../bundle.js"` is rewritten by the SW without `$top`, so the key never matches, `/gameframe/bundle.js` 404s, and the game shell never mounts. Main applied no map to `import()` and loaded the versioned chunks, so it worked. Top-level documents are fine until their first URL change (see #19). Any framed site with a URL-keyed import map breaks, which covers exactly where game portals put their shells.
    Cause: `client/shared/import.ts` (#112) plus `shared/rewriters/url.ts:207-213` (34e8d51f). It's the same `$top` asymmetry as #16.
    Repro: [a5/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a5/frames.ts) :: `rv5-frames-importmap-dyn-nested-same`, `rv5-frames-importmap-dyn-nested-cross` (control: `rv5-frames-importmap-dyn-toplevel`); [a5/imdbg.ts](../packages/scramjet/packages/runway/src/tests/review/a5/imdbg.ts) :: `rv5-imdbg-nested`; [a5/games.ts](../packages/scramjet/packages/runway/src/tests/review/a5/games.ts)

18. **In subframes, import-map target addresses carry `$top` but relative module specifiers don't, so a mapped module that's also imported by path is evaluated twice.** main gives `count=1, same=true`; develop gives `count=2, same=false`. It's another trigger of the `$top` asymmetry (#16) that a fix limited to HTML attributes would miss.
    Repro: [a16/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a16/frames.ts) :: `rv16-iframe-map-identity`

19. **After any `pushState`/`replaceState` to a new URL, or any hash change, a top-level page starts stamping a stale `$top` on every URL it rewrites.** For the top frame, `topUrl` is cached at hook time, and `rewriteUrl` adds `$top` whenever it differs from the live `client.url` (fragment included). So once an SPA navigates, the effects are:
    - Every client-side rewrite (`import()`, `script.src`, `link.href`, `img.src`, `a.href`, fetch) carries `&$top=<initial URL>`.
    - A module imported before the URL change and again after it is fetched and evaluated twice. Revisited route chunks re-run top-level code, which means duplicate `customElements.define`, duplicated stores and double side effects.
    - Links and script navigations created after the change carry the stale `$top` to the next page, which then hits #10's double evaluation as a top-level page.
    - Re-inserted subresources miss the cache.

    Hash routers and `replaceState`-based URL cleanup trigger it too. The "top-level documents are fine" notes in #16/#17 only hold until the first URL change.
    Cause: `client/client.ts:1670-1691` (`get topUrl`, cached) plus `shared/rewriters/url.ts:207-213` (34e8d51f). The `pushState`/`replaceState` URL itself also goes through `rewriteUrl` (`client/dom/history.ts:58`), so after the first URL change the _real_ history entry carries `&$top=<first page URL>`. That's what makes reloads, back/forward and anchors below go wrong. Fix it together with #16: never add `$top` from a top-level client, and compare without the fragment.
    QA: all eight `rv10-topnav-*` tests were rerun 3x per build. main passed 8/8 every time; develop failed the same 6 every time, and both controls passed.
    Repro: [a10/topnav.ts](../packages/scramjet/packages/runway/src/tests/review/a10/topnav.ts) :: `rv10-topnav-import-after-pushstate`, `rv10-topnav-import-after-hash`, `rv10-topnav-script-module-after-pushstate`, `rv10-topnav-link-after-pushstate`, `rv10-topnav-location-after-pushstate` (control: `rv10-topnav-link-control-no-pushstate`)

20. **Frames that load _without_ `$top` run modules twice.** A `<script type=module src>` plus an `import()` of the same file both evaluate. That's the reverse of the asymmetry above: the client adds `$top` to the `import()` URL, but the frame's own document request carried none. Three ways a frame ends up like that:
    - it was navigated by name from the top page (`<a target=name>`, `window.open(url, name)`, form target);
    - a GET form was submitted inside the frame (the browser replaces the query that carried `$top`);
    - it's a `blob:` preview iframe.

    Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-named-*`, `rv15-frameform-get`, `rv15-preview-blob`

21. **Reloading an SPA after client-side navigation loads its modules twice.** After two `pushState`s, or one plus a scroll-restoration `replaceState(state, '', location.href)`, a reload, session restore or back-from-another-page refetches the page with `$top=<first URL>`. The SW trusts that carried `$top` (`fetch/parse.ts` `resolveTopUrl`), treats the page as a subframe, and its entry and route modules run as two instances. A minimal Vite-shaped app mounts twice. Live, after two link clicks and a reload: vitepress.dev loads 3 modules twice (including `framework.js`, the Vue runtime), vuejs.org 9, and svelte.dev 27 (including SvelteKit's `start.js`); main none. The earlier note that "a plain reload of a pushed route is fine" only holds after a _single_ pushState.
    Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-pushstate2-reload`, `rv15-pushstate2-back`; [a22/reloadtop.ts](../packages/scramjet/packages/runway/src/tests/review/a22/reloadtop.ts) :: `rv22-reloadtop-*`; [a22/realreload.ts](../packages/scramjet/packages/runway/src/tests/review/a22/realreload.ts) :: `rv22-realreload-*`

22. **In-page anchors reload the whole page after the first URL change** (a hash change, `replaceState` or `pushState`). `location.href = "#x"`, `assign("#x")`, `replace(url + "#x")` and clicks on script-created `<a href="#x">` re-fetch and re-run the document instead of scrolling, so state is lost and no `hashchange` fires. It carries over to the next page reached by a link. Live, clicking a heading/TOC anchor after a client-side navigation reloads on react.dev, docusaurus.io and svelte.dev on develop but not main, and Backbone's hash-mode `navigate({replace:true})` reloads too. (A parsed anchor _without_ any prior URL change is bucket 4.)
    Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-hash-then-*`; [a22/hash.ts](../packages/scramjet/packages/runway/src/tests/review/a22/hash.ts) :: `rv22-hash-*`, `rv22-hash-carried-stale-top`; [a22/realhash.ts](../packages/scramjet/packages/runway/src/tests/review/a22/realhash.ts) :: `rv22-realhash-*`

23. **Back/forward between `#` entries created with `pushState` no longer fires `hashchange`,** because the entries' real URLs differ in the query (`$top`). React Router's `createHashRouter` and Vue Router's hash mode rely on it, so their back button stops updating the route.
    Repro: [a22/hashtraverse.ts](../packages/scramjet/packages/runway/src/tests/review/a22/hashtraverse.ts) :: `rv22-hashtrav-push-push`, `rv22-hashtrav-hash-push` (control `rv22-hashtrav-control-hash-hash`)

24. **Navigating to the current URL after a `pushState` adds a history entry instead of replacing it:** `history.length` grows, forward entries are lost, and `history.state` is dropped (seen with Barba.js).
    Repro: [a22/selfnav.ts](../packages/scramjet/packages/runway/src/tests/review/a22/selfnav.ts) :: `rv22-selfnav-*`

25. **Stylesheets on the top page put `$top` on every `url()` and `@import` inside them, so preloaded fonts and images are downloaded twice,** and a sheet that's both `@import`ed and `<link>`ed is fetched twice. Bare Chrome fetches each once. That's wasted bandwidth and a visible font or image flash on every site that preloads.
    Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-font-preload-dup`, `rv15-image-preload-dup`, `rv15-css-img-dup`

26. **SharedWorkers are no longer shared between two pages of the same site.** Since 34e8d51f, every SharedWorker script URL carries `$top=<top page URL>`. So `/inbox` and `/settings` (or even the same page with a different query or hash) each start their own instance. That defeats the point of a SharedWorker, which is one socket, database connection or leader election shared by every tab (chat and mail clients, collaborative editors, WebSocket multiplexers). It's the same `$top` root cause as the module items.
    Cause: `shared/rewriters/url.ts:205-213` (34e8d51f).
    Repro: [a19/sharedworker.ts](../packages/scramjet/packages/runway/src/tests/review/a19/sharedworker.ts) :: `rv19-sharedworker-shared-across-pages` (label `otherTab`); [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-shw-*` (pages differing only in the hash)

## Performance cliffs (hit every site)

27. **Client install per realm is about 6.5-7x slower**: 5ms to 33ms per about:blank iframe in the QA reruns (9ms to 66ms in the first measurement), and time-to-first-page-script on a trivial page went from about 170ms to about 235ms. `saveNatives` eagerly walks every global interface's prototype chain and reads every window getter; that forces a synchronous layout at document start and instantiates lazy objects like `speechSynthesis`. `Intercept` copies all ~1300 window descriptors onto a fake prototype for each GlobalScope interceptor. Ad-heavy pages with many friendly iframes, embeds and workers pay this on the main thread.
    Cause: `client/client.ts:384-408`, `client/client.ts:1300-1309` (#90, #102).
    In workers the same install cost makes start-up (from `new Worker` to the first message) about 25-30% slower: 117-129ms on develop against 90-104ms on main (bare Chrome: 4-6ms).
    Repro: [a1/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a1/perf.ts) :: `rv1-perf-iframe-client-install`; [a20/startup.ts](../packages/scramjet/packages/runway/src/tests/review/a20/startup.ts) :: `rv20-startup`

28. **Dead iframes each retain about 6.6 MB of heap, against 1.2 MB on main.** On both builds the box registries hold every client strongly, so every removed or navigated iframe realm stays alive (bucket 4 #11). On develop, `saveNatives` gives each client a full copy of the descriptors along every interface's prototype chain: 966 interfaces and about 75k descriptor objects per realm. 200 iframes cost about 1.3 GB on develop vs about 240 MB on main, enough to get a tab killed. This hits ad slots that refresh their iframe, Discord/Slack embeds and OAuth silent-refresh frames.
    Cause: `client/client.ts` `saveNatives` (#90), `client/singletonbox.ts` `registerClient`.
    Repro: [a6/memory.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memory.ts) (`RV6_SCEN=iframes`), [a6/memcount.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memcount.ts)

29. **DOM calls get slower with every frame the page has ever created.** Every hooked realm stays registered forever, and develop's IDL brand checks loop over all of them. After 300 removed frames, `append("x")` goes from 1.4 to 3.5µs and `replaceChildren` from 1.2 to 4.5µs on develop; main stays at 0.1-0.4µs throughout. Ad-refreshing pages and SPAs that churn iframes degrade over a session.
    Repro: [a14/deadrealms.ts](../packages/scramjet/packages/runway/src/tests/review/a14/deadrealms.ts) :: `rv14-deadrealms-perf`

30. **DOM primitives are 2-30x slower per call.**
    - Per op: `append("x")` 0.38 to 2-4.6µs, appendChild+removeChild 0.23 to 2.5µs, insertBefore 0.18 to 1.2µs, `Text.data` get about 30x slower (0.03 to 0.74µs), nodeValue set 0.11 to 1.5µs, cloneNode 0.24 to 1.2µs, `querySelectorAll("a[href]")` 3.4 to 13.3µs (the native runs twice), `a.href` get 3.4 to 8µs.
    - Batches: 6000 `append(string)` went from 1.3ms to 10.2ms.
    - Attribute and selector ops (µs per op): `hasAttribute` 0.07 to 0.39, `removeAttribute` 0.17 to 0.62, `matches` 0.03 to 0.12, iterating `el.attributes` 0.48 to 2.0, `classList` add/remove 0.26 to 0.47, `importNode` 0.34 to 1.06 ([a11/perfattr.ts](../packages/scramjet/packages/runway/src/tests/review/a11/perfattr.ts)).
    - Cause: every `new client.native.X(obj)` allocates a Proxy plus a per-method Proxy, and the text layer's `text.around` runs on every insertion.
    - Framework mounts with about 100k DOM ops pay an extra 0.1-0.3s.
    - In Speedometer 3.1, TodoMVC-Svelte-Complex-DOM is about 1.33x slower on develop, and Lit, Nuxt and React-Stockcharts exceed 25% in some runs. Fine-grained updaters live on `text.data =` (10.8x slower), `nodeValue =` (7.1x) and `insertBefore` (about 6x). Overall Speedometer geomean is level with main.

    Cause: `client/client.ts:313-367`, `client/dom/node.ts`, `client/text.ts` (#90, #112).
    Repro: [a1/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a1/perf.ts) :: `rv1-perf-dom-insertion-hot-path`; [a2/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a2/perf.ts) :: `rv2-perf-*`; [a0/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a0/perf.ts) :: `rv0-perf-append-text`, `rv0-perf-insertBefore`; [a3/rv3-microperf.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-microperf.ts)

31. **Growing a single `<style>` is quadratic and much slower.** Every Text insertion into, or `.data` write under, a `<style>` re-rewrites the whole sheet, and every read unrewrites it. With 400 rules, goober's `sheet.data += css` went from 90ms to 1715ms, and appendChild of one text node per rule from 65ms to 1818ms. At 2000 rules develop takes over 30s. (`textContent +=` growth was already about as slow on main; `appendData` threw on main, so it has no baseline.) This covers goober (react-hot-toast, solid-styled-components), styled-components/emotion/JSS in dev or non-speedy mode, and Vue style injection.
    Cause: `client/text.ts` `sync()`/`data()` (#112).
    Repro: [a2/perfstyle.ts](../packages/scramjet/packages/runway/src/tests/review/a2/perfstyle.ts) :: `rv2-perfstyle-*`; [a7/css-perf-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-perf-probe.ts) :: `rv7-perfprobe` (`textnode_style_*`)

32. **Inline-style writes are 2-100x slower.** Each CSSOM write re-reads the whole style attribute, unrewrites every `url()` in it and writes the mirror attribute. `rv7-perfprobe` keys: `style_perf` 26-29 to 61-82ms, `style_perf_withattr` 22-35 to 135-165ms, `style_perf_big` (40 url() custom properties) 6-7 to 568-684ms (about 100x). Animated hero/parallax elements with a `background-image` pay this every frame.
    Cause: `client/dom/css.ts:37-44` (#109).
    Repro: [a7/css-perf-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-perf-probe.ts) :: `rv7-perfprobe`

33. **Other hot paths:**
    - Inline `on*` handler dispatch is 3-4x slower: the pst prelude `{const $=($scramjet$registerrealm(...))}` runs a full stack capture on every invocation.
    - `new Error().stack` is about 7x slower, because `cleanErrors` now defaults on and formats every stack in JS.
    - `Function.prototype.bind` is about 8.6x slower (now proxied for incumbency).
    - `Range.startOffset`/`endOffset` reads are about 50x slower (rich-text editors read these constantly).
    - Resource-timing reads are about 4-10x slower.
    - Script insertion: `ld+json` inserts, which need no rewrite, went from 2 to 14ms per 1000, and the like-for-like `textContent` path from 170 to 215ms. `script.text` went from 4 to 284ms, but most of that is main having skipped the rewrite (a bypass) ([a11/perfscript.ts](../packages/scramjet/packages/runway/src/tests/review/a11/perfscript.ts)).

    For balance: postMessage is about 35x faster. Timers, location reads, add/removeEventListener and insertRule are roughly flat (within about 1.2x either way).
    Repro: [a0/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a0/perf.ts) :: `rv0-perf-*`; [a7/misc-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/misc-probe.ts) :: `rv7-misc-probe` (`range_offsets_perf_ms`)

34. **Every `import()` re-parses and re-normalizes every import map, with quadratic cost.** Per call on an already-cached module, main is flat at about 0.03ms. develop takes 0.49ms with a 100-entry map, 11.3ms at 1000 entries and 57ms at 3000 entries. With no map at all, each call still scans the whole document: 0.44 vs 0.125ms on a 50k-element DOM. Sites that lazy-load many chunks through a large map (Rails importmap, esm.sh/jspm apps) pay this on every `import()`.
    Cause: `client/shared/import.ts` (`parseImportMaps(client.text.registeredImportMaps(document))` per call) (#112).
    Repro: [a16/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a16/perf.ts) :: `rv16-perf-importmap-100`, `-1000`, `-3000`, `-scoped-500x50` (prints timings; run with `RUNWAY_FAST=1`)

## Behaviour changes likely to bite some sites

35. **Style names that are dashed (`style['background-image']`) or capitalised vendor names (`style.WebkitMaskImage`) are no longer rewritten.** The wrapper only rewrites keys found in a snapshot of `Object.getOwnPropertyNames(style)`, which lacks those spellings, so the URL resolves against the proxy origin and 404s, and reads leak `/~/sj/...`. React documents the capitalised vendor-prefix form, and Vue 3 writes every `filter` binding as `style.WebkitFilter`, so `filter: url(...)` is never rewritten under Vue.
    Cause: `client/dom/css.ts:180-195, 225-262` (#109).
    Repro: [a7/css-nav-probe2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe2.ts) :: `rv7-probe2` (`dashed_*`, `webkit_mask_*`)

36. **After the first script write to an element's style, `getAttribute('style')`, `outerHTML`/`innerHTML` and `[style*=…]` selectors go stale for ordinary writes, so editors and serialisers save wrong content.** That first CSSOM write creates the `scramjet-attr-style` mirror, and reads answer from it from then on. But the wrapper only refreshes it for camelCase names in its snapshot, so other writes silently drop out of the serialised markup. Confirmed with the real libraries from jsdelivr:
    - **CKEditor 4.22** writes `float` as `style.cssFloat`, so `editor.getData()` saves images without their alignment.
    - **React 18** does the same for `style={{float}}`.
    - **jQuery 1.12**'s `.css({float:'left'})` is lost from `.attr('style')`.
    - **Vue 3.5** writes `filter` as `style.WebkitFilter`, so the filter goes missing (or shows an old value).
    - Dashed names (`style['margin-left']`) and `execCommand` formatting on a script-styled element are lost too.

    It only shows when such a write is the last one to touch the element, since a later camelCase write repairs the mirror. main serialised correctly.
    Cause: `client/dom/css.ts` `touched` plus the `cssAttributesFor` snapshot (#109, #112).
    Repro: [a18/ckeditor4.ts](../packages/scramjet/packages/runway/src/tests/review/a18/ckeditor4.ts) :: `rv18-ckeditor4`; [a18/react-float.ts](../packages/scramjet/packages/runway/src/tests/review/a18/react-float.ts); [a18/vue-style.ts](../packages/scramjet/packages/runway/src/tests/review/a18/vue-style.ts) :: `rv18-vue-style`; [a18/mirror.ts](../packages/scramjet/packages/runway/src/tests/review/a18/mirror.ts) :: `rv18-mirror` (keys `react_float*`, `dashed_nonurl`, `vendor_cap`, `assign_dashed`, `execcommand*`)

37. **`meta.content = x` leaves a stale mirror.** Every parsed `<meta content>` now gets a `scramjet-attr-content` mirror, but `HTMLMetaElement.content` isn't intercepted. After a script updates it, `getAttribute("content")`, `meta[content=...]` selectors and serialization all report the old value. A CSRF token refreshed through `.content` and read back with `getAttribute` (Rails UJS, Laravel/axios snippets) sends the stale token.
    Cause: `shared/htmlRules.ts:170-190` (#112).
    Repro: [a2/stale.ts](../packages/scramjet/packages/runway/src/tests/review/a2/stale.ts) :: `rv2-stale-meta-content` (run without `RUNWAY_FAST`; it compares against bare Chrome)

38. **pushState/replaceState resolve relative URLs against the document URL, not `<base href>`.** On `/deep/dir/page.html` with `<base href="/app/">`, `pushState(null,'','next')` lands on `/deep/dir/next` instead of `/app/next`. This affects Angular/AngularJS html5Mode apps served from deep links and query-only pagination.
    Cause: `client/dom/history.ts:43` (#110).
    Repro: [a7/history-base.ts](../packages/scramjet/packages/runway/src/tests/review/a7/history-base.ts) :: `rv7-history-base-href`

39. **`history.replaceState`/`pushState` with a URL throws SecurityError in srcdoc and about:blank iframes.** The check compares `origin`, and `new URL("about:blank").origin` is `"null"`, instead of applying the spec's "can have its URL rewritten" rule. `replaceState(s, '', location.href)` from router or analytics code inside srcdoc embeds or JS-built frames now throws. blob: documents are unaffected, and a hash-only `pushState('#x')` in about:blank already threw on main.
    Cause: `client/dom/history.ts:45-62` (#110).
    Repro: [a7/history-frames.ts](../packages/scramjet/packages/runway/src/tests/review/a7/history-frames.ts) :: `rv7-history-srcdoc-blob`; [a7/css-nav-probe2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe2.ts) :: `rv7-probe2` (`about_blank_*`)

40. **Nodes from a realm scramjet hasn't hooked yet get stringified by IDL unions.** For example, `document.body.append(frames[0].document.createElement("b"))` inserts the text `[object HTMLElement]`, and `d.after(node)` does the same. `appendChild`/`insertBefore` aren't unions, so they still work. The union branch is chosen with `box.instanceof`, which only knows registered realms, and a realm reached through `frames[i]`, `window[0]` or `event.source` isn't hooked until the `contentWindow` trap fires. Text and DocumentFragment nodes are stringified too, not just Elements. `cache.put`/`cache.match` with a Request from such a realm key on `"[object Request]"` and miss, where main got this right. `fetch()` of such a Request stringifies on main as well, so that part isn't new. A BroadcastChannel opened through an unhooked `window[0]` can't reach the page on develop, because channel names are now scoped per site. This hits friendly-iframe ad/analytics helpers and editors that build DOM in an iframe document.
    Cause: `client/webidl.ts:1175-1224`, `client/singletonbox.ts:202` (#102).
    Repro: [a1/core.ts](../packages/scramjet/packages/runway/src/tests/review/a1/core.ts) :: `rv1-union-node-from-unhooked-frame`; [a10/foreign.ts](../packages/scramjet/packages/runway/src/tests/review/a10/foreign.ts) (key `after_foreign`); [a17/realms.ts](../packages/scramjet/packages/runway/src/tests/review/a17/realms.ts) :: `rv17-realms-unhooked` (run without `RUNWAY_FAST`)

41. **Cache API calls in about:blank, srcdoc and blob: documents reject relative URLs** with "Failed to construct 'URL': Invalid URL". `caches.ts` resolves against `client.url` (`about:blank`) rather than the document base, and it ignores `<base href>` too.
    Cause: `client/shared/caches.ts:52-55` (`new _URL(request, client.url)`) (#107).
    Repro: [a5/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a5/misc.ts) :: `rv5-misc-cache-in-about-blank-frame`

42. **URL-reflecting getters return raw relative strings inside `window.open("")` popups.** For example, `a.href` reads `/p` and `img.src` reads `x.png`, where main and Chrome give absolute URLs. The reflect layer only inherits a base URL through `frameElement`, and a popup doesn't have one. This affects print views, receipts and editor preview windows built with `document.write`.
    Cause: `client/dom/reflect.ts:81-99, 130-145` (#112).
    Repro: [a1/core.ts](../packages/scramjet/packages/runway/src/tests/review/a1/core.ts) :: `rv1-popup-about-blank-base-url`

43. **Script-set `javascript:` iframe URLs throw `ReferenceError: $scramjet$pushsourcemap is not defined`.** Client-side rewrites without a client argument now get the pst prelude, and a `javascript:` URL runs in a fresh document with no client. The very common placeholder forms, `iframe.src = "javascript:void(0)"`, `"javascript:false"` and `setAttribute("src", "javascript:…")`, now raise an uncaught error per frame. The completion-value form, `iframe.src = "javascript:'<b>yo</b>'"`, leaves an empty frame, which hits editor, ad and widget frames. Parser-inserted `<iframe src="javascript:…">` was already broken on main.
    Cause: `shared/rewriters/js.ts:118-141` plus `shared/rewriters/url.ts:138-147` (#113).
    Repro: [a8/rewriter.ts](../packages/scramjet/packages/runway/src/tests/review/a8/rewriter.ts) :: `rv8-javascript-url-iframe`; [a8/p2-frames.ts](../packages/scramjet/packages/runway/src/tests/review/a8/p2-frames.ts) :: `rv8p2-frame-javascript-src-void`, `-false`, `-string-attr`

44. **Page assignments to `Error.prepareStackTrace` are silently ignored.** `cleanErrors` now defaults to true, which installs a setter that does nothing, so code that installs its own formatter to get CallSites gets a string instead and throws. That covers the `callsites`/`depd`/`source-map-support` pattern and zone.js error patches. Reading `Error.prepareStackTrace` also hands the page a scramjet function.
    A side effect: for every stack frame whose name comes from a `//# sourceURL` outside the proxy prefix, each `.stack` read logs a styled `console.error` ("unrewriteurl: unexpected url") and captures another stack. That covers webpack/Vite eval-devtool builds, Closure `sourceURL`s, and scramjet's own `encapsulateWorkers` output, which appends `//# sourceURL=<real url>` to every worker. On a live site, Wikipedia search logs 28 of these on develop and 0 on main (MediaWiki's eval'd modules carry real-URL `sourceURL`s). Measured: 50 webpack eval-devtool modules with 200 stack reads log 0 `console.error`s on main and 200 on develop, at 18ms vs 56ms. zone.js frames are named by proxy URLs, so zone.js doesn't trigger it. Inside workers every script carries the `//# sourceURL=` line that scramjet's worker wrapper appends, so every `.stack` read in a worker takes this slow path: 2000 reads take 450-500ms on develop against 8-13ms on main, with one `console.error` each. Stack formatting in general is about 3x slower.
    Cause: `index.ts` (`cleanErrors: true`, 684e46cf #102), no-op setter at `client/shared/error.ts:94-96`, `client/shared/error.ts:78-85` feeding `shared/rewriters/url.ts:266/286`.
    Repro: [a0/errors.ts](../packages/scramjet/packages/runway/src/tests/review/a0/errors.ts) :: `rv0-prepare-stack-trace-assignable`, `rv0-prepare-stack-trace-reads-back`

45. **WebSocket handshakes drop Lax/Strict session cookies for same-site socket hosts.** The new cookie filter decides same-site with `registrableDomainForRedirect`, which strips a leading `www.` and otherwise takes the last two labels. So `www.example.co.uk` → `ws.example.co.uk` and `www.shop.example.com` → `ws.example.com` are treated as cross-site.
    Cause: `client/shared/requests/WebSocket.ts:218-247`, `fetch/fetch.ts:293`.
    CONFIRMED (main sent the page's cookies unfiltered, so all three). From `www.example.co.uk` to `ws.example.co.uk`, and from `www.shop.example.com` to `ws.example.com`, develop sends only the `SameSite=None` cookie. The main culprit is the `www.` stripping, more than the missing public-suffix list; `app.example.co.uk` and `www.example.com` pairs are fine. Repro: [a6/qa-ws.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa-ws.ts) :: `rv6-qa-ws-*`

46. **Responses synthesized by a `hooks.fetch.intercept` tap carry no `x-scramjet-*` carrier headers,** so every `response.headers.get()` and `xhr.getResponseHeader()` reads null. Headers changed by `hooks.fetch.response` taps after the carriers were built read stale too. This only affects embedders using those hooks.
    Cause: `fetch/fetch.ts:38-50`.
    CONFIRMED: main `{interceptedHeader:"yes", interceptedCT:"text/plain", xhr:"yes"}`, develop all null. No in-tree plugin reads these, so only third-party embedders are affected. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-intercept-carriers`

47. **Storage isolation between proxied sites can be bypassed by redefining `URL.prototype.origin`** (security; isolation regression: main wasn't vulnerable). develop keys localStorage, sessionStorage, caches, IDB names and BroadcastChannel names on `client.scopeOrigin`, which reads `.origin` off a `_URL`. `makeWrap` returns `new Proxy(ctor, {})`, so instances still use the page-writable `URL.prototype`. A page that redefines the getter can read and plant another site's storage. The same pattern affects `_Map`/`_Set`/`_WeakMap`/`_Headers`/`_RegExp` instances, which undercuts the c5d59ce5 snapshot hardening.
    Cause: `shared/snapshot.ts:521-539`, `client/client.ts:648-700`.
    CONFIRMED. Repro: [a1/isolation.ts](../packages/scramjet/packages/runway/src/tests/review/a1/isolation.ts) :: `rv1-storage-scope-spoof-url-origin`

48. **CookieStore is now exposed, but `change` events never fire.** Main deleted `window.cookieStore`, so feature-detecting sites fell back to `document.cookie`. develop exposes it, but `cookieStore.set/delete`, `document.cookie =` and `Set-Cookie` never dispatch `change`, so cross-tab session sync silently stops. Native change events for the proxy origin's own cookies can still reach the page (a small leak).
    Cause: `client/dom/CookieStore.ts`.
    CONFIRMED. Repro: [a4/net4.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net4.ts) :: `rv4-d-cookiestore-change`, `rv4-d-cookiestore-onchange-docookie`

49. **Exporting a live inline SVG that uses `xlink:href` now produces unparseable SVG, so svg-to-image export fails.** develop adds a `scramjet-attr-xlink:href` mirror to `<use>`, gradients and similar elements, so `XMLSerializer` output of the page's own SVG carries an undeclared namespace prefix. Loading that string as an image (a data: or Blob URL: the usual svg-to-png, "download chart" or "copy as image" path in charting libraries, diagram editors and icon tools) fails on develop, and works on main and in Chrome. It's the same root cause as the DOMParser XML item, but on the output side, with no DOMParser involved.
    Repro: [a13/svgexport.ts](../packages/scramjet/packages/runway/src/tests/review/a13/svgexport.ts) :: `rv13-svg-export` (labels `s1 as image`, `s1 as blob image`; run without `RUNWAY_FAST`)

50. **Sandboxed `srcdoc` frames now get the embedding site's storage and report its origin** (security). `<iframe sandbox="allow-scripts" srcdoc>` is the standard way to render untrusted HTML: previews, email bodies, user content. `scopeOrigin`/`siteOrigin` ignore the `sandboxedOrigin` flag develop already captures, so the frame can read and overwrite the host's localStorage (auth tokens), sessionStorage, IndexedDB, Cache API, OPFS and BroadcastChannel, and its `self.origin` is no longer `"null"`. Chrome throws SecurityError; main isolated these frames (by accident).
    Cause: `client/client.ts` `scopeOrigin`/`siteOrigin`.
    Repro: [a19/sandbox.ts](../packages/scramjet/packages/runway/src/tests/review/a19/sandbox.ts) :: `rv19-sandbox-srcdoc-storage`; [a19/matrix.ts](../packages/scramjet/packages/runway/src/tests/review/a19/matrix.ts) :: `rv19-matrix-frames` (cells `k-sandbox-srcdoc`, `i-sandbox`)

51. **On pages that enforce Trusted Types themselves, scramjet's own sink writes now violate the page's policy.** Scramjet strips CSP headers, but a CSP `<meta>` a page inserts with DOM APIs (LinkedIn does this) stays live. develop stringifies Trusted objects, rewrites them and hands the plain string to the native:
    - `script.text = policy.createScript(...)` silently doesn't run, and the violation report shows scramjet's instrumented source;
    - `shadowRoot.innerHTML`, `shadowRoot.setHTMLUnsafe` and `Document.parseHTMLUnsafe` with a TrustedHTML throw "This document requires 'TrustedHTML' assignment". main never hooked these, so they worked.

    Lit and Stencil components rendering into shadow roots lose those renders on such pages. Low-medium.
    Repro: [a25/ttenf.ts](../packages/scramjet/packages/runway/src/tests/review/a25/ttenf.ts) :: `rv25-ttenf-nodefault`; [a25/tt.ts](../packages/scramjet/packages/runway/src/tests/review/a25/tt.ts) :: `rv25-tt-meta` (full sink matrix)

52. **A page's Trusted Types `default` policy now receives scramjet's rewritten code.** Its `createScript` is called with the `{const $=($scramjet$registerrealm(…))}` prelude for script text, `onclick` attributes, `eval`, `setTimeout(string)` and `new Function`, where main passed the page's own text. On develop, `script.text = TrustedScript` also goes through the default policy, which Chrome never does for an already-Trusted value. Policies that allowlist or hash approved scripts reject these (LinkedIn's lets them through). Low.
    Repro: [a25/ttenf.ts](../packages/scramjet/packages/runway/src/tests/review/a25/ttenf.ts) :: `rv25-ttenf-default`

## Low-impact / contrived

53. **Rewriter throws now escape `innerHTML` and the other markup sinks.** Main fell back to the raw markup. For example, `innerHTML = '<base href="http://[bad">…'` throws `TypeError: Failed to construct 'URL'`.
    Cause: `client/dom/markup.ts:99-106`.
    Repro: [a3/rv3-base.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-base.ts) :: `rv3-base-sinks` (label `badbase`, run without `RUNWAY_FAST`)

54. **`fetch`/`new Request`/`new Response` throw on a frozen init whose `headers` is a fetched Response's Headers.** The Proxy `get` invariant is violated. Frozen state (Immer/RTK) and frozen config objects hit this.
    Cause: `client/shared/requests/fetch.ts:100-137` (f37460f9, #105).
    Repro: [a4/net2.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net2.ts) :: `rv4-b-fetch-frozen-init`

55. **An unnamed SharedWorker sees `self.name === "<origin>@"` instead of `""`.** The develop interceptor that should strip the prefix never takes effect, because `name` is an own property of the worker global.
    Repro: [a5/workers.ts](../packages/scramjet/packages/runway/src/tests/review/a5/workers.ts) :: `rv5-sharedworker-no-name`

56. **Accessors installed through `RawTrap` leak their source through `Function.prototype.toString`.** This affects `window.event`, `SVG*Element.prototype.href`, several `on*` handlers and others: the getter prints as `function(){return l.this=this,a(r.get,r,[l])}` with `name === ""` and a `prototype`. It's a fingerprint for anti-bot scripts.
    Repro: [a1/core.ts](../packages/scramjet/packages/runway/src/tests/review/a1/core.ts) :: `rv1-trap-accessors-native-looking`

57. **Rewritten script source leaks through several reads:**
    - Inline handler `el.onclick.toString()` contains `{const $=($scramjet$registerrealm(…))}`.
    - MutationObserver `characterData` records on `<script>`/`<style>` text carry the rewritten source in `oldValue`, and `splitText`/`normalize` there produce `childList` records.
    - `XMLSerializer` on a script shows `scramjet-attr_script-source` and the rewritten code.
    - `<meta http-equiv=refresh>` `content` reads back the proxy URL.

- Custom elements observing `onclick` receive the rewritten handler source in `attributeChangedCallback`, old and new values alike, and `MutationRecord.oldValue` does too (with an extra `scramjet-attr-onclick` record). For customized built-ins, `target="_top"` arrives as the rewritten frame name.

  Repro (run without `RUNWAY_FAST`): develop's own tests `elattr-onclick-attribute-behaviour`, `incumbency-regression-pst-inline-handler-source`, `eltext-xmlserializer`, `elattr-meta-refresh-orders`, and 8 of the 10 `eltext-mutations-*` (`-appenddata-second-child` fails on both builds, and `-textcontent` is the reverse: it fails on main and passes on develop) (`src/tests/adversarial/elementlayer-*.ts`); [a7/subclass-probe3.ts](../packages/scramjet/packages/runway/src/tests/review/a7/subclass-probe3.ts) :: `rv7-subclass3-probe` (`ce_acc_*`, `mo_oldvalue`); [a2/consistency2.ts](../packages/scramjet/packages/runway/src/tests/review/a2/consistency2.ts) :: `rv2-cons2-custom`

58. **Edge cases in script text** (develop's own tests, which pass on main):
    - `Range.setEnd(scriptText, n)` throws IndexSizeError, because appended script text is folded into one node.
    - `moveBefore` of a text node into an empty connected `<script>` executes it.
    - `innerText` of a rendered script doesn't collapse whitespace.
    - `events-handleevent-not-callable-is-reported` (`src/tests/adversarial/events-fidelity.ts`): error reporting for a non-callable `handleEvent` differs (error-report noise only).

    Repro: `eltext-range-tostring`, `eltext-exec-movebefore`, `eltext-exec-currentscript-two-parts`, `eltext-script-rendered-innertext` (`src/tests/adversarial/elementlayer-text.ts`)

59. **`new Audio(null)` requests the URL "null",** and `src` reads back as the proxied `…/null?$top=…`. Chrome keeps `"null"`.
    Repro: [a1/idl.ts](../packages/scramjet/packages/runway/src/tests/review/a1/idl.ts) :: `rv1-idl-edge-args` (audioNull; run without RUNWAY_FAST)

60. **`window.open(url, target, null)` opens a popup window instead of a tab.** The `features` argument lost `[LegacyNullToEmptyString]`, so `null` becomes the string `"null"`, which Chrome treats as a features list. The 3-argument `document.open(url, name, null)` has the same declaration.
    Repro: [a3/rv3-idl2.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-idl2.ts) :: `rv3-idl-dicts` (`open-null-features`), run without `RUNWAY_FAST`

61. **`new WebSocket(url, null)` throws a TypeError.** The protocols union isn't converted, and `validateProtocols` reads `null.length`; Chrome treats `null` as the protocol `"null"`.
    Repro: [a3/rv3-idl.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-idl.ts) :: `rv3-idl-numbers-css` (`ws-proto-null`), run without `RUNWAY_FAST`

62. **`performance.getEntriesByName(name, null)` returns every entry.** It's declared nullable, but Chrome treats `null` as the type `"null"` and returns `[]`.
    Repro: [a3/rv3-idl.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-idl.ts) :: `rv3-idl-numbers-css` (`perf-byname-null`), run without `RUNWAY_FAST`

63. **Unterminated attribute selectors no longer match.** `el.querySelector("a[href")` is valid CSS (the parser closes the bracket at EOF), and main and Chrome return the link. `rewriteAttributeSelectors` splices it into `:is([href:not([scramjet-attr-href]),[scramjet-attr-href])`, which matches nothing.
    Cause: `client/selectors.ts:193-225` (#112).
    Repro: [a2/consistency.ts](../packages/scramjet/packages/runway/src/tests/review/a2/consistency.ts) :: `rv2-cons-selectors` (label "bad"; run without `RUNWAY_FAST`)

64. **`<noscript>` contents are left unrewritten even in scripting-disabled documents** (`createHTMLDocument()`, srcdoc sandboxes without `allow-scripts`), so real `<img>`/`<link>` elements appear unrewritten.
    CONFIRMED: after adopting the node into the live page, develop loads `/rv6ns-a.png` unrewritten from the proxy origin root; main loaded it through the proxy. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-noscript-disabled-doc`

65. **Text-layer probe insertions are visible to MutationObservers.** `reprepare()` appends and removes an empty Text node on a connected script so that it gets prepared, so childList observers see two extra records.
    Cause: `client/text.ts:726-735`.
    CONFIRMED: `script.appendChild(text)` on a connected empty script records 4 mutations on develop against 1 in Chrome and on main. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-mutationobserver-script` (run without `RUNWAY_FAST`)

66. **Legacy comment-wrapped inline scripts (`<script><!-- … //--></script>`) now read back empty.** develop blanks `script.textContent`, `innerHTML` and `childNodes`, where main returned the original source. The script not _running_ at all is pre-existing (bucket 4 #9).
    Repro: [a2/scripttext.ts](../packages/scramjet/packages/runway/src/tests/review/a2/scripttext.ts) :: `rv2-scripttext-parsed` (labels "c", "s5 \*") (run without `RUNWAY_FAST`)

67. **The IDL rejection paths produce error messages that don't match Chrome.** For example, `postMessage("x","*",[1])` gives "Invalid value in Web IDL sequence or record.", enum errors lack the "Failed to construct 'Worker': Failed to read the 'type' property…" prefix, and `setNamedItem({})` gives "Illegal invocation".
    CONFIRMED: all three messages match Chrome on main and differ only on develop (run without `RUNWAY_FAST`). Repro: [a1/idl.ts](../packages/scramjet/packages/runway/src/tests/review/a1/idl.ts) :: `rv1-idl-edge-args`

68. **Brand checks run after argument conversion.** On a wrong receiver, scramjet converts arguments (calling page `toString`/`valueOf`) before throwing Illegal invocation; Chrome throws first, with zero conversions. About 10 `elshape-members-*` interfaces fail on this ordering; the other 11, the SVG ones, fail through the RawTrap `toString` leak listed separately. main never intercepted those members, so the tests pass there. It's observable ordering, not a functional break.
    CONFIRMED. Repro: develop's `elshape-members-*` tests (`src/tests/adversarial/elementlayer-shape.ts`) (run without `RUNWAY_FAST`)

69. **Shadow-root `<style>` text read back through `innerHTML` returns absolutised URLs.** `url(/sh.png)` reads back as `url(http://site/sh.png)` on develop, where main (and Chrome) returned the original. This comes from develop's new `unrewriteCss`. For light-DOM `<style>` both builds are wrong (main leaked the proxy URL, develop gives the absolute site URL; see bucket 4). It only matters to code comparing serialized CSS.
    Repro: [a10/templates.ts](../packages/scramjet/packages/runway/src/tests/review/a10/templates.ts) (key `shadow_innerHTML`; run without `RUNWAY_FAST`)

70. **Every proxied page emits a fake "SharedStorage" deprecation report.** `saveNatives` reads every getter on the global, including `window.sharedStorage`, which queues a Reporting API deprecation report (main `[]`, develop `["deprecation:SharedStorage"]`, bare Chrome `[]`). Sites that forward `ReportingObserver` output to their monitoring get one bogus report per page view, and it's a cheap proxy fingerprint. Neither build strips the site's `Reporting-Endpoints`/`Report-To` headers, so Chrome may also deliver reports to the real site (not observed within 75s headless, so unconfirmed).
    Cause: `client/client.ts:384-408` `saveNatives` (#90).
    Repro: [a11/initside.ts](../packages/scramjet/packages/runway/src/tests/review/a11/initside.ts) :: `rv11-init-side-effects` (run without `RUNWAY_FAST`)

71. **`caches.match("http://[bad")` rejects with a different error message** (still a TypeError).
    Repro: [a12/rv12-misc.ts](../packages/scramjet/packages/runway/src/tests/review/a12/rv12-misc.ts) :: `rv12-misc`

72. **Lone surrogates in script-set inline `on*` attributes and in `CSSStyleSheet.replaceSync` become U+FFFD.** Develop now rewrites both paths and loses the unpaired surrogate; main left them alone. Very low impact.
    Repro: [a17/strings.ts](../packages/scramjet/packages/runway/src/tests/review/a17/strings.ts) :: `rv17-strings-content` (keys `LS.onclickAttr`, `LS.replaceSync`; run without `RUNWAY_FAST`)

73. **SVG, MathML and CSSRule `.style` declarations now throw "Illegal invocation" when passed to a `CSSStyleDeclaration.prototype` method** (`CSSStyleDeclaration.prototype.setProperty.call(svg.style, …)`, `Reflect.apply`, uncurried helpers), and their cached methods ignore `this`: `a.style.setProperty.call(b.style, …)` writes to `a`. main only broke this for HTML elements.
    Repro: [a18/decl.ts](../packages/scramjet/packages/runway/src/tests/review/a18/decl.ts) :: `rv18-decl` (`svg_proto_*`, `rule_proto_*`, `uncurry_setprop`, `svg_method_this`)

74. **SVG and CSSRule `.style` reads and writes are 5-16x slower** (e.g. 50k `svg.style.fill` reads go from 4ms to about 50ms; a D3-style `setProperty` loop is about 2.5x slower). These surfaces are newly wrapped.
    Repro: [a18/decl.ts](../packages/scramjet/packages/runway/src/tests/review/a18/decl.ts) :: `rv18-decl` (`perf_*` keys, which print timings)

75. **Every CSSOM-styled element leaks `scramjet-attr-style` into `XMLSerializer` output,** so a D3 chart styled with `.style()` exports with the hidden attribute (187 to 304 bytes). It still parses and renders.
    Repro: [a18/xmlser.ts](../packages/scramjet/packages/runway/src/tests/review/a18/xmlser.ts) :: `rv18-xmlser`

76. **Serialising a document with a big inline `<style>` is about 5x slower** (`document.head.innerHTML` goes from 9 to 50ms per read at 250KB).
    Repro: [a18/bigstyle.ts](../packages/scramjet/packages/runway/src/tests/review/a18/bigstyle.ts) :: `rv18-bigstyle`

77. **Classic `blob:`/`data:` scripts with `crossorigin` are classified as modules by `isUnmarkedModule`.** If the module rewrite then fails (for example on a legacy `<!--` comment), the script runs unrewritten and sees the raw proxy `location`.
    Cause: `fetch/parse.ts` `isUnmarkedModule`.
    Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-blob-co-htmlcomment`, `rv15-data-co-htmlcomment`

78. **A `data:` URL worker no longer shares BroadcastChannel with its creating page, and loses its IndexedDB/Cache/OPFS data on every new instance.** In Chrome a `data:` dedicated worker gets its creator's origin. develop derives `scopeOrigin` from the `data:` URL, which gives each instance a random `about-opaque://…` scope. So the page's channel is never heard, and each new worker starts with empty storage (orphaning the old copies, plus one extra top-level OPFS directory per worker). main keyed them `null@name`, which was wrong but stable. This hits Monaco and similar editors that spin up `data:` workers.
    Cause: `client/shared/broadcastchannel.ts:15` plus `client/client.ts:721` `scopeOrigin` (b287d785).
    Repro: [a20/dataworker.ts](../packages/scramjet/packages/runway/src/tests/review/a20/dataworker.ts) :: `rv20-dataworker-broadcastchannel`, `rv20-dataworker-idb-persist`

79. **`new SharedWorker(url, 5)` throws a TypeError;** Chrome names the worker `"5"`. `worker.ts` treats every non-string second argument as the options object.
    Cause: `client/shared/worker.ts:54-60`.
    Repro: [a20/edges.ts](../packages/scramjet/packages/runway/src/tests/review/a20/edges.ts) :: `rv20-edges` (key `swNumberName`)

80. **Window `postMessage` drops the `includeUserActivation` option.** develop reads only `targetOrigin` and `transfer` from the options bag and rebuilds the native call from those, so the receiver's `e.userActivation` is `null` where main and Chrome give an object. Check the option's upstream status before prioritising.
    Cause: `client/shared/postmessage.ts:21-25, 194`.
    Repro: [a21/options.ts](../packages/scramjet/packages/runway/src/tests/review/a21/options.ts) :: `rv21-opts-window-postmessage` (run without `RUNWAY_FAST`)

---

Out of scope (non-Chrome or non-default incumbency modes), noted so they aren't lost:

- In `lazystamp`/`stamp` modes, the rewrite starts statements with `(`, so ASI calls the previous line. Repro: [a8/rewriter.ts](../packages/scramjet/packages/runway/src/tests/review/a8/rewriter.ts) :: `rv8-asi-*`
- `lazystamp` attributes postMessage to the wrong window for `.call`/`.apply`/bound/aliased calls. Repro: `a6/pm-frames.ts.off`
- On Firefox, inline style property writes are never rewritten. Repro: [a7/css-nav-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe.ts)
