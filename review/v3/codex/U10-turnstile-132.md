### U10-turnstile-132-1. Streaming uploads wait for the producer to close before the server receives the first byte

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/sw.ts:347` (HEAD), `packages/controller/src/sw.ts:183` (upstream)  
Mechanism: The service worker awaits `request.arrayBuffer()` before calling the controller. Upstream transferred the `ReadableStream` through the RPC. The new path buffers every upload in full, including explicit `duplex: "half"` streams and large file-backed form submissions.  
Failure scenario: A client streams records to an HTTP/2 endpoint and polls a separate progress endpoint before closing the upload. Direct Chrome sends the records while the producer is open. At HEAD the upload endpoint has received no request, so both sides wait. A large ordinary upload also incurs a full-body allocation in the service worker.  
Repro sketch: In `playwrightTest`, POST a stream to a same-origin HTTP/2 server, enqueue one chunk, and keep the stream open. Have a separate GET report whether the server received the chunk. Assert receipt before closing the producer, with a timeout and cleanup. This checks server-side delivery independently of when the POST promise resolves.

### U10-turnstile-132-2. Reflection silently drops page-owned global properties whose names start with `$scramjet`

Kind: REGRESSION Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/src/client/shared/wrap.ts:215` (HEAD), `packages/core/src/client/shared/wrap.ts:193` (upstream, before the reflection hooks existed)  
Mechanism: The filter tests a string prefix rather than membership in the set of properties the shim installed. It applies to both the global and `Object.prototype`. A page-created enumerable property can consequently appear in `Object.keys` and disappear from `Reflect.ownKeys` on the very same object. The added test uses an ordinary record, which bypasses the filter.  
Failure scenario: A page assigns `window.$scramjetVersion = 3` after startup and copies its global descriptors. Chrome includes the property. HEAD omits it from the copy even though a direct descriptor lookup succeeds.  
Repro sketch: In `htmlTest`, create that property, then assert its presence in `Object.keys(window)`, `Reflect.ownKeys(window)`, `Object.getOwnPropertyNames(window)`, and `Object.getOwnPropertyDescriptors(window)`. Delete it in cleanup.

### U10-turnstile-132-3. HTML readback removes a page-authored `scramjet-injected` attribute from scripts

Kind: REGRESSION Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/src/shared/rewriters/html.ts:443` and `packages/scramjet/packages/core/src/client/dom/markup.ts:234` (HEAD), `packages/core/src/shared/rewriters/html.ts:323` (upstream)  
Mechanism: The serializer deletes the attribute based solely on the element and attribute names. It has no evidence that the bootstrap created that particular node. Upstream preserved this attribute during serialization.  
Failure scenario: After bootstrap, a page appends an inert script with `scramjet-injected="page"` and snapshots `document.documentElement.outerHTML`. Chrome includes the attribute. HEAD drops it even though it is still present on the live element.  
Repro sketch: In `htmlTest`, create a `script` with `type="application/json"`, set the attribute, and append it. Assert that both `script.outerHTML` and `document.documentElement.outerHTML` contain `scramjet-injected="page"`.

### U10-turnstile-132-4. A missing controller still resolves a subresource fetch with HTTP 503

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/scramjet/packages/controller/src/sw.ts:311` (HEAD)  
Mechanism: The explicit missing-tab branch returns a synthetic 503 before reaching the network-error handler. The later controller-revival work (`c76f6324`) changes how a tab is recovered, but an unsuccessful recovery still takes this branch.  
Failure scenario: A surviving guest requests JSON after its controller is gone. No upstream server answers. Fetch resolves with `status === 503` and a plain-text body, and XHR takes the HTTP `load` path. This differs from the transport-failure behavior that #132 establishes.  
Repro sketch: In a controller integration `playwrightTest`, fetch under a valid controller-form URL whose tab ID has no live owner, and let revival time out. Assert a rejected fetch and XHR `error` with status 0. The existing unreachable-host test exercises a live controller and misses this branch.

### Checked and fine

- **Document mode.** I found no mode flip in the requested ordinary `text/html` cases. No doctype stays quirks. The decoder consumes a leading encoding BOM. Leading comments and ASCII whitespace can precede the doctype without the bootstrap jumping ahead of it. The serializer preserves the declaration text, including case and public/system identifiers. HTML 4.01 Transitional without a system ID therefore stays quirks, and the form with a system ID stays limited-quirks. Both limited-quirks and standards report `CSS1Compat`, so `compatMode` alone cannot distinguish them.
- **Doctype readback and MIME dispatch.** The doctype remains a document child with its identifiers intact. It is outside `document.documentElement.outerHTML`, as in Chrome. Served `application/xhtml+xml`, `text/plain`, and `image/svg+xml` bodies bypass this HTML rewrite.
- **HTTP and network errors.** Ordinary upstream 4xx/5xx responses retain their status. An unhandled transport exception reaches `Response.error()`, leaving Chrome to produce the fetch `TypeError` and XHR status 0/error event. The browser.js controller deliberately serves its own HTML error page with status **500** for both top-level and child navigations. The generic controller propagates the failure unless an error hook supplies a response. I found no ordinary transport-failure path changed to HTTP 200.
- **Reflection.** For same-realm calls on the global and `Object.prototype`, compaction preserves the native array realm and relative order of retained keys. Ordinary objects bypass the filter. Making the bundle globals non-enumerable fixes their appearance in `Object.keys` and `for-in`. The properties still exist for direct lookup, and the filter’s target check is realm-local. I found no newly added browser feature global or demonstrated new Error-stack regression.
- **Frame IDs.** Registration allocates unique IDs within a shared box without consuming page randomness. A newly initialized document registers again, while a bfcache-restored client retains its registration. Separate boxes restart their counters, so uniqueness is box-local. Ordinary message data is unwrapped before delivery. I found no confirmed cross-tab misdelivery in the reviewed paths.
- **Controller copies and URL identity.** The committed chrome and sandbox service workers are byte-identical at HEAD. Bodyless requests retain `null`. Neither reviewed commit adds a context-dependent resource URL. The full-upload buffering in finding 1 is the material hot-path cost.

Static review only. No runway tests, builds, or browsers were run.
