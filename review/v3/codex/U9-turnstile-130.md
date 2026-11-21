### U9-turnstile-130-1. An origin can no longer withdraw a previously negotiated color-scheme hint

Kind: REGRESSION Confidence: high Impact: visible  
Where: [fetch/headers.ts:201](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/headers.ts:201) at HEAD. Upstream `packages/core/src/fetch/headers.ts:67` forwarded `Accept-CH` unchanged.  
Mechanism: HEAD delegates non-UA hints to Chrome. When the origin later sends an empty `Accept-CH`, or replaces its list with UA hints only, `withoutUaHints()` returns `""` and HEAD deletes the field. Chrome sees an absent field and retains its previous opt-in. An explicitly empty field would clear it.  
Failure scenario: A site opts into `Sec-CH-Prefers-Color-Scheme`, then withdraws the opt-in. Subsequent requests can still disclose the preference and receive the theme-specific representation. Upstream carried the withdrawal to the browser.  
Repro sketch: In a `serverTest`, navigate the same HTTPS top-level origin through `/enable`, `/disable`, and `/probe`. Send `Accept-CH: Sec-CH-Prefers-Color-Scheme` on the first response and an explicitly empty `Accept-CH` on the second. Verify the hint arrived at `/disable`, then assert it is absent at `/probe`.

### U9-turnstile-130-2. Restarting the proxy service worker discards an origin’s UA hint opt-in

Kind: NEW-BUG Confidence: high Impact: visible  
Where: [fetch/clienthints.ts:94](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/clienthints.ts:94), [fetch/headers.ts:198](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/headers.ts:198)  
Mechanism: The only copy of a response-header UA grant is a module-level `Map`. The browser receives the response with those UA tokens removed. When the service worker stops, the next worker starts with an empty map even if the document and browser session are still open.  
Failure scenario: A download page requests architecture information on navigation. Its first same-origin download request carries the architecture. After an idle period and worker restart, the same button can get the generic download from the same endpoint. Chrome’s origin grant survives a service worker restart.  
Repro sketch: In a `playwrightTest`, open an HTTPS document that returns `Accept-CH: Sec-CH-UA-Arch`. Verify a same-origin probe carries the hint, stop the proxy worker through the browser’s service-worker controls, then probe again from the still-open page. Assert the two header values match without another document navigation.

### U9-turnstile-130-3. The client-hint gate ignores explicit Permissions Policy decisions

Kind: NEW-BUG Confidence: high Impact: visible  
Where: [fetch/clienthints.ts:230](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/clienthints.ts:230), [fetch/headers.ts:225](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/headers.ts:225)  
Mechanism: `clientHintsAllowed()` makes one decision for all high-entropy hints using the destination and initiator origins. It never reads the document’s per-hint policy. The response rewriter also strips `Permissions-Policy`, so Chrome cannot enforce a denial on the proxy’s behalf.  
Failure scenario: A document returns both `Accept-CH: Sec-CH-UA-Arch` and `Permissions-Policy: ch-ua-arch=()`. Its same-origin resource requests still receive the architecture under HEAD. In the opposite direction, a CDN that has opted in and has explicit delegation can lose the hint used to select a representation.  
Repro sketch: Use two `serverTest` documents on the same HTTPS origin, one with the denial above and one with the default policy. Have each fetch a distinct probe after load. Assert that only the default-policy probe receives architecture information.

### U9-turnstile-130-4. The loopback test treats ordinary HTTP hostnames beginning with `127.` as secure

Kind: NEW-BUG Confidence: high Impact: contrived  
Where: [fetch/clienthints.ts:157](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/clienthints.ts:157)  
Mechanism: `host.startsWith("127.")` accepts DNS names as well as IPv4 addresses. This gate controls both recording grants and forwarding UA hints.  
Failure scenario: `http://127.assets.example` qualifies for hints under HEAD. Chrome’s IPv4 loopback exception applies to addresses in `127.0.0.0/8`. The numeric first label of this DNS name gives it no such status.  
Repro sketch: Extend `request-no-ua-hints-to-insecure-site` with `hostname: "127.assets.runway.test"` and `scheme: "http"`. Assert that the probe receives no `Sec-CH-UA`, then use literal `127.0.0.1` as the positive control.

### U9-turnstile-130-5. The `Function` constructor skips the page’s Trusted Types default policy

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: [client/shared/function.ts:19](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/client/shared/function.ts:19), [client/csp.ts:123](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/client/csp.ts:123)  
Mechanism: The commit message claims `Function` consults the default policy. HEAD stringifies every argument, calls `assertEvalAllowed()`, and invokes the constructor. With only `require-trusted-types-for 'script'` in the response, there is no `script-src` or `default-src` list for that assertion to reject. The default `createScript` callback is never called. Upstream also lacked this enforcement.  
Failure scenario: A page installs a rejecting default script policy and expects its feature probe for dynamic compilation to fail. Chrome rejects the probe. HEAD can return a callable function and select the wrong application code path.  
Repro sketch: Serve a `serverTest` document with just the Trusted Types requirement. Install a default `createScript` that records invocation and rejects. Attempt to construct a function with the harmless body `return 42`. Assert that construction raises `EvalError` and the callback was invoked.

### U9-turnstile-130-6. Every cold worker waits for high-entropy UA data before sending its first ordinary request

Kind: DESIGN-CONCERN Confidence: high Impact: visible  
Where: [fetch/fetch.ts:100](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/fetch.ts:100), [fetch/clienthints.ts:119](/home/velzie/src/browser.js/packages/scramjet/packages/core/src/fetch/clienthints.ts:119)  
Mechanism: The fetch path awaits `readyClientHints()` before contacting the origin. In a fresh worker the grants map is empty, yet the first request waits for every supported high-entropy value. This also happens for plain HTTP destinations where the next step strips the hints. The expensive lookup runs once per realm. Subsequent requests still pass through the await.  
Failure scenario: The first request to an ordinary HTTP page waits on browser UA-data retrieval even though its result cannot affect that request. The dependency is visible in the code. Its latency was not measured.  
Repro sketch: In a fetch-handler test with a fresh realm, supply a controllable pending UA-data promise and record when the transport receives an HTTP request. Assert transport dispatch occurs before resolving the promise.

### Checked and fine

- The core UA `Critical-CH` retry has one reissue site, restricted to top-level GET and HEAD. It checks the intersection with the same response’s `Accept-CH` and processes first-response cookies before rebuilding headers. I found no POST replay or unbounded loop in that path.
- Repeated `Accept-CH`, `Critical-CH`, and enforced CSP fields are joined before their consumers read them. A caller-supplied `Priority` survives. The request-order tables rearrange existing fields and do not change the values of `Accept`, `Accept-Language`, or `Upgrade-Insecure-Requests`. Actual transport order was not measured.
- The full browser-captured referrer takes precedence over a later client URL. That precedence and the document-referrer work were already present when this unit landed via `16659a94`. The redirected iframe marker is preserved. I found no additional referrer regression attributable to this unit.
- Parser-delivered CSP metas retain an element and a readable mirrored policy while omitting the native `content` that would activate the policy against rewritten URLs. The `Element.innerHTML` and `HTMLScriptElement.src` wrappers check page input before rewriting. I found no unconditional `TypeError` on those two paths for correctly branded values.
- Despite its title, `f3c16041` contains no `document.hasFocus()` override or focus/blur implementation change. The existing boolean-type assertions do not establish whether the emulated top frame has focus. I found no focus regression attributable to this commit or its interaction with `dd4878e6`.

This was a reading review. No Runway tests, builds, or browsers were run.
