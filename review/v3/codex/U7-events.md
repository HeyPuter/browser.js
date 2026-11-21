### U7-events-1. A filtered storage event consumes a page’s one-shot listener

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/shared/event.ts:120`, `:217`, `:417` (HEAD)  
Mechanism: Scramjet passes `once` to the native registration. Chrome removes that registration before calling the wrapper. Only then does Scramjet check the storage key’s origin prefix and discard the event. Upstream also filtered inside the callback.  
Failure scenario: A tab waits for a same-origin login popup to update local storage. An unrelated proxied site writes first. The waiting tab silently loses its listener and misses the login update. In bare Chrome the unrelated write never reaches that tab, so the listener survives.  
Repro sketch: In a `serverTest`, load a same-origin iframe and a second-origin iframe. Register a one-shot `storage` listener in the parent. Have the second-origin frame write first, allow its event task to drain, then have the same-origin frame write `login`. Assert the listener receives `login` exactly once, with a bounded timeout.

### U7-events-2. Reloading a pushed iframe entry loses its frame request metadata

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/shared/rewriters/url.ts:370` (HEAD)  
Mechanism: For a new path, #140 changed `rewriteHistoryUrl` from preserving the current proxy query to generating a fresh URL. That fixes stale loader metadata but also drops the frame marker. The existing `fragment-history-pushed-frame-reload-request` test is still listed as failing at HEAD.  
Failure scenario: An iframe calls `history.pushState(null, "", "/pushed")` and reloads. A server that serves its embeddable view only for `Sec-Fetch-Dest: iframe` can return its top-level view instead. Chrome retains the iframe destination across the reload.  
Repro sketch: Use the existing `fragment-history-pushed-frame-reload-request` test. At `/pushed`, record `req.headers["sec-fetch-dest"]` and assert it is `"iframe"`. Keep the separate passing case for a fragment link rendered before `pushState`, since it exercises the reason for the change.

### U7-events-3. Strict inline handlers receive two different objects for the same event

Kind: REGRESSION Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/shared/rewriters/html.ts:740` (HEAD), `packages/core/src/client/shared/event.ts:179` (upstream)  
Mechanism: The new prelude assigns the stand-in to the `event` parameter. In a strict handler, `arguments[0]` is independent of that parameter and retains the original event. Upstream left both references pointing to the same object. The new parsed-handler test checks `arguments[0]` in sloppy mode, while the strict-handler test checks directive preservation without checking `arguments[0]`.  
Failure scenario: A strict `body onmessage` handler forwards `arguments` to a helper. The helper receives a different object and different `data` from the values the handler sees through `event`. Chrome gives both the same `MessageEvent` and payload.  
Repro sketch: Use an `htmlTest` with `<body onmessage="'use strict'; window.got = [event === arguments[0], arguments[0].data === event.data]">`. Post a string to the window and assert `[true, true]`.

### U7-events-4. Reinitializing a delivered message leaves its old translation active

Kind: NEW-BUG Confidence: high Impact: contrived  
Where: `packages/scramjet/packages/core/src/client/shared/event.ts:83`, `:201`, `:549` (HEAD)  
Mechanism: `initMessageEvent` runs on the underlying event, but its cached stand-in keeps the original message view. Both direct reads and subsequent dispatch use that view. The existing fresh-synthetic-event test never reinitializes a previously delivered message.  
Failure scenario: After a genuine `postMessage` dispatch finishes, the page reinitializes the saved event with origin `"https://example.test"` and data `"replacement"`. Chrome returns both values. Scramjet returns the recipient’s site origin because the replacement data has no envelope.  
Repro sketch: In a `serverTest`, await a self-posted message, then call `e.initMessageEvent("message", false, false, "replacement", "https://example.test", "", null, [])`. Assert `e.origin === "https://example.test"` immediately and inside a listener on a fresh `EventTarget` after redispatch. Assert the listener receives `e` itself.

### U7-events-5. Storage events expose a different storage object from `window.localStorage`

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/scramjet/packages/core/src/client/shared/event.ts:122`, `:182` (HEAD)  
Mechanism: The storage view translates `key` and `url` but passes through the native `storageArea`. The page sees Scramjet’s wrapper when it reads `window.localStorage`. #140 added a test for this, and it remains in the HEAD failure list.  
Failure scenario: A cross-tab synchronization handler checks `e.storageArea === localStorage` before acting. It ignores legitimate updates under Scramjet. Chrome passes the identity check.  
Repro sketch: Use the existing `standin-storage-area-identity` test. Write a key from a same-origin iframe and assert `e.storageArea === localStorage` in the parent.

### Checked and fine

- **No upstream event type was dropped from the shared interceptor.** Upstream handled `message`, `hashchange`, and `storage`. HEAD retains all three. Upstream’s explicit `MessageEvent.ports` getter simply returned the native ports, which HEAD still reads. `popstate`, `securitypolicyviolation`, `error`, `pagehide`/`pageshow`, `navigate`, and `beforeunload` had no corresponding translation in the upstream interceptor.
- Listener bookkeeping reuses the wrapper for the same target, type, callback, and capture flag. Removal uses the same key. Ordinary `once` and `AbortSignal` handling stay with Chrome. Object listeners look up `handleEvent` at dispatch and call it with the listener object as `this`.
- `onmessage`, `onhashchange`, and `onstorage` property assignments use the native handler slot. #140 adds no dispatch queue or listener re-registration that would reorder ordinary page and internal listeners. `stopImmediatePropagation()` on a stand-in reaches the underlying event.
- Ordinary listeners share one stand-in for a translated event. Direct `instanceof`, `target`, `currentTarget`, and `composedPath()` follow the underlying event. Fresh page-created `MessageEvent` instances pass through unchanged. Fake WebSocket redispatch clears the trusted mark and restores it if native dispatch throws.
- Dedicated-worker and MessagePort sends, including a SharedWorker’s port, use the worker envelope with empty origin. BroadcastChannel uses the sender-origin envelope. I found no #140 change that drops those ordinary deliveries.
- Untranslated mouse, pointer, and scroll events incur one additional `WeakMap.get` per wrapped listener invocation. They allocate no stand-in. rAF callbacks do not take this path. I found no basis in the source alone to call this a material slowdown.
- Later commit `6725a7bf` (since reverted and dropped from history) fixed the template/SVG/MathML base-element issue introduced by #140’s parser simplification. This was a reading review; no builds, browsers, or Runway tests were run.
