### U6-referer-1. A prefix import and a dynamic import can execute the same module twice

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/rewriters/importmap.ts:119`, `client/shared/import.ts:69`, `fetch/parse.ts:80`  
Mechanism: A static import through a prefix map produces a browser URL ending in a literal path with no proxy query. A dynamic import resolves the same map entry in the client and calls `rewriteUrl(..., { isModule: true })`, producing a URL with `$module` and `$io`. The service worker recognizes both as modules, but the browser has already assigned them different module-map keys.  
Failure scenario: An application statically imports a registry and a lazy-loaded component dynamically imports that registry by the same specifier. Chrome shares the registry. Scramjet can create two instances, so the component cannot see registrations made at startup.  
Repro sketch: In a `serverTest`, map `"pkg/"` to `"/lib/"`. Have `state.js` export `const registry = new Map()`. In one module, statically import `registry` from `"pkg/state.js"`, then evaluate `await import("pkg/state.js")`. Assert that the two `registry` references are identical.

### U6-referer-2. An origin-only policy gives CDN module dependencies the embedding page’s Referer

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/rewriters/url.ts:323`, `fetch/headers.ts:307`, `core/rewriter/wasm/src/jsr.rs:83` (the Rust path is relative to `packages/scramjet/packages/`)  
Mechanism: When the browser supplies only the proxy origin, `referrerSource` reconstructs the source from `$ro`, then `$io`, then the client. Module URLs deliberately omit `$ro` to preserve module identity. `$io` and the document client identify the embedding page. Neither identifies the importing CDN module. Prefix-map imports can arrive without either stamp and reach the same wrong answer through the client fallback.  
Failure scenario: A page on A uses `Referrer-Policy: origin` and loads `B/main.js`, which imports `B/dep.js`. Chrome sends `B/` as the dependency’s Referer. HEAD sends `A/`. A CDN that admits dependencies referred by its own origin can reject the module graph.  
Repro sketch: Use the existing `referrer-module-import-map-cross-origin` fixture. Assert that the dependency receives `ALT + "/"`. Add a relative static import from the same CDN module alongside the mapped import and assert the same value for both.

### U6-referer-3. A CORS redirect chain keeps a concrete Origin after Chrome switches to `null`

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/fetch/fetch.ts:150`, `fetch/headers.ts:391`  
Mechanism: The redirect path carries the initiator and tracks changes of site for cookies and Fetch Metadata. The Origin writer always serializes `initiator.origin`. It has no state for a redirect-tainted request origin. #130 changed which requests get the header but retained this value.  
Failure scenario: A page on A fetches B, which redirects to C. Chrome sends the literal `Origin: null` to C. HEAD sends A. An endpoint that varies its CORS response by Origin sees a different caller. Returning from B to A also needs to retain the taint.  
Repro sketch: The existing `referrer-cors-redirect-tainted-origin` and `referrer-cors-redirect-back-tainted-origin` cover both directions. Assert the final server’s raw Origin equals the string `"null"`.

### U6-referer-4. A form POST under `no-referrer` discloses the initiator in Origin

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/fetch/headers.ts:383`  
Mechanism: #130 sends Origin for every non-GET/HEAD method with a known initiator. The form-navigation branch never applies the referrer policy when choosing the Origin value. `determineReferrer` suppresses Referer correctly, so checking Referer alone misses the disclosure.  
Failure scenario: A document with `Referrer-Policy: no-referrer` posts a form to another origin. Chrome sends `Origin: null`. Scramjet sends the source site’s origin when the initiator resolves.  
Repro sketch: Use `referrer-post-navigation-no-referrer-origin-null`. Record both headers at the form action and assert that Origin is `"null"` and Referer is absent.

### U6-referer-5. The #130 Origin filter still adds Origin to ordinary same-origin fetch and XHR GETs

