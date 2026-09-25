# Bucket 2: bugs in the new code (not regressions against main)

These are problems in code develop added or rewrote, where main was no better (or the feature didn't exist on main). Chrome, default flags. Ordered by impact. Repro paths are relative to `packages/scramjet/packages/runway/src/tests/review/`.

1. **`localStorage.key(i)` / `.length` loops are O(n²) across every proxied site's keys.** Each call runs `Object.keys` over the whole shared area and filters it. 1500 keys took about 0.8-12.8s depending on the run and load (main timed out outright). This hits localforage's localStorage driver, "clear keys with prefix" loops and analytics storage sweeps, and it gets slower the more the user browses.
   Cause: `client/dom/storage.ts:56-66`.
   CONFIRMED. Repro: [a5/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a5/misc.ts) :: `rv5-misc-storage-perf`

2. **`CSSGroupingRule.insertRule` (@media/@supports/@layer/@container) and `CSSKeyframesRule.appendRule` don't rewrite `url()`.** #109 claims to cover the CSSOM but only hooks `CSSStyleSheet.insertRule/addRule/replace/replaceSync`, so Twind, Stitches, JSS nested media and UnoCSS runtime images and fonts hit the proxy origin.
   CONFIRMED (same on main). Repro: [a7/css-gaps.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-gaps.ts) :: `rv7-css-gaps` (`grouping_insert`, `keyframes_append`)

3. **Line-1 columns are off by hundreds of characters in stack traces and `error.colno`.** The pst prelude, which carries the whole base64 sourcemap for SW-rewritten scripts, is spliced onto line 1 without shifting the map. Line numbers are now right (main was off by lines), but minified one-line bundles report columns off by the prelude's length to Sentry and Bugsnag.
   CONFIRMED. Repro: [a6/columns.ts](../packages/scramjet/packages/runway/src/tests/review/a6/columns.ts) :: `rv6-col-oneline`

4. **Opaque-origin documents get a fresh random storage scope on every load and write to persistent storage.** This covers data: documents and about:blank frames with no creator. The data is unreachable afterwards but consumes shared quota forever and slows the scans in #1. Browsers refuse storage for opaque origins.
   CONFIRMED. On develop each `data:` frame writes real keys under a new random `about-opaque://…@` prefix (main writes under a shared `@key`; Chrome throws SecurityError). Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-opaque-storage`

5. **`box.scriptrealms` / `box.scripthashes` grow without bound.** Every script, `eval` and `new Function` body registers a permanent record that holds its client strongly, and each registration does a stack capture. Eval/template-heavy pages leak per call, and eval/`new Function` got about 20% slower.
   Cause: `client/shared/incumbency.ts:195-217`, `client/singletonbox.ts:144-147`.
   CONFIRMED. After 2000 distinct evals, `scriptrealms`/`scripthashes` go from 1 to 2001 entries (main grows only `sourcemaps`). That's 580 B/iteration vs 211. Repro: [a6/memcount.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memcount.ts) :: `rv6-memcount`; [a6/memory.ts](../packages/scramjet/packages/runway/src/tests/review/a6/memory.ts) (`RV6_SCEN=evals`)

6. **The rewriter and the client pick the incumbency mode independently.** If `siteFlags` make them disagree, every script calls an undefined `$scramjet$registerrealm` and dies. Default flags are safe; the fix is a `typeof` guard in the prelude, or always defining the global.
   CONFIRMED through the stale-`$top` path (bucket 1 #16 and #19). An iframe's `target=_top` link to a page that a siteFlags `incumbency` override matches gives `$scramjet$registerrealm is not defined`, and none of that page's scripts run. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-modemismatch-stale-top`
   Update: `siteFlags` keys are now hostname patterns (`example.com`, `*.example.com`, `*`) matched against the top-level frame's hostname only. Path, query, fragment and `pushState` can no longer make the two sides disagree. The only way left is a `$top` naming another host: a `_top` link from an iframe to a different host still carries the old top's `$top`, so the service worker uses the old host's flags and the new page's client uses its own. The repro now links across hosts (`linkframe.example` to `pagec.example`).

7. **Named SharedWorkers still see the scoped name** (`"<origin>@name"`). develop's new `SharedWorkerGlobalScope.prototype.name` interceptor never takes effect, because `name` is an own property of the worker global.
   CONFIRMED (same on main for named workers). Repro: [a5/workers.ts](../packages/scramjet/packages/runway/src/tests/review/a5/workers.ts) :: `rv5-sharedworker-string-name`, `-dict-name`, `-blob`

8. **Import-map URL-like keys and scopes only match for inline modules or same-origin importers** (correction: prefix scopes never match a static import on develop, even from same-origin importers; see the root-scope item in bucket 1). A key is compared against the fully rewritten URL, including an importer-specific `$io`, so static imports from CDN modules never match. This is new functionality, and main never mapped URL-like keys.
   CONFIRMED. Page-level `import()` is mapped, but a static import inside a CDN module is not. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-importmap-cdn-key`

9. **`$top` copies the top page's full URL, including its `#fragment`, into every URL rewritten in a subframe.** That bloats URLs and leaks fragments to subresource requests; it's the same parameter behind bucket 1 #16.
   CONFIRMED (the fragment only appears inside proxy URLs; the origin never sees `$top`). Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-top-fragment`

10. **Resource-timing reads are about 4-10x slower** (about 7x in QA), and RUM agents poll them. scramjet's own `/scramjet/scramjet.js` is still visible in `getEntriesByType('resource')`, as it was on main.
    CONFIRMED. Repro: [a7/css-perf-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/css-perf-probe.ts) :: `rv7-perfprobe` (`getEntriesByType_res_ms`); [a7/misc-probe.ts](../packages/scramjet/packages/runway/src/tests/review/a7/misc-probe.ts) (`perf_resource_masked`)

11. **`history.pushState(null, '', 'http://user:pw@<same host>/x')` is accepted** and puts the userinfo into `location`. Native throws SecurityError. It has the same root cause as bucket 1 #39 (comparing origins instead of URL components).
    CONFIRMED. See a7 findings, "Minor".

12. **The demo FlagEditor renders `incumbency` as a checkbox.** Toggling it stores a boolean, and every rewrite then throws "incumbency was not string"; the value persists in localStorage.
    CONFIRMED, and worse than it sounds: with `allowInvalidJs` on by default, a failed rewrite means scripts run **unrewritten**, with the raw proxy `location`, instead of throwing. Where: `demo/src/components/FlagEditor.tsx:108-122`.

13. **`class X extends WebSocket` (and WebSocketStream) instances don't get the subclass prototype.** `new X()` has no subclass methods, `instanceof X` is false, and `Reflect.construct` ignores `newTarget`. Main was worse (its constructor threw). Fix: use `newTarget.prototype` in `WebSocket.ts:364-376` and `WebSocketStream.ts:177`.
    CONFIRMED. Repro: [a7/subclass-probe2.ts](../packages/scramjet/packages/runway/src/tests/review/a7/subclass-probe2.ts) :: `rv7-subclass2-probe` (`ws_subclass_method`, `reflect_construct_ws`, `wss_subclass`)

14. **`WebSocket.close(1000.9)` throws InvalidAccessError.** `[Clamp]` rounds the code to 1001 where Chrome truncates it to 1000. Main's `close()` was broken for every call.
    CONFIRMED. See a3 findings, "Pass 2".

15. **Minor IDL fidelity issues.** `localStorage.setItem("k")` reports "Illegal invocation" instead of "2 arguments required": the validator fallback calls the native with the proxy as `this`. `fetch`/`Request` init members are read out of IDL order. Also note: when the argument check at `client/client.ts:1321-1327` rejects a call, the original native runs with the raw arguments and URL rewriting is skipped. No over-strict declaration was found, but any future one would let URLs through unrewritten.
    CONFIRMED. Repro: [a3/rv3-idl.ts](../packages/scramjet/packages/runway/src/tests/review/a3/rv3-idl.ts); [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-mutationobserver-script` (`setItem-1arg`)

16. **`bytesToBase64` looks up `.call` on the page-writable `Function.prototype` at call time.** It runs for every script source the text layer stores, so a page that replaces `Function.prototype.call` (anti-debug and tracing libraries) breaks script-source bookkeeping. develop calls the page's `call` once per inline script insert, where main called it 25 times; a throwing `call` breaks script insertion on both builds. Fix: `Function_call(bytesToBase64Native, bytes)`.
    Cause: `shared/util.ts:47-50`.
    CONFIRMED. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-b64-call`

17. **`saveNatives` eagerly reads every property of the global during client construction,** including `localStorage`, `sessionStorage` and `indexedDB`. Where one of those getters throws (storage blocked by browser settings, or third-party-storage restrictions in some embed contexts), building the client could throw and leave the realm unhooked. It also forces layout and instantiates lazy objects (see bucket 1 #27).
    Cause: `client/client.ts:384-408` (#90).
    Mechanism CONFIRMED; the natural trigger (browser-blocked storage) stays PLAUSIBLE, because those settings also stop the SW from registering. **It's also a widened sandbox escape.** A page can reach a fresh iframe through `window.frames[i]` (not intercepted) before the first `contentWindow` access and plant a throwing own getter. Client construction then throws and the frame stays unhooked, leaving a raw same-origin realm. On main only a throwing `localStorage` did this; on develop any property does. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-savenatives-variants`

18. **`webkitMatchesSelector` bypasses the selector rewriting.** `matches("a[href^='/foo']")` now works, but `webkitMatchesSelector` with the same selector doesn't: it's a separate IDL operation in Blink and isn't intercepted. Old jQuery/Sizzle and polyfills pick `webkitMatchesSelector` first.
    Cause: `client/dom/element.ts:55`.
    CONFIRMED. Repro: [a2/consistency.ts](../packages/scramjet/packages/runway/src/tests/review/a2/consistency.ts) :: `rv2-cons-selectors` (label "matches") (run without `RUNWAY_FAST`)

19. **`removeAttribute("nonce")` on an element with no nonce attribute clears the `nonce` slot** (`toggleAttribute` is fine on develop; main fails all three variants differently). `AttributeLayer.remove` runs its change steps whether or not the attribute existed, so `s.nonce = 'abc'; s.removeAttribute('nonce')` leaves `''`. The same unconditional `changed()` re-runs a full JS rewrite (`text.sync`) on every `removeAttribute('type')` of a script.
    Cause: `client/attributes.ts:430`.
    CONFIRMED. Repro: [a2/nonce.ts](../packages/scramjet/packages/runway/src/tests/review/a2/nonce.ts) :: `rv2-nonce-remove-absent` (run without `RUNWAY_FAST`)

20. **`el.attributes.values` exists on the wrapper,** though `NamedNodeMap` has no `values`: `"values" in el.attributes` is false while `typeof el.attributes.values === "function"`. This is a new tell on develop. On both builds, `attributes[Symbol.iterator] !== Array.prototype.values`.
    Cause: `client/dom/attr.ts:127`.
    CONFIRMED. Repro: [a6/qa.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa.ts) :: `rv6-qa-mutationobserver-script` (`attrs-values`)

21. **Cleaned stacks show the site's original URL but keep line:column positions from the rewritten code.** For example, TikTok's error is reported at column 656688 when the real call is at 544238. Source-mapping error reporters (Sentry, Bugsnag) then resolve to the wrong code, which is worse than main's obvious proxy URL. This compounds #3.
    Cause: `client/shared/error.ts` (the `cleanErrors` formatter, now default).
    CONFIRMED (live on tiktok.com; see a1 findings, "Pass 2").

22. **Calling the `isTrusted` getter directly on a wrapped event throws.** Every normal read of `isTrusted` on a wrapped event returns true, including fake WebSocket events, `window.event` and handleEvent objects. The one tell is `Object.getOwnPropertyDescriptor(e, 'isTrusted').get.call(e)`-style access, which throws. It affects every wrapped event kind.
    CONFIRMED. Repro: [a6/qa-ws.ts](../packages/scramjet/packages/runway/src/tests/review/a6/qa-ws.ts) :: `rv6-qa-ws-istrusted` (run without `RUNWAY_FAST`)

23. **`Storage.prototype.clear` skips the brand check,** so `clear.call({})` doesn't throw.
    CONFIRMED. Repro: [a12/rv12-misc.ts](../packages/scramjet/packages/runway/src/tests/review/a12/rv12-misc.ts) :: `rv12-misc`

24. **Decorator metadata (`Symbol.metadata`) is treated as an interface static.** That's 104 wasted lookups per window realm, and it could turn noisy or unsafe once V8 ships decorator metadata.
    PLAUSIBLE. See a12 findings.

25. **Meta refresh set through `meta.content` or `meta.httpEquiv` is never rewritten, so the frame navigates straight to the real origin** (proxy escape). develop's new meta rule fixed the `setAttribute` orders only. With an absolute URL, the refresh leaves the proxy; relative ones land on the proxy origin.
    CONFIRMED. Repro: [a13/misc.ts](../packages/scramjet/packages/runway/src/tests/review/a13/misc.ts) :: `rv13-misc-meta-refresh` (labels `refresh-a/d/e/f`, `refresh-j`; run without `RUNWAY_FAST`)

26. **`svgA.target.baseVal = "_top"` navigates the real top window, replacing the browser.js UI** (escape). develop's new `SVGAnimatedString.prototype.baseVal` interceptor passes every non-href animated string straight to the native, so the `target` rule never runs. main didn't navigate at all (also wrong).
    Cause: `client/dom/reflect.ts:1442-1457`.
    CONFIRMED. Repro: [a13/targets.ts](../packages/scramjet/packages/runway/src/tests/review/a13/targets.ts) :: `rv13-target-svg-a-target-baseVal`

27. **Copying or adopting an `Attr` node leaks the rewritten value.** `attr.cloneNode()` and `document.importNode(attr)` return the proxy URL or the rewritten JS/CSS, so the common idiom `dst.setAttributeNode(a.cloneNode())` stores the proxy URL as the page's value. `adoptNode(attr)` leaves a mirror behind, so the element still reports an attribute it no longer has.
    CONFIRMED. Repro: [a13/attrnodes.ts](../packages/scramjet/packages/runway/src/tests/review/a13/attrnodes.ts) :: `rv13-attrnodes`

28. **Minor mirror-layer mismatches:**
    - Mixed-case names through the `*NS` methods (`setAttributeNS(null, "SRC", v)`, `createAttributeNS(null, "SRC")`) overwrite the lowercase attribute's mirror.
    - `[*|href…]` and `[|href…]` selectors skip the mirror.
    - After native editing, `[style*=…]` selectors answer from a stale mirror.
    - After any CSSOM write the style mirror holds absolutised URLs (`url(/a.png)` reads back as `http://site/a.png`).
    - `form.action` returns the raw attribute for unparseable values (`http://[bad`), where Chrome and main normalise it, and a relative value inside `createHTMLDocument()` documents, where Chrome returns `""`.

    CONFIRMED. Repro: [a13/edge.ts](../packages/scramjet/packages/runway/src/tests/review/a13/edge.ts) (`rv13-edge-el-form`), [a13/selectors.ts](../packages/scramjet/packages/runway/src/tests/review/a13/selectors.ts) :: `rv13-selectors`, [a13/equal.ts](../packages/scramjet/packages/runway/src/tests/review/a13/equal.ts); see a13 findings, "Minor"

29. **`localStorage.clear()` fires one StorageEvent per key instead of a single `key === null` event, and a genuine null-key event from the browser is dropped.** Handlers that treat a null key as "logged out in another tab" never run.
    CONFIRMED. Repro: [a19/storage.ts](../packages/scramjet/packages/runway/src/tests/review/a19/storage.ts) :: `rv19-storage-event-clear`

30. **`Object.keys(localStorage)` / `JSON.stringify(localStorage)` cost about 13µs per key, 2.7x main,** because the scope prefix is re-derived for every key.
    CONFIRMED. Repro: [a19/perf.ts](../packages/scramjet/packages/runway/src/tests/review/a19/perf.ts) :: `rv19-perf-storage-hot`

31. **develop's new `CSSRule.style` and `insertRule` rewrites resolve relative `url()`s against the document, not the stylesheet,** and `new CSSStyleSheet({baseURL})` is ignored. So develop loads the wrong path; main loaded nothing.
    CONFIRMED. Repro: [a18/cssmatrix.ts](../packages/scramjet/packages/runway/src/tests/review/a18/cssmatrix.ts) :: `rv18-cssmatrix` (`w_rulestyle_ext*`, `w_insertRule_ext`, `w_constructed_baseURL`)

32. **The new typed-OM rewriting misses `CSSUnparsedValue`** and other hand-built values.
    CONFIRMED. Repro: [a18/cssmatrix.ts](../packages/scramjet/packages/runway/src/tests/review/a18/cssmatrix.ts) :: `rv18-cssmatrix` (`w_typed_unparsed`)

33. **Prefix-mapped modules get a different URL from the same module reached any other way, so they're instantiated twice.** The special query-less URL used for prefix mappings differs from what a relative import, an exact entry or `import()` produces. On the real three.js import map, `new EffectComposer(r).copyPass instanceof ShaderPass` is false. On main these imports failed outright.
    CONFIRMED. Repro: [a16/mod4.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod4.ts) :: `rv16-prefix-map-identity-static`, `rv16-prefix-map-identity-mixed`; [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-importmap-prefix-dup`

34. **Script-inserted import maps resolve against the base URL at `import()` time, not at registration,** so after `pushState` or adding a `<base href>`, relative entries load the wrong module.
    CONFIRMED. Repro: [a16/mod1.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod1.ts) :: `rv16-simap-pushstate-relative`, `rv16-simap-base-change-relative`, `rv16-simap-pushstate-relative-key`

35. **Import maps inserted with `innerHTML`, which the browser never registers, are registered by the client resolver** (and double-rewritten).
    CONFIRMED. Repro: [a16/mod1.ts](../packages/scramjet/packages/runway/src/tests/review/a16/mod1.ts) :: `rv16-simap-innerhtml-inert`

36. **`document.open()` switches off develop's new postMessage `targetOrigin` check.** The check is a window listener registered once, and `document.open()` removes all window listeners. So every `document.write`-built iframe (ad slots, editor frames) then receives messages addressed to other origins. main never had the check.
    CONFIRMED. Repro: [a14/docopengate.ts](../packages/scramjet/packages/runway/src/tests/review/a14/docopengate.ts) :: `rv14-docopen-gate` (run without `RUNWAY_FAST`)

37. **URL-keyed import maps break after the stale reload** (bucket 1 #21, SPA reload): the mapped file is never used and the original path 404s. main never supported these maps.
    CONFIRMED. Repro: [a15/params.ts](../packages/scramjet/packages/runway/src/tests/review/a15/params.ts) :: `rv15-pushstate2-importmap`

38. **`pushState` alone can flip the rewriter's incumbency mode away from the client's** when a `siteFlags` pattern matches one route and not another, so scripts lose `$scramjet$registerrealm`. This is the same mechanism as the mode-mismatch item.
    PLAUSIBLE (code reading).
    Obsolete: `siteFlags` now match only the top-level frame's hostname, and `pushState` can't change the host, so no route can pick different flags from another.

39. **Cloned OPFS root handles reveal the per-site directory name.** develop disguises the root's `name` as `""` only for the exact handle object it returned, so a clone (posted to or from a worker, or stored in IndexedDB) shows `http%3A%2F%2Fsite`.
    CONFIRMED. Repro: [a20/opfs.ts](../packages/scramjet/packages/runway/src/tests/review/a20/opfs.ts) :: `rv20-opfs-handles`

40. **Capability delegation through `postMessage(msg, {targetOrigin, delegate: "payment"|"fullscreen"})` is silently dropped.** The call succeeds but nothing is delegated, and Chrome's NotSupportedError/NotAllowedError validation is skipped. main broke this differently: forcing `"*"` made every real delegation throw.
    CONFIRMED. Repro: [a21/options.ts](../packages/scramjet/packages/runway/src/tests/review/a21/options.ts) :: `rv21-opts-window-postmessage` (run without `RUNWAY_FAST`)

41. **An origin header whose name starts with `x-scramjet-` is shown to the page under the unprefixed name, merged into the real one.** For example, `X-Scramjet-Content-Type: text/html` next to `Content-Type: text/plain` makes `get("content-type")` return `"text/html, text/plain"`.
    CONFIRMED. Repro: [a24/spoof.ts](../packages/scramjet/packages/runway/src/tests/review/a24/spoof.ts) :: `rv24-originprefixed`

42. **Nonces aren't hidden when the CSP came in a header.** After insertion, Chrome returns `""` from `getAttribute("nonce")` (and in `outerHTML`); develop returns the real value. Low: webpack, Vite and emotion read `.nonce` first, and develop fixes every `.nonce` propagation pattern main got wrong.
    CONFIRMED. Repro: [a25/nonce.ts](../packages/scramjet/packages/runway/src/tests/review/a25/nonce.ts) :: `rv25-nonce-csphdr`
