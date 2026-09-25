# Bucket 4: pre-existing bugs (broken on main and develop alike)

These are unrelated to, or unchanged by, the develop work. Each is CONFIRMED on both builds (fails on main, fails identically on develop) unless marked otherwise. Ordered by real-site impact. Repro paths are relative to `packages/scramjet/packages/runway/src/tests/review/`.

## High impact

1. **The `AsyncFunction`, `GeneratorFunction` and `AsyncGeneratorFunction` constructors return a Promise or generator instead of a function.** This kills Alpine.js outright. `rewriteFunction` builds its `return <fn>` wrapper with `ctx.fn`, the intercepted constructor itself, so for `AsyncFunction` the wrapper is async and calling it yields `Promise<fn>`. Alpine compiles every directive with `new AsyncFunction(...)` and swallows the failure, so `x-data` components silently never render. The same goes for EJS `async:true` and REPL/sandbox libraries. It's a one-line fix: build the wrapper with the plain captured `Function`.
   Cause: `client/shared/function.ts:4-21`.
   Repro: [a0/fnctors.ts](../packages/scramjet/packages/runway/src/tests/review/a0/fnctors.ts) :: `rv0-fnctor-async`, `-generator`, `-asyncgenerator`; [a0/frameworks.ts](../packages/scramjet/packages/runway/src/tests/review/a0/frameworks.ts) :: `rv0-fw-alpine`; [a0/alpine.ts](../packages/scramjet/packages/runway/src/tests/review/a0/alpine.ts) :: `rv0-alpine-probe`; [a8/rewriter.ts](../packages/scramjet/packages/runway/src/tests/review/a8/rewriter.ts) :: `rv8-async-generator-function-ctors`

2. **`rewriteSrcset` drops every candidate except the first and last, plus the first candidate's descriptor.** The greedy `srcset.split(/ .*,/)` turns `"/s.jpg 300w, /m.jpg 600w, /l.jpg 1200w"` into `"<s>, <l> 1200w"`. Every responsive image with three or more candidates (WordPress, Next/Image, CDNs) picks the wrong resource or is dropped. Commas inside URLs (Cloudinary) break it too.
   Cause: `shared/rewriters/html.ts` `rewriteSrcset`.
   Repro: [a2/srcset.ts](../packages/scramjet/packages/runway/src/tests/review/a2/srcset.ts) :: `rv2-srcset-candidates`

3. **`url(#fragment)` in stylesheets, `style` attributes, `setProperty` and `cssText` is rewritten into an external reference,** so SVG gradients, clip-paths, masks, filters and markers applied through CSS don't render. This is very common in icon sets and charts. It shares a root cause with bucket 1 #15, and one fix (skip fragment-only URLs in `handleCss`) covers both.
   Repro: [a7/css-svg-frag.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-svg-frag.ts) :: `rv7-svg-fragment-fill`

4. **Documents served as XML (`application/xhtml+xml`, `image/svg+xml`, `text/xml`) aren't rewritten at all** (sandbox escape). They get no client, so their inline scripts run raw in the proxy origin with access to every proxied site's storage and cookies. One `.svg` is enough. HTML loaded through `<frame>` (framesets), and probably `<object>`/`<embed>`, is also unrewritten.
   Cause: `fetch/body.ts:32-53`.
   Repro: [a3/rv3-xmldoc.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-xmldoc.ts) :: `rv3-xmldoc-xhtml`, `rv3-xmldoc-svg` (run without `RUNWAY_FAST`); [a3/rv3-frames.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-frames.ts) :: `rv3-frames-object-embed-frame`

5. **Scripts and requests from about:blank and `document.write`-built ("friendly") iframes get a 404.** A `<script src>` or `fetch("/x")` from such a frame goes out tagged `$io=null` and the SW returns 404; inline scripts still run. This is the Google Publisher Tag / ad-tech friendly-iframe pattern and sandboxed widget loaders. srcdoc frames' fetches aren't rewritten at all: relative `new Request()`, fetch and XHR there use the proxy's own origin, and `new Request("echo?b").url` even reads back as `"echo"`.
   Repro: [a5/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a5/frames.ts) :: `rv5-frames-friendly-iframe-dom-script-src`, `-document-write`, `rv5-frames-about-blank-fetch-relative`; [a5/friendly.ts](../packages/scramjet/packages/runway/src/tests/review/a5/friendly.ts) :: `rv5-friendly-debug`; [a4/net3.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net3.ts) :: `rv4-c-srcdoc-fetch`, `rv4-c-aboutblank-fetch`; [a17/srcdocreq.ts](../packages/scramjet/packages/runway/src/tests/review/a17/srcdocreq.ts) :: `rv17-srcdoc-requests`

6. **Module workers are broken.** A static `import` inside a `{type:"module"}` worker fails, and blob: module workers get `importScripts` injected and throw. This covers Vite and webpack 5 `new Worker(new URL(...), {type:"module"})` output.
   Repro: [a5/adv-workers.ts](../packages/scramjet/packages/runway/src/tests/review/a5/adv-workers.ts) :: `rv5adv-workers-module-with-static-import`; [a5/workers.ts](../packages/scramjet/packages/runway/src/tests/review/a5/workers.ts) :: `rv5-worker-blob-module`, `rv5-worker-module-dynamic-import`; [a6/worklets.ts](../packages/scramjet/packages/runway/src/tests/review/a6/worklets.ts) :: `rv6-wl-module-worker`

7. **The same ES module is instantiated twice when reached through two paths.** For example, `preact/+esm` plus `preact/hooks/+esm` throws `reading '__H'`, because hooks sees a different preact instance. This risks every ESM singleton: preact, React contexts, lit, the Svelte runtime.
   Repro: [a0/frameworks.ts](../packages/scramjet/packages/runway/src/tests/review/a0/frameworks.ts) :: `rv0-fw-preact-htm`

