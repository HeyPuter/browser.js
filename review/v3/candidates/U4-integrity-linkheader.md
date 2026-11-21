# U4-integrity-linkheader — 556a1397 (Fix `integrity`), 4e3e8299 (Link header attributes)

Summary: no regressions found. Both commits are improvements over upstream. SRI on rewritten
bodies is still never enforced, as it was upstream and as the code documents. The remaining
findings are pre-existing gaps in Link-header rewriting that 4e3e8299 touched and did not fix,
plus one design note: the reason given for keeping a fetch preload's digest does not hold.

### U4-integrity-linkheader-1. Link-header `imagesrcset` / `imagesizes` are not rewritten, so image preloads escape the proxy or are wasted

Kind: PRE-EXISTING Confidence: medium-high Impact: visible (escape for absolute URLs)
Where: packages/scramjet/packages/core/src/fetch/headers.ts:107-145 (`rewriteLinkHeader`). Only the `<target>` is rewritten and only `integrity` is filtered. Upstream: headers.ts:51-59, same gap.
Mechanism: Chrome's Link-header preloader honours `imagesrcset`/`imagesizes` for `rel=preload; as=image` and fetches the srcset candidate in place of the target. The candidates are passed through unchanged and resolve against the proxied document URL. Absolute candidates go directly to the real origin. Root-relative ones (`/_next/image?...`) go to the proxy origin outside the prefix.
Failure scenario: a Next.js App Router page with a `priority` image. React 19 Fizz `onHeaders` sends `Link: </_next/image?url=a.jpg&w=3840&q=75>; rel=preload; as="image"; imagesrcset="/_next/image?url=a.jpg&w=640&q=75 640w, ..."; imagesizes="100vw"`. Chrome preloads `https://proxy/_next/image?...`, which gives a 404 from the proxy server, and the real `<img>` loads later through the correct URL. With a CDN-absolute srcset (`https://cdn.example/a.jpg 1x`), the browser requests the CDN directly, which is an IP leak and an un-proxied request. Natively the preload is consumed by the `<img>`.
Repro sketch: serverTest whose document response sets `Link: <img.png>; rel=preload; as=image; imagesrcset="http://localhost:<other>/srcset.png 1x"`. Have the other-origin server record hits. Assert it got no direct request (no proxy prefix) and that the proxy saw `srcset.png` through the codec. The fix is to rewrite each srcset candidate URL as the element rule does (reuse the srcset rewriter used for `<link imagesrcset>`).

### U4-integrity-linkheader-2. Link-header `rel=modulepreload` is rewritten without `isModule`, so every header-preloaded module is fetched twice and rewritten as a classic script

Kind: PRE-EXISTING Confidence: medium Impact: visible (double load and wasted rewrite on every JS chunk)
Where: fetch/headers.ts:133-136 (`rewriteUrl(url, context, meta)` with no options). Compare the element rule in shared/htmlRules.ts (`rel === "modulepreload"` → `{ isModule }`). Upstream: headers.ts:56, same.
Mechanism: module URLs carry the `isModule` query param (rewriters/url.ts:306), and the HTML `<link rel=modulepreload>` and `import` URLs include it. The header-preload URL does not. The two URLs differ, so Chrome's preload is never matched. The service worker also sees `parsed.isModule === false` for the header fetch and runs `rewriteJs` in classic-script mode on an ES module.
Failure scenario: SvelteKit sends `Link: </_app/immutable/entry/start.js>; rel="modulepreload"; nopush` for every entry chunk. Proxied, every chunk downloads twice, one copy goes through a classic-script rewrite that fails, and the console shows "preloaded but not used" warnings. Natively there is one fetch per chunk.
Repro sketch: serverTest with `Link: </m.js>; rel=modulepreload` on the document and `<script type=module src=/m.js>`. Count server hits for `/m.js`. Expect 1 (native), currently 2. Fix: in `rewriteLinkHeader`, pass `{ isModule: true }` when the `rel` tokens include `modulepreload`.

### U4-integrity-linkheader-3. Keeping a fetch preload's `integrity` does not prevent the double fetch it is meant to prevent, because preload and `fetch()` URLs differ

