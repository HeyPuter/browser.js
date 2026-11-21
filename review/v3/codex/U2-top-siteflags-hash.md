### U2-top-siteflags-hash-1. A persistent link to the initial SPA route can reload the page after a `pushState` round trip

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/htmlRules.ts:116`, `packages/scramjet/packages/core/src/shared/rewriters/url.ts:122` and `:370` (HEAD). Upstream `packages/core/src/shared/htmlRules.ts:18`, `packages/core/src/client/dom/history.ts:22`.  
Mechanism: HEAD writes a link such as `/catalog#reviews` using the current document’s raw proxy URL when the document is already at `/catalog`. That URL carries the original loader’s metadata. Pushing `/item` and then pushing `/catalog` produces a fresh proxy URL carrying the SPA’s own initiator. The existing link still carries the first URL. Upstream rewrote both the link and the pushed path from the same page context, so their non-fragment parts agreed in this sequence.  
Failure scenario: A shopper arrives at `/catalog` from another origin. The SPA keeps its navigation bar mounted while the shopper opens an item and returns to the catalog. Clicking the navigation bar’s `/catalog#reviews` link now requests `/catalog` again and loses in-memory state. Chrome retains the document, updates `:target`, and fires `hashchange`. A plain `href="#reviews"` takes a different path and works.  
Repro sketch: In a `serverTest`, navigate from `entry.example` to `shop.example/catalog`. Serve `<a href="/catalog#reviews">Reviews</a><section id="reviews"></section>`. Set a window sentinel, push `/item`, push `/catalog`, then click the original anchor. Assert one `/catalog` request in total, survival of the sentinel, one `hashchange`, and `document.querySelector(":target").id === "reviews"`.

### U2-top-siteflags-hash-2. Existing embedders silently lose their v2 `siteFlags` overrides

Kind: REGRESSION Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/shared/index.ts:27`, `packages/scramjet/packages/controller/src/index.ts:797` (HEAD). Upstream `packages/core/src/shared/index.ts:21`, `packages/core/src/types.ts:49`.  
Mechanism: Upstream matched each configured regex against `url.href`. `b23f6355` changed that to hostname matching, but `57f3f2fa` then removed the lookup from core altogether. At HEAD, converting a regex to a hostname still has no effect. The public controller accepts a concrete flag set at frame creation. That selection persists across navigation and applies to documents and workers served through the frame’s prefix. An ordinary popup using that prefix also gets those flags. The Chrome frontend’s separate root-domain table does not consume an embedder’s `siteFlags`.  
Failure scenario: An embedder enables `captureErrors` only on its application’s support pages. Passing the existing JavaScript config to v3 leaves capture disabled on those pages. Moving the override to `createFrame` enables capture for other pages visited in that frame as well. This is an intentional API change with an observable migration cost.  
Repro sketch: Use a controller-backed `playwrightTest` with `flags.captureErrors = false` and `siteFlags: { "/support/": { captureErrors: true } }`. Visit `/support/start` and `/home` in the same frame. Record `typeof window.$scramerr` on each. The v2 result is `["function", "undefined"]`. HEAD gives `["undefined", "undefined"]` with the old JavaScript config.

### U2-top-siteflags-hash-3. Reloading a child frame after a path-changing `pushState` sends `Sec-Fetch-Dest: document`

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/rewriters/url.ts:370`, `packages/scramjet/packages/core/src/fetch/headers.ts:475` (HEAD).  
Mechanism: `3bcc37ba` preserved the frame marker on pushed URLs. Later commit `dd4878e6` restored fresh URL generation for path changes, dropping `$iframe`. On reload, the header builder interprets the missing marker as a top-level document. Upstream also rewrote pushed paths without the marker. This finding is already recorded by U7.  
Failure scenario: An embedded app pushes `/checkout` and reloads. A server that selects its embedded checkout from `Sec-Fetch-Dest` serves the standalone page. Chrome sends `iframe`.  
Repro sketch: The existing `fragment-history-pushed-frame-reload-request` in `packages/scramjet/packages/runway/src/tests/fragments.ts:606` covers this. The discriminating assertion is `req.headers["sec-fetch-dest"] === "iframe"` at `/pushed`.

### Checked and fine

- For ordinary HTTP(S) module imports within one document, neither a hash change nor `pushState` introduces a new `$top` parameter. The later initiator handling also omits importer-specific referrer metadata from module URLs.
- Fragment-only hyperlinks stay relative and resolve when clicked. This covers an existing `href="#reviews"` after a route change. Nonempty fragments and a trailing empty `#` survive URL rewriting without passing through the codec.
- Ordinary `location.hash` assignments use Chrome’s native setter. Fragment navigation therefore uses the browser’s history, event delivery, scrolling, and `:target` handling. I found no separate event-order regression in that path.
- Frame-level flags reach both document and worker injection. The old popup `about:blank` flag cache is gone at HEAD.

This was a source review. I did not run runway, builds, or browsers.