8. **`innerHTML` on RCDATA/raw-text elements** (textarea, title, noscript, xmp, iframe, noembed) **injects proxy URLs and `scramjet-attr-*` into the element's text.** The entity-decoding idiom `t = document.createElement('textarea'); t.innerHTML = s; t.value` returns corrupted strings whenever `s` contains tags.
   Repro: [a2/consistency3.ts](../packages/scramjet/packages/runway/src/tests/review/a2/consistency3.ts) :: `rv2-cons3-rcdata` (run without `RUNWAY_FAST`)

9. **Inline scripts lose every `<!-- ... -->` sequence before rewriting,** even inside string literals. The legacy `<script><!-- ... //--></script>` idiom leaves an empty program. (On develop the element's text also reads back empty, a regression listed in bucket 1.) `document.write('<!--[if IE]>...')` strings are corrupted.
   Cause: `shared/rewriters/html.ts` `js.replace(/<!--[\s\S]*?-->/g, "")`.
   Repro: [a2/scripttext.ts](../packages/scramjet/packages/runway/src/tests/review/a2/scripttext.ts) :: `rv2-scripttext-parsed` (run without `RUNWAY_FAST`)

10. **Clicking an in-page hash link reloads the page.** Clicking `<a href="#x">` sends a new GET and re-runs the page (`location.href`/`assign`/`replace` with `"#x"` pass in isolation), with no `hashchange` in the original document; only `location.hash = "x"` works in place. This breaks hash-routed SPAs (older Angular/Vue/Backbone routers), in-page anchors and table-of-contents links, and state is lost on every click.
    Repro: [a4/navhash.ts](../packages/scramjet/packages/runway/src/tests/review/a4/navhash.ts) (and the other `navhash*` files; see a4 findings, "Pass 2")

11. **Every removed or navigated iframe realm stays alive for the life of the tab.** `SingletonBox.registerClient` puts each client, its window, document, location, history and intrinsics into strong maps and arrays that never shrink (`box.clients.length` reached 221 after 220 removed frames). That's about 1.2 MB per frame on main, and about 6.6 MB on develop (bucket 1 #28). `innerHTML` writes containing inline scripts also grow about 600 B each, apparently in the sourcemap table.
    Repro: [a6/memory.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memory.ts), [a6/memcount.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memcount.ts)

12. **Every URL rewrite scans the whole document for `<base>`, and for referrer `<meta>`s, so URL-attribute writes are O(DOM size).** The `meta.base` getter runs `document.querySelector("base")` on every read, and `meta.referrerPolicy` runs three `querySelectorAll`s. `setAttribute("href")` costs about 20µs on an empty page and about 200µs inside a 2000-row table. A production React build re-rendering a 2000-row table of links takes 6-30ms bare and about 800ms under scramjet on both builds, and `setAttribute a.href` accounts for 2.4s of the 2.5s. Feeds, tables, search results and infinite scroll all pay this. Fix: cache the base and invalidate it on `<base>` insertion, removal or href change.
    Cause: `client/client.ts` `meta.base` (dev L472-487).
    Repro: [a2/perfreact.ts](../packages/scramjet/packages/runway/src/tests/review/a2/perfreact.ts) :: `rv2-perfreact-rows`; [a2/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a2/perf.ts) :: `rv2-perf-setAttribute-href-2000-anchors`

13. **Code inside `with(obj){…}` can't reach scramjet's injected helpers when `obj` claims every name, so Vue runtime-compiled templates fail.** Vue compiles templates to `new Function("with(_ctx){…}")`, and `_ctx`'s `has` trap claims every identifier. The rewriter's injected `$scramjet$prop`/`$scramjet$wrap`/`$scramjet$rewrite` then resolve against `_ctx` and come back undefined. Allbirds' Shopify product carousel fails with `$scramjet$prop is not a function` on both builds, and so will any in-DOM or string Vue template (petite-vue and Vue's CDN build are common on Shopify and marketing sites).
    Repro: [a7/with-scope.ts](../packages/scramjet/packages/runway/src/tests/review/a7/with-scope.ts) (passes in bare Chrome, fails on both builds)

14. **`fetchLater()` isn't intercepted.** An absolute URL goes straight to the real origin, bypassing the proxy, which leaks the user's IP in a real deployment.
    Repro: [a7/fetchlater.ts](../packages/scramjet/packages/runway/src/tests/review/a7/fetchlater.ts)

15. **A relative `<base href>` (`"./"`, `"assets/"`) is resolved against the origin, not the document URL,** so every client-side rewritten request goes to the wrong path. On `/deep/dir/page.html` with `<base href="./">`, a script-inserted `<script src="chunk.js">` loads `/chunk.js`, and `fetch('echo/rel')` requests `/echo/rel`; Chrome uses `/deep/dir/…`. `<base href="./">` is the default for SPA builds deployed under a subpath (GitHub Pages project sites, CRA `homepage: "."`, Ionic/Capacitor and Flutter web), so lazy chunks, images and API calls 404. develop's reflect layer now reads `a.href` back correctly, while the request still goes to the wrong place. The SW side resolves correctly.
    Cause: `client/client.ts` `meta.base` (`new _URL(url, client.url.origin)`; should be `client.url`).
    Repro: [a10/base.ts](../packages/scramjet/packages/runway/src/tests/review/a10/base.ts) :: `rv10-base-relative-dot`, `rv10-base-relative-sub` (keys `script_load`, `fetch_rel`)