Kind: DESIGN-CONCERN (pre-existing URL variance) Confidence: medium-high Impact: visible (double load), not breaking
Where: shared/htmlRules.ts:196-214 (comment: "blanking this one would fetch everything twice"), fetch/headers.ts:127-131. The cause is in client/shared/requests/fetch.ts:35-41 (`rewriteUrlOptionsForFetch` always adds `mode: "cors"`) against the `link href` rule and `rewriteLinkHeader`, neither of which passes `mode`.
Mechanism: `fetch(u)` is rewritten with the `mode=cors` query param (plus `credentials=include` when set). `<link rel=preload as=fetch href=u>` and `Link: <u>; rel=preload; as=fetch` are rewritten without either. The proxied URLs therefore differ, Chrome never matches the preload to the `fetch()`, and the resource is fetched twice whether or not `integrity` is kept. Keeping the digest does no harm (the body for destination "" is unrewritten, so a valid digest verifies), but the test `integrity-link-header-cors-style` ("fetch preload") does not show that the preload was consumed.
Failure scenario: discord.com-style `Link: <xo/r/x.json>; rel=preload; as=fetch; crossorigin; integrity=...` followed by `fetch(xo + "/r/x.json", {integrity})`. Natively this is one request. Proxied it is two, with a "preloaded but not used" warning.
Repro sketch: count server hits for the preloaded JSON in the existing `integrity-link-header-cors-style` sriTest. Expect 1. Fix: for `as=fetch` preloads (element rule and header), rewrite with `{ mode: "cors", credentials: crossorigin === "use-credentials" ? "include" : undefined }` so the URL matches `fetch()`'s default.

### U4-integrity-linkheader-4. SRI is still never enforced for rewritten bodies, so tampered or wrong-digest script, style and modulepreload resources load

Kind: PRE-EXISTING (documented, same as upstream) Confidence: high Impact: contrived
Where: shared/htmlRules.ts:196-214, shared/rewriters/importmap.ts:10-16, fetch/headers.ts:127-140.
Mechanism: `<script>` and `<link>` integrity is blanked to `""`. Import-map `integrity` keys stay as real URLs, which never match the proxied module URLs, so the check never runs. Header `integrity` is dropped. A wrong digest therefore loads where Chrome would block it and fire `error`. The only sites affected are those that use an SRI failure on purpose to trigger an `onerror` fallback with a known-bad hash, which is contrived. Valid-SRI resources never fail, so nothing breaks. Recorded so the next reviewer does not treat it as new.

## Checked and fine

- Element `integrity` blanked to `""` instead of removed: `[integrity]` CSS selectors still match, and `el.integrity` / `getAttribute` read the page's value through the mirror. Upstream returned `""` from the IDL, which was the old KNOWN FAILURE. Fixed.
- Header `integrity` dropped for non-fetch preloads (new in 4e3e8299). The preload and the element now both have empty integrity metadata, so Chrome reuses the preload. Upstream kept the header digest, the check against the rewritten body failed, there was a console SRI error, and the element re-fetched. This is an improvement.
- `rel=preload; as=fetch` digest kept on both element and header. The body for destination "" is served unrewritten (fetch/body.ts default branch), so a valid digest verifies and an invalid one fails the way it does in Chrome.
- `fetch(url, {integrity})`: integrity goes to the native, which checks it against the raw body (destination "" is not rewritten). Correct accept/reject, including multiple hashes, unknown algorithms and whitespace (all native).
- `isOpaqueWithIntegrity` (now `fetch.ts:370-392` after f3c16041 refactored it): a cross-origin `no-cors` fetch with integrity is rejected after the response, which matches Chrome (the request is sent and rejected on the opaque response). The same-origin-then-redirect gap is documented. `data:` and other non-HTTP schemes are correctly exempt.
- `Integrity-Policy` and `Integrity-Policy-Report-Only` are stripped. Upstream did not strip them, so under such a policy scramjet's own injected scripts (no integrity) and every page script would have been blocked. Fixed.
- Re-running the integrity rule when `rel`/`as` changes (attributes.ts:376-385), through `setAttribute`, the `rel`/`as` IDL setters, and `relList` (reflect.ts syncSandbox → `linkRelLists`). Order independence is fine. Removal goes through `changed(..., null)` and re-blanks correctly.
- `splitLinkHeader`: commas and semicolons inside `<URI>` and inside quoted-strings (including `\"` escapes) are handled. Multiple Link fields are joined with `, ` by `ScramjetHeaders.append` before parsing. Quoted `rel="preload"` and `as="fetch"` are unquoted. No regression against the old global regex for well-formed input. An unbalanced quote swallows the following link-values, so their targets are not rewritten (escape), but that is contrived and malformed input.
- The page reads the original Link header through the carried headers (`attachCarriedHeaders`), not the rewritten one.
- Import map `SCRIPT_SOURCE_ATTRIBUTE` is now set server-side, so `textContent` and the client resolver see the original map.
- Serializer now always writes `name=""` to match Chrome's `outerHTML`. This has no effect on the served HTML.
- The XMLSerializer intercept restores visible attributes and text through an inert copy, and injected scramjet scripts are removed by the controller before page code runs. Not an SRI concern. The cost of the double serialization is fine (not a hot path).

Aside (outside this unit, may belong to another reviewer): `as=font` preloads, from an element or a header, are rewritten with document meta. Font URLs inside a cross-origin stylesheet are rewritten with that stylesheet's meta, which adds a referrer-origin param (rewriters/url.ts:327-329). The two URLs differ, so a font preload for a CDN-hosted stylesheet is never consumed and is fetched twice.
