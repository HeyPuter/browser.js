### P4-interactions-1. A login popup can report the opener as its message source after the opener reloads

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/client.ts:293`, `client/shared/incumbency.ts:80`, `client/shared/postmessage.ts:158`, `client/shared/event.ts:45` (HEAD, paths relative to core `src` after the first). Upstream `packages/core/src/client/shared/postmessage.ts:40` and `:72`, `packages/core/src/client/shared/event.ts:35`.  
Mechanism: On a full reload, `findBox` searches the new document’s ancestors, opener, and child frames. It cannot discover a popup that this window previously opened. With no other live client in that tree, the reloaded opener gets a fresh box while the popup retains the old one. When the popup calls `opener.postMessage`, the opener’s interceptor looks for the calling script in its own box. If the popup’s script is absent, it falls back to the opener and stamps the opener’s client ID. The event wrapper then returns the opener as `event.source`. Upstream used the object payload’s realm to invoke native `postMessage` from the sender.  
Failure scenario: A user reloads the app tab while a sign-in popup is open. The provider finishes and posts its completion object to `window.opener`. Chrome gives the new app document the provider’s origin and the popup as source. At HEAD, the app can receive its own origin and window instead, so its provider-origin check drops the completion.  
Repro sketch: In a `playwrightTest` with `pst`, start with a single proxied app and no child frames. Open a provider popup on a second origin, wait for both documents, then fully reload the app. Have the reloaded app register a `message` listener. Trigger a button **inside the popup** that calls `opener.postMessage({done: true}, appOrigin)`. Assert in the app that `event.origin === providerOrigin` and `event.source !== window`. Use distinct app and popup scripts so their source registrations are distinguishable.

### P4-interactions-2. Opening an embedded document’s fragment in the top window reuses the iframe’s request metadata

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/htmlRules.ts:114`, `client/dom/targets.ts:103`, `fetch/headers.ts:475` (HEAD, paths relative to core `src` after the first). Upstream `packages/core/src/shared/htmlRules.ts:17` and `packages/core/src/shared/rewriters/url.ts:186`.  
Mechanism: HEAD leaves `href="#details"` relative so it follows the document’s current history entry. In an iframe, that entry’s proxy URL carries `$iframe=1`. Target repair redirects `_top` to the emulated top window but only updates `target`. Chrome therefore resolves the link against the child’s URL, including `$iframe=1`, and loads it in the top window. The controller hosts that top window in a real iframe, so the header builder reads the stale marker and sends `Sec-Fetch-Dest: iframe`. Upstream rewrote the anchor separately without the iframe marker.  
Failure scenario: An embedded viewer offers “Open full view” as `<a target="_top" href="#details">`. Its server serves compact markup for iframe requests and the full viewer for document requests. The top window receives compact markup at HEAD. Chrome requests the full viewer with `Sec-Fetch-Dest: document`. This requires neither `pushState` nor a reload.  
Repro sketch: In a `serverTest`, load `/host` with a child iframe at `/viewer`, with no `<base>`. Serve the link above in `/viewer`, record the destination header on each viewer request, and click the link. Assert that the top lands at `/viewer#details` and that the two `/viewer` requests carry `iframe` followed by `document`. The second header distinguishes the regression even when the visible URL is correct.

### Checked and fine

- Within a shared box, the postMessage target-origin gate runs before page listeners. A rejected message leaves a one-shot page listener available for the next message.
- For a fragment link targeting its own frame, preserving the current raw URL keeps the browser in the document. `961f236f` also restores the original proxy URL on a `pushState` round trip, and `961f236f` keeps that mapping with the relevant client.
- For inline style writes, `59a56f4f` compares the serialized style with the mirror before updating it. A no-op CSSOM write therefore avoids an extra mirror mutation.
- For ordinary iframe HTTP redirects, the fetch handler explicitly carries the iframe marker to the next hop. I found no additional release-bar regression in the module-stamping or Trusted Types/serializer paths I examined.

These are source-review findings. I did not run Runway, builds, or browsers.