16. **Event-handler content attributes missing from `eventAttributes` run unrewritten against the real globals** (escape). This covers `<body onbeforeunload/onunload/onpageshow/onhashchange/onpopstate/onmessage/onstorage/…>`, plus `oncommand`, `onbeforecopy/cut/paste` and `onanimationcancel`. Their code sees the raw proxy `location`.
    Repro: [a13/handlers.ts](../packages/scramjet/packages/runway/src/tests/review/a13/handlers.ts) :: `rv13-handlers-unlisted`

17. **`<form target=_top>`, `formtarget=_top`, `target="_TOP"` (any case) and `_parent` in the top proxied frame navigate the real top window, replacing the browser.js UI.** The `target` rule only covers `a` and `base`, and only matches lowercase `_top`.
    Repro: [a13/targets.ts](../packages/scramjet/packages/runway/src/tests/review/a13/targets.ts) :: `rv13-target-form-top`, `-formtarget-top`, `-a-TOP`, `-a-Top-js`, `-base-target-TOP`, `-a-PARENT-in-top`, `-form-parent-in-top`

18. **`iframe sandbox` is stripped outright,** so sandboxed content runs scripts, reads `parent.document`, writes cookies and storage, and opens popups (security).
    Repro: [a13/sandbox.ts](../packages/scramjet/packages/runway/src/tests/review/a13/sandbox.ts) :: `rv13-sandbox-restrictions`

19. **`document.execCommand("insertHTML")`, `insertImage` and `createLink` bypass rewriting,** so inline handlers in the inserted markup run raw (escape; this affects every contenteditable editor that uses execCommand).
    Repro: [a13/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a13/misc.ts) :: `rv13-misc-editing`

20. **`@namespace url(...)` is rewritten into a proxy URL, so every rule in that stylesheet stops matching.** It hits external sheets, `<style>` text and `insertRule` (SVG and MathML stylesheets, XHTML-style CSS).
    Repro: [a18/regex.ts](../packages/scramjet/packages/runway/src/tests/review/a18/regex.ts) :: `rv18-regex` (`namespace_*`)

21. **Re-exports from a bare specifier (`export * from "dep"`, `export { x } from "dep"`) are rewritten as URLs, so the module graph fails to link.** The Rust visitor rewrites export sources unconditionally. This breaks import-map packages that re-export, such as jspm-served lit and Stimulus-style index files: anything loading ESM without a build step.
    Repro: [a16/mod7.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod7.ts) :: `rv16-reexport-bare`, `rv16-reexport-bare-inline`; [a16/jspm.ts](../packages/scramjet/packages/runway/src/tests/review/a16/jspm.ts)

22. **Pages without an explicit `<html>` tag render in quirks mode.** For example `<!DOCTYPE html><body>…` or `<!doctype html><meta charset=utf-8>…`. Layout differs everywhere, and TinyMCE 5 refuses to initialize.
    Repro: [a14/quirks.ts](../packages/scramjet/packages/runway/src/tests/review/a14/quirks.ts) :: `rv14-quirks-*`; [a14/editors.ts](../packages/scramjet/packages/runway/src/tests/review/a14/editors.ts) :: `rv14-editor-tinymce`