Kind: PRE-EXISTING Confidence: high Impact: fingerprint  
Where: `packages/scramjet/packages/core/src/fetch/headers.ts:385`, `fetch/headers.ts:657`  
Mechanism: The new filter fixes plain image, script and navigation GETs. It still treats `mode === "cors"` as sufficient for Origin on an ordinary same-origin API GET. Chrome distinguishes these requests from element-driven CORS loads such as fonts.  
Failure scenario: On A, `fetch("/api")` sends `Origin: A` through Scramjet. Direct Chrome omits Origin. A cross-origin `fetch` GET should still carry it.  
Repro sketch: Use `referrer-origin-header-by-request-kind`. Assert absence for same-origin fetch and XHR GET, and the page origin for cross-origin fetch GET, same-origin POST and the font control.

### U6-referer-6. Dynamic import loses the referring script element’s policy

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/client/shared/import.ts:10`, `client/shared/import.ts:69`, `fetch/headers.ts:325`  
Mechanism: The client performs native `import()` in a generated helper. It uses the caller’s base to resolve the specifier, but the browser sees the helper as the importing script. #135’s service-side fallback can recover a document URL, but it cannot recover a script-specific policy the browser never applied to this fetch. Upstream used the same helper pattern.  
Failure scenario: A same-origin module loaded with `<script type="module" referrerpolicy="no-referrer">` dynamically imports a dependency. Chrome omits Referer for the dependency. Scramjet can send the document URL under the document’s default policy.  
Repro sketch: Use `referrer-module-no-referrer-dynamic-import`. Record the dependency request and assert Referer is absent. Leave the document on its default policy so that losing the element policy is observable.

### U6-referer-7. Request construction reads init getters before a throwing `newTarget.prototype`

Kind: REGRESSION Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/src/client/shared/requests/fetch.ts:437`, `client/client.ts:1858`. Upstream `packages/core/src/client/shared/requests/fetch.ts:35`.  
Mechanism: For a Request input, upstream returned from its interception hook and let native construction handle the original arguments and `newTarget`. HEAD calls `readRequestInit` before `new this(input, init)` reaches native construction. The interception layer now preserves the subclass’s actual `newTarget`, but its prototype lookup still occurs after the wrapper has run the page’s dictionary getters.  
Failure scenario: `Reflect.construct(Request, [existingRequest, init], newTarget)` uses a `newTarget` whose `prototype` getter throws. Chrome stops at that lookup. HEAD first runs the `referrer` and `signal` getters, making their side effects observable even though construction fails. Ordinary `class Sub extends Request {}` does not require a throwing getter and is a separate case.  
Repro sketch: `referrer-init-new-target-after-conversion` already isolates this. Compare the getter log as well as the thrown error. Chrome’s log ends at its first entry, `"prototype"`; HEAD’s manual conversion puts `"referrer"` and `"signal"` first. The input POST body should remain unused in both cases.

### Checked and fine

- For ordinary subresources with a full browser-supplied referrer, HEAD uses the captured `request.referrer` before consulting the client URL. A subsequent `replaceState` cannot retroactively change that source.
- The policy calculation strips credentials and fragments, distinguishes same-origin from cross-origin, and handles HTTPS downgrade suppression. Multiple response `Referrer-Policy` fields reach the browser in wire order.
- For served HTML, the navigation’s computed referrer is injected into the document. Reading `document.referrer` after a same-document `pushState` does not recalculate it from the new URL.
- For ordinary already-proxied Requests and their clones, `fetch` passes the Request through to native fetch. The body-buffering branch applies to Requests whose underlying HTTP(S) URL needs rebuilding. Ordinary FormData, Blob and stream bodies in `RequestInit` also reach the native constructor directly.
- The WebSocket handshake has its own Origin path. It uses the client’s site origin and serializes an opaque origin as `"null"`.
- Named tests above are existing fixtures or proposed assertions. This was a reading review. I did not run runway, builds or browsers, and I do not have a verified conclusion for every about:blank/srcdoc, worker or service-worker-revival case.