23. **Touching any unnamed iframe breaks `target=_top` for the whole page.** The controller's `injectScramjet` renames the _parent's_ `window.name`, so from then on every `target=_top` link, form or `window.open` from any iframe opens a new window. This affects the scramjet controller only; browser.js's inject doesn't rename.
    Unchanged on 9ea38938 (the parent's name still changes and a new page opens).
    Repro: [a14/topname.ts](../packages/scramjet/packages/runway/src/tests/review/a14/topname.ts) :: `rv14-topname`

24. **Popups stop working once their opener navigates away:** listeners, timers, workers and `postMessage` in the popup all stop.
    Repro: [a14/openerdeath.ts](../packages/scramjet/packages/runway/src/tests/review/a14/openerdeath.ts) :: `rv14-openerdeath-navigate`

25. **Cookies set in JS often miss the next request.** After `document.cookie = x`, the immediately following fetch or XHR frequently goes out without the cookie (a race, so it's intermittent).
    Repro: [a14/cookierace.ts](../packages/scramjet/packages/runway/src/tests/review/a14/cookierace.ts) :: `rv14-cookie-race` (may pass by luck), [a14/cookierace-kids.ts](../packages/scramjet/packages/runway/src/tests/review/a14/cookierace-kids.ts) :: `rv14-cookie-race-kids`

26. **Responses with no `Content-Type` are served unrewritten.** Chrome sniffs them as HTML, but scramjet passes the bytes through, so the frame gets no client and its images and iframes load straight from the real origins, bypassing the proxy. On imgur, ad cookie-sync iframes sent about 70 unproxied pixel requests per page load. The Google ad-script 404s on skribbl, globo and yahoo.co.jp come from the friendly-frame item above instead.
    Cause: `fetch/body.ts:31-50`.
    Repro: [a23/noct.ts](../packages/scramjet/packages/runway/src/tests/review/a23/noct.ts) :: `rv23-noct-iframe` (run without `RUNWAY_FAST`)

27. **`var {location: b} = obj` throws `ReferenceError: $scramjet$temploc is not defined`.** The JS rewriter treats the `location` key in a `var` destructuring pattern as an assignment target (`let`, `const` and parameter patterns are fine). This kills Transcend's airgap.js consent manager on notion.com.
    Repro: [a23/destructure-location.ts](../packages/scramjet/packages/runway/src/tests/review/a23/destructure-location.ts) :: `rv23-destructure-location-var-single`

## Medium impact

28. **WebSocket inside a Worker throws** `Cannot read properties of undefined (reading 'getCookies')`, because `cookieJar` is undefined in workers.
    Repro: [a4/net2.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net2.ts) :: `rv4-b-ws-in-worker`

29. **`StorageEvent.storageArea` is the raw area, not the `localStorage` wrapper,** so `if (e.storageArea !== localStorage) return` guards (Mantine and several use-local-storage hooks) ignore every cross-tab update. `new StorageEvent(..., {storageArea: localStorage})` throws "Failed to convert value to 'Storage'".
    Repro: [a5/storage.ts](../packages/scramjet/packages/runway/src/tests/review/a5/storage.ts) :: `rv5-storage-event-from-child`; [a5/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a5/misc.ts) :: `rv5-misc-synthetic-storage-event`

30. **`import(urlObject)` throws `url.includes is not a function`,** so `import(new URL("./x.js", import.meta.url))` fails; import-map prefix and scope entries also don't resolve for `import()`.
    Repro: [a5/workers.ts](../packages/scramjet/packages/runway/src/tests/review/a5/workers.ts) :: `rv5-import-url-object` (import-map prefix and scope entries for `import()` also fail on main; on develop they fail through bucket 1 #10)

31. **JSON module imports fail:** `import d from "./x.json" with {type:"json"}` gives "Failed to fetch dynamically imported module".
    Repro: [a6/topurl.ts](../packages/scramjet/packages/runway/src/tests/review/a6/topurl.ts) :: `rv6-top-json-module`

32. **`document.write` holds back incomplete elements until they close,** reordering the DOM relative to later scripts. `document.write('<div id=ad>'); getElementById('ad')` is null, and ad iframes that never call `close()` stay blank.
    Repro: [a3/rv3-docwrite.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-docwrite.ts) :: `rv3-docwrite-parse`, `rv3-docwrite-createdoc` (run without `RUNWAY_FAST`)

33. **A CSP `<meta>` is replaced by a comment built from its raw content,** so `-->` inside it breaks out and injects unrewritten markup (sandbox escape by a hostile page).
    Cause: `shared/rewriters/html.ts:528-533`.
    Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-csp-meta-breakout`

34. **`javascript:` URLs are matched case-sensitively and without trimming,** so `JavaScript:`, ` javascript:` and `JAVASCRIPT:` run raw, unrewritten JS.
    Cause: `shared/rewriters/url.ts:138`. `java\tscript:` also runs raw.
    Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-javascript-case`

35. **Content-attribute message handlers get the raw internal envelope as `event.data`.** This covers `<body onmessage>` and `setAttribute("onmessage")`; on develop the envelope also exposes `$scramjet$clientid`/`$scramjet$target`. Setting `returnValue`/`cancelBubble` on a wrapped message, hashchange or storage event throws "Illegal invocation", and so do `Event.prototype`/`MessageEvent.prototype` members called with a wrapped event (`.call(e)`) and `dispatchEvent(e)`. srcdoc BroadcastChannel senders report origin `"null"`, and `DataCloneError` messages quote rewritten function source.
    Repro: [a6/events2.ts](../packages/scramjet/packages/runway/src/tests/review/a6/events2.ts) :: `rv6-ev2-body-onmessage-attr`, `rv6-ev2-setattr-onmessage`, `rv6-ev2-wrapped-event-setters`

36. **No-semicolon `location = x` after an expression line calls that line** (ASI). The rewrite of `location =` starts with `(`.
    Repro: [a8/rewriter.ts](../packages/scramjet/packages/runway/src/tests/review/a8/rewriter.ts) :: `rv8-asi-location-assign`

37. **`XMLSerializer` output leaks `scramjet-attr-*` attributes and proxied URLs,** so SVG export features (d3 charts, svg-to-png via canvas) bake internal attributes into user files. More generally, MutationObservers see `scramjet-attr-src`/`-href` records on URL attribute writes. That's the same class as bucket 1 #14, but pre-existing for `src`/`href`.
    Repro: [a0/frameworks.ts](../packages/scramjet/packages/runway/src/tests/review/a0/frameworks.ts) :: `rv0-fw-d3-svg`; [a7/css-nav-probe2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-nav-probe2.ts) :: `rv7-probe2` (`mo_*`)

38. **Navigation fidelity:**
    - Relative links after `history.pushState` resolve against the original URL, not the pushed one.
    - In redirect chains only the first hop sends Referer, and the final page's `document.referrer` is the last redirect URL.
    - A GET form with no `action` keeps the current query string instead of replacing it.
    - Popups get an empty `document.referrer`, and a `window.open("")` popup reports the opener's URL.
    - `<meta name=referrer content=no-referrer>` doesn't clear `document.referrer`.
    - The proxied top page's `window.name` is the frame's random id instead of `""`.
    - An iframe's `document.referrer` is always `""`. After `pushState`, the `Referer` header and the next page's `document.referrer` still show the original URL. `location.pathname` setters, `assign`, `replace` and query-only `href` navigations leave `document.referrer` empty (a22).

    Repro: `navlinks.ts`, `navforms.ts`, `navhist.ts`, `navpop.ts`, `navmisc.ts` in [a4/](../packages/scramjet/packages/runway/src/tests/review/a4/) (see a4 findings, "Pass 2")

39. **Blob workers can't `importScripts` relative or `data:` URLs.** A relative `importScripts` inside a blob worker resolves against the proxy origin. The SW's four-step bootstrap installs the client before the page's own `data:` script is imported, and scramjet's `importScripts` interceptor then rewrites that `data:` URL into the proxy prefix, so the load fails. Cloudflare Turnstile's worker fails this way on both builds (develop sometimes fails one step earlier, at the virtual `scramjet.wasm.js` import; that variant is PLAUSIBLE and likely a timing issue).
    Repro: live, stackoverflow.com and Turnstile. See a1 findings, "Pass 2"; [a1/sites.ts](../packages/scramjet/packages/runway/src/tests/review/a1/sites.ts)

40. **browser.js frontend gaps (both builds):**
    - Page `message` listeners receive the frontend's internal RPC messages.
    - Ctrl-click on a link opens a real browser window outside browser.js instead of a background tab.
    - Most sites log UI errors: a cross-origin SecurityError from `findSequence`, and a null `.reduce` in `reduceSequence` (Stack Overflow, vuejs.org).
    - "No tab found for blob fetch" appears on Twitch and Amazon, and "t.interface.getInjectScripts is not a function" on Amazon.

    See a8 findings, "Pass 4" and "Pass 5".

41. **`import.meta.resolve()` ignores import maps** and resolves the key as a plain relative URL. Parcel 2 uses it for images, workers and lazy stylesheets, so those 404 and lazy routes that need CSS never finish (the same on both builds).
    Cause: `client/shared/import.ts:76-80`.
    Repro: [a3/rv3-apps.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-apps.ts) (Parcel app)

42. **`new Audio(url)` writes the proxied URL into the content attribute,** so `getAttribute("src")` and `outerHTML` show `http://proxy/~/sj/...`. Setting `audio.src = x` reads back correctly. (The `new Audio(null)` part is a develop regression, in bucket 1.)
    Cause: `client/dom/Audio.ts` on develop (the same leak existed on main).
    Repro: probe (see a1 findings)

43. **Scripts with `referrerpolicy` sometimes 404 on real CDNs.** naver's `gfp-display-safeframe.js` and booking's `id5-api.js` come back as 404 HTML through the proxy on both builds, though `curl` returns 200 and a local copy loads fine. `referrerpolicy` alone isn't the cause: every policy (and a `<meta name=referrer>`) loads a jsDelivr script fine on both builds. The likeliest explanation is the CDNs' hotlink checks rejecting the `Referer` scramjet sends for those requests.
    PLAUSIBLE. Repro: live sites; controls [a7/refpolicy.ts](../packages/scramjet/packages/runway/src/tests/review/a7/refpolicy.ts), [a0/refpol.ts](../packages/scramjet/packages/runway/src/tests/review/a0/refpol.ts) :: `rv0-refpol-cdn-script`

44. **Wikipedia throws "module already implemented" after a reload or in-frame navigation (both builds).** In browser.js the eval'd ResourceLoader module code arrives truncated mid-statement after a reload, so the rewriter fails to parse it. Navigating Main_Page → search → article in one frame gives about 30 such page errors on each build. In plain page loads it starts once MediaWiki's localStorage module cache is populated, so every load after the first fails; plain Chromium shows no errors. Repro: [a23/wiki.ts](../packages/scramjet/packages/runway/src/tests/review/a23/wiki.ts) :: `rv23-wiki-second-load-navigate`.
    Repro: live, en.wikipedia.org reload. See a8 findings, "Pass 5".

45. **Setting `srcdoc` on an iframe inside an about:blank or srcdoc document throws "Invalid URL".** The srcdoc rule does `new _URL(meta.origin.origin)`, and that origin is `"null"` for about: documents, so it throws instead of using the inherited creator base. PerimeterX (`ri.px-cloud.net`, used on LinkedIn and many shopping sites) hits it, and the uncaught error shows up on LinkedIn on both builds.
    Cause: `shared/htmlRules.ts:129-130`.
    Repro: [a9/probe-srcdoc.ts](../packages/scramjet/packages/runway/src/tests/review/a9/probe-srcdoc.ts) :: `rv9-probe-srcdoc-nested`

46. **Very large documents never render: cnn.com (6.4 MB of HTML) stays blank for over 240s on both builds.** Headers arrive in about 200ms. Size alone isn't the cause: a synthetic 6.5 MB document (54k rows of links and images) renders completely on both builds in about 10s, and running cnn.com's saved 5.6 MB HTML through either build's `rewriteHtml` takes about 210ms. So the stall is in page runtime or network behaviour specific to cnn.com, not the HTML rewrite. Not reduced further.
    Repro: live, www.cnn.com (see a9 findings); size control [a0/bigdoc.ts](../packages/scramjet/packages/runway/src/tests/review/a0/bigdoc.ts) :: `rv0-bigdoc-*` (prints its timings)

47. **A page's Trusted Types default policy receives scramjet-rewritten HTML** (high: verified live on linkedin.com/login against bare Chrome). LinkedIn installs a TT `default` policy with a sanitizer, then enforces TT through a dynamically inserted CSP `<meta>`. Every innerHTML write reaches that sanitizer already rewritten (`scramjet-attr-*`, proxied `src`), so it logs "HTML sanitized". LinkedIn's sanitizer drops _any element carrying a `scramjet-attr-_`attribute*, so`innerHTML`keeps only the text of every link, image and styled element, while the same markup without the mirror survives.
    Repro: [a9/probe-tt.ts](../packages/scramjet/packages/runway/src/tests/review/a9/probe-tt.ts) ::`rv9-probe-tt-meta`

48. **`toString()` of a concise arrow function gets a stray trailing `)`.** `String(x => x + 1)` returns `"x => x + 1)"`, so code that serialises an arrow and re-parses it throws a SyntaxError. That includes "run this function in a worker" helpers (useWorker, VueUse `useWebWorkerFn`, greenlet-style) and `new Function("return " + fn)`.
    Cause: the `Function.prototype.toString` proxy in `client/shared/sourcemaps.ts`.
    Repro: [a11/tostring3.ts](../packages/scramjet/packages/runway/src/tests/review/a11/tostring3.ts) :: `rv11-fn-tostring-arrow-minimal`; [a11/tostring2.ts](../packages/scramjet/packages/runway/src/tests/review/a11/tostring2.ts) :: `rv11-fn-tostring-variants`

49. **AudioWorklet processors receive scramjet's internal message wrapper instead of the page's message.** `node.port.postMessage({...})` arrives as `{$scramjet$messagetype, $scramjet$data}`, because the worklet has no scramjet client to unwrap it. Audio apps that send commands to their processor this way (recorders, voice-activity detection, noise suppression, wasm audio engines) silently lose them. Every other worker type unwraps correctly.
    Repro: [a17/messages.ts](../packages/scramjet/packages/runway/src/tests/review/a17/messages.ts) :: `rv17-msg-workers` (keys `audioWorkletPort`, `audioWorkletPortStr`)

## Low impact

50. **amazon.com requests a `data:` URL that was proxied twice,** which comes back as a 500 (both builds). The common `data:` sinks are clean on both builds: img/srcset/picture, preload, `data:` stylesheets, CSS `url()`/`image-set`, inline style, iframe, `new Image`, script, fetch, XHR and Worker. So the trigger is some less common amazon.com path. Not reduced; see a9 findings.
    Control: [a0/dataurl.ts](../packages/scramjet/packages/runway/src/tests/review/a0/dataurl.ts) :: `rv0-dataurl-sinks` (run with `RV_LOG_REQ=1` in the worktree `runway-a0` copies to log proxied `data:` requests)

51. **Proxy URLs leak** through `CSSStyleSheet.href`, `CSSImportRule.href`, `CSSStyleValue#toString`, `ErrorEvent.filename`, `window.onerror` filenames for inserted scripts and EventSource `MessageEvent.origin`, and through `Response.url` in blob: workers. `image-set("/x.png" 1x)` string URLs aren't rewritten.
    Repro: [a7/css-gaps.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-gaps.ts) :: `rv7-css-gaps`; [a6/events.ts](../packages/scramjet/packages/runway/src/tests/review/a6/events.ts) :: `rv6-ev-error-event`; [a4/net.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net.ts) :: `rv4-eventsource`, `rv4-fetch-in-worker`

52. **innerHTML/outerHTML serialization differs from Chrome.** Foreign elements are self-closed (`<svg/>`, `<image .../>`), empty attributes shed `=""`, `<`/`>` in attributes aren't escaped, camelCase SVG attributes are lowercased in `svg.innerHTML`, `<plaintext>` gets a repeated end tag, and innerHTML on an element of an XML document parses as HTML (the setter throws for valid XML).
    Repro: [a0/serialize.ts](../packages/scramjet/packages/runway/src/tests/review/a0/serialize.ts) :: `rv0-ser-svg-image-outerhtml`, `rv0-ser-svg-empty`, `rv0-ser-empty-attr`; [a3/rv3-markup.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-markup.ts) :: `rv3-markup-roundtrip` (run without `RUNWAY_FAST`)

53. **`window.open("")` popups report `document.baseURI` as `about:blank`,** and `location.ancestorOrigins` is undefined.
    Repro: probes (a1 pass-1 probe; see a7 findings, "Minor")

54. **A sandboxed `allow-scripts` iframe reports `self.origin` as the site's origin instead of `"null"`,** and a cookie set in an about:blank child isn't visible to the parent.
    Repro: [a5/frames.ts](../packages/scramjet/packages/runway/src/tests/review/a5/frames.ts) :: `rv5-frames-sandboxed` (main fails an earlier check first)

55. **XHR edge cases:** XHR `upload` progress and load events never fire, `(await fetch(textUtf8)).blob().type` loses `;charset=utf-8`, and XHR streaming delivers its partial-data event only once, at the end.
    Repro: [a4/net.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net.ts) :: `rv4-xhr-upload-progress`; [a4/net2.ts](../packages/scramjet/packages/runway/src/tests/review/a4/net2.ts) :: `rv4-b-blob-type`

56. **The `Refresh:` response header isn't rewritten.**
    Repro: [a3/rv3-refresh-header.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-refresh-header.ts) (run without `RUNWAY_FAST`)

57. **Script decoding ignores the document's legacy fallback encoding when no charset is declared** (it decodes as UTF-8 where Chrome uses windows-1252).
    Repro: [a0/surface.ts](../packages/scramjet/packages/runway/src/tests/review/a0/surface.ts) :: `rv0-surface` (`textEncoderDecoder`)

58. **`&notin` at the end of an attribute decodes to `¬in`** (Chrome keeps it literal), `setTimeout(Symbol())` evaluates the string instead of throwing, and `location.assign = fn` takes effect where it is ignored natively.
    Repro: [a3/rv3-entities.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-entities.ts) (run without `RUNWAY_FAST`)

59. **Assorted fidelity mismatches:**
    - `Function.prototype.constructor !== Function`, so `fn.constructor === Function` checks fail.
    - `Response.redirect("/x")` resolves against the proxy origin.
    - `el.style.backgroundImage = "url(/a.png)"` reads back as an absolute URL (Chrome keeps it as written).

    Repro: [a1/idl.ts](../packages/scramjet/packages/runway/src/tests/review/a1/idl.ts) :: `rv1-idl-edge-args` (run without `RUNWAY_FAST`) for the `Response.redirect` and style read-back cases; `Function.prototype.constructor` came from an a1 probe

60. **Media, object and embed gaps:**
    - `setAttribute("src", "blob:…")` on video, audio or source throws for a malformed blob URL (the media rule calls `unrewriteBlob`).
    - `<object>` never gets a `contentDocument`, and JS-created `<object>`/`<embed>` elements are never requested.
    - `<a ping>` sends no ping.
    - Far-below-the-fold lazy images only load on scroll (bare Chrome prefetches them).
    - `outerHTML` moves `nonce` to the end of the attribute list.

    Repro: [a2/weirdvalues.ts](../packages/scramjet/packages/runway/src/tests/review/a2/weirdvalues.ts) :: `rv2-weird-values`; [a7/media.ts](../packages/scramjet/packages/runway/src/tests/review/a7/media.ts), [a7/media2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/media2.ts)

61. **srcdoc documents resolve relative URLs against the site's origin root,** not the embedding page's URL. The request goes to `/rel.png`, while develop reads `img.src` back as `/deep/dir/rel.png`.
    Cause: the srcdoc rule in `shared/htmlRules.ts`.
    Repro: [a11/srcdoc.ts](../packages/scramjet/packages/runway/src/tests/review/a11/srcdoc.ts) :: `rv11-srcdoc-relative`

62. **Pages with more than one `<base>` resolve URLs inconsistently.** The SW rewrites against the last `<base href>`, and the client against the first `<base>` even when it has no `href`. The browser uses the first one that has an `href`.
    Repro: [a11/base2.ts](../packages/scramjet/packages/runway/src/tests/review/a11/base2.ts) :: `rv11-base-target-then-href`, `rv11-base-two-hrefs`; [a11/parse2.ts](../packages/scramjet/packages/runway/src/tests/review/a11/parse2.ts) :: `rv11-parse-fidelity2`

63. **XPath (`document.evaluate`) sees the rewritten DOM.** `@href`/`@src` predicates never match the page's values, attribute values come back as proxy URLs, mirrors are enumerable, and script text includes the prelude.
    Repro: [a11/xpath.ts](../packages/scramjet/packages/runway/src/tests/review/a11/xpath.ts) :: `rv11-xpath-attrs`; [a13/selectors.ts](../packages/scramjet/packages/runway/src/tests/review/a13/selectors.ts) :: `rv13-selectors` (labels `xpath *`)

64. **Copying from a proxied page puts proxy URLs and `scramjet-attr-*` attributes on the clipboard.** When that's pasted back into a proxied editor, a mirror attribute survives even though Chrome's paste sanitizer removed the real one, so `getAttribute("onclick")` reports a handler that doesn't exist.
    Repro: [a11/clipboard.ts](../packages/scramjet/packages/runway/src/tests/review/a11/clipboard.ts) :: `rv11-clipboard-copy-paste`

65. **Patching-layer odds and ends:**
    - `console.log = fn` is silently ignored.
    - `new Request()` with credentials in the URL doesn't throw.
    - Performance-entry subclass `toJSON` and LCP/element/script-timing URLs aren't intercepted (plausible proxy-URL leak into RUM tools).
    - `window[0]`/`frames[i]` hand the page an unhooked realm, with raw shared storage and native `fetch`. That's the same root as bucket 1 #24.

    Repro: [a12/rv12-misc.ts](../packages/scramjet/packages/runway/src/tests/review/a12/rv12-misc.ts) :: `rv12-misc`; see a12 findings

66. **Fetching attributes with no rule (`background`, `attributionsrc`) go straight to the real origin** (privacy: this bypasses the proxy). Relative values 404 against the proxy origin.
    Repro: [a13/fetchattrs.ts](../packages/scramjet/packages/runway/src/tests/review/a13/fetchattrs.ts) :: `rv13-fetchattrs`

67. **More mirror-layer gaps:**
    - CSS `attr(href)` in stylesheets renders proxy URLs (print stylesheets, generated link text).
    - A served `<video>`/`<audio>`/`<source>` with a malformed `blob:` src stops the whole document from loading.
    - Live values are fixed at write time, so after a `<base href>` change or an adoption into another document the getters follow the new base while clicks and fetches use the old one.

    Repro: [a13/cssattr.ts](../packages/scramjet/packages/runway/src/tests/review/a13/cssattr.ts) :: `rv13-css-attr-function`; [a13/vblob.ts](../packages/scramjet/packages/runway/src/tests/review/a13/vblob.ts) :: `rv13-vblob-video-0`, `-source-0`; [a13/lifecycle.ts](../packages/scramjet/packages/runway/src/tests/review/a13/lifecycle.ts) :: `rv13-life-base-change`, `rv13-life-move`

68. **Storage and cookie gaps (both builds):**
    - Sandboxed `src=` frames without `allow-same-origin` share the embedder's storage and cookies.
    - Methods added to `Storage.prototype` (the common `setObject` idiom) are invisible on `localStorage`/`sessionStorage`: they throw "is not a function".
    - Web Locks and Storage Buckets aren't scoped per site. One site sees and blocks another site's locks, and `storageBuckets` gives an unscoped OPFS root.
    - A path-less cookie set after `pushState` gets the pushed URL's directory as its path (Chrome uses the load URL), so it's lost on other routes. The new CookieStore follows the live URL too.
    - about:blank, srcdoc and `window.open("")` children read no cookies.
    - `document.cookie` accepts `SameSite=None` and `Partitioned` without `Secure`, and has no per-domain limit.

    Repro: [a19/sandbox.ts](../packages/scramjet/packages/runway/src/tests/review/a19/sandbox.ts) (`url` cell), [a19/storage.ts](../packages/scramjet/packages/runway/src/tests/review/a19/storage.ts) :: `rv19-storage-proto-extension`, [a19/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a19/misc.ts) :: `rv19-misc-unscoped-apis`, [a19/cookies.ts](../packages/scramjet/packages/runway/src/tests/review/a19/cookies.ts) :: `rv19-cookie-default-path-after-pushstate`, `rv19-cookie-docookie-semantics`, [a19/matrix.ts](../packages/scramjet/packages/runway/src/tests/review/a19/matrix.ts) :: `rv19-matrix-frames`, `rv19-matrix-popups`

69. **Lone surrogates become U+FFFD in `eval`, `new Function`, script text and string `setTimeout`,** because the JS rewrite round-trips through UTF-8. The markup and CSSOM sinks are correct.
    Repro: [a17/strings.ts](../packages/scramjet/packages/runway/src/tests/review/a17/strings.ts) :: `rv17-strings-content` (keys `LS.eval`, `LS.Function`, `LS.scriptText`, `LS.setTimeoutStr`)

70. **The CSS `url()` regex corrupts non-URL text and some URLs:**
    - it rewrites `url(` inside strings (`content:` text, attribute selectors, font names);
    - its string replacement expands `$&` in URLs and can hit an earlier occurrence of the same text;
    - escaped `\(`/`\"` inside URLs break.

    URLs in `element.animate()` keyframes, `CSS.registerProperty` initial values and `CSSUnparsedValue` are never rewritten, and CSSOM URL writes from scripts inside srcdoc iframes aren't either (the same root as the srcdoc items above).
    Repro: [a18/regex.ts](../packages/scramjet/packages/runway/src/tests/review/a18/regex.ts) :: `rv18-regex`; [a18/cssmatrix.ts](../packages/scramjet/packages/runway/src/tests/review/a18/cssmatrix.ts) :: `rv18-cssmatrix` (`v_content_url`, `v_dollar`, `v_escaped_quote`, `w_animate`, `w_registerProperty`); [a18/srcdoc.ts](../packages/scramjet/packages/runway/src/tests/review/a18/srcdoc.ts) :: `rv18-srcdoc`

71. **Module-loading fidelity gaps:**
    - `import()` throws synchronously, instead of returning a rejected promise, for `undefined`, `Symbol`, objects with `toString`, URL objects and unparsable URLs.
    - `import()` inside `eval`/`new Function` resolves against the document rather than the calling script.
    - Setting `src` before `type="module"` loads the module twice.
    - `import.meta.url` of a `data:` module is percent-encoded.
    - Module error messages show proxy URLs.

    Repro: [a16/mod2.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod2.ts) :: `rv16-import-errors`; see a16 findings, "Smaller module-loading fidelity gaps"

72. **In parent-hooked children, exceptions thrown by `addEventListener` and `message` listeners fire the parent window's `error` event instead of the child's.**
    Repro: [a14/errrealm.ts](../packages/scramjet/packages/runway/src/tests/review/a14/errrealm.ts) :: `rv14-errrealm`

73. **URL and navigation leftovers:**
    - `target=_top` links in iframes that come from the page's own HTML navigate the iframe instead of the top.
    - In srcdoc iframes `import()` gets `$io=null`, so modules there load twice.

    `<a ping>` and `background=` are covered above. Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-static-iframe-top-link`, `rv15-preview-srcdoc`, `rv15-a-ping`, `rv15-background-attr`. (Run `rv15-topnav-basetarget` on its own: on main it navigates the real top window and kills the harness.)

74. **Worker-scope gaps (both builds):**
    - `FontFace` inside a worker isn't intercepted: an absolute font URL goes straight to the real origin (bypassing the proxy), and a relative one 500s.
    - Workers created from srcdoc children are never proxied (404).
    - Blob URLs created in about:blank or srcdoc children become `blob:null/…`, so workers made from them 500.
    - SharedWorkers constructed through a child frame's constructor don't share the parent's instance.
    - Worklet static imports fail.
    - Resource Timing inside workers shows proxy URLs.
    - A cross-origin `new Worker(url)` doesn't throw SecurityError.
    - `import()` in a blob worker throws synchronously.
    - `importScripts` error messages leak proxy URLs.
    - `WebTransport` has no interceptor anywhere (plausible direct connection; not run, it needs an HTTP/3 server).

    Repro: [a20/wnet.ts](../packages/scramjet/packages/runway/src/tests/review/a20/wnet.ts) :: `rv20-wnet`, [a20/scenarios.ts](../packages/scramjet/packages/runway/src/tests/review/a20/scenarios.ts) :: `rv20-sc-*`, [a20/worklets.ts](../packages/scramjet/packages/runway/src/tests/review/a20/worklets.ts) :: `rv20-worklets`, [a20/urls.ts](../packages/scramjet/packages/runway/src/tests/review/a20/urls.ts) :: `rv20-worker-urls`; see a20 findings

75. **Response-header gaps (both builds):**
    - A 304, or any 3xx without `Location`, likely makes the SW throw (`fetch/util.ts:19` counts 304 as a redirect, then `new _URL(null)` at `fetch/fetch.ts:91`), so pages sending their own `If-None-Match` get a 500. PLAUSIBLE: the harness transport crashes on a 304 before this code runs.
    - Duplicate headers collapse to the last value in the header list the browser itself gets (`fromRawHeaders` uses `set`), so `serverTiming` and multiple `Link` preloads lose entries.
    - Named SSE events report the proxy origin as `e.origin`.

    Repro: [a24/dup.ts](../packages/scramjet/packages/runway/src/tests/review/a24/dup.ts) :: `rv24-dupreal`; [a24/es.ts](../packages/scramjet/packages/runway/src/tests/review/a24/es.ts) :: `rv24-es-origin`

76. **Request headers seen by the origin differ from Chrome:**
    - an `Origin` header on every request, including plain GETs, images and scripts;
    - the page's `referrer`, `referrerPolicy`, `rel=noreferrer` and `referrerpolicy` are ignored, so the Referer leaks even when the page asked for none;
    - iframe navigations are labelled `Sec-Fetch-Dest: document` instead of `iframe`, lack `Sec-Fetch-User`, and take Referer/Origin from the frame's previous page instead of the initiator.

    `SecurityPolicyViolationEvent.blockedURI`/`documentURI` also report proxy URLs, and `import(TrustedScriptURL)` throws synchronously.
    Repro: [a25/secfetch.ts](../packages/scramjet/packages/runway/src/tests/review/a25/secfetch.ts); see a25 findings
