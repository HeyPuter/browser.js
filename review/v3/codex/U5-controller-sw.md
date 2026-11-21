### U5-controller-sw-1. A replacement worker can send an open page’s requests to the proxy host indefinitely

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/sw.ts:252,297–309,404` (HEAD), upstream `packages/controller/src/sw.ts:223–229`  
Mechanism: `c76f6324` learns base prefixes only from controller init messages. When the new worker takes over from a pre-cache worker, the open controller already sent its init to the old worker, the cache is empty, and `clients.claim()` does not solicit a new init. An unknown path cannot trigger revival. Upstream broadcast a reconnect request after worker startup, so a surviving controller could recover after the initial race. Cache eviction or a rejected cache write produces the same failure after an idle restart. A failed write is particularly sticky because the prefix is marked known before `cache.put()`, suppressing retries in that worker.  
Failure scenario: Leave a logged-in page open across the worker upgrade, then submit a form. The browser sends the encoded POST, including its body, to the **proxy host’s HTTP server**. The intended destination never receives it through the transport. The code establishes disclosure to the proxy host, not a direct connection to the destination.  
Repro sketch: In `playwrightTest`, open a frame under the pre-cache worker, wait for initial traffic to settle, install HEAD’s worker, and wait for `controllerchange` without reloading. POST a unique marker. Assert the destination receives it once and the proxy host receives zero POSTs. Repeat with HEAD on both sides by deleting `"$controller$sw"` before stopping the worker.

### U5-controller-sw-2. A cold worker bypasses an embedder’s fetch handler for unrelated requests

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/sw.ts:297,307–309` (HEAD), upstream `packages/controller/src/sw.ts:160–163`  
Mechanism: While Cache Storage is loading, `shouldRoute()` returns true for every fetch. Once `route()` discovers an unrelated URL, it calls `fetch(event.request)` itself. The embedder has already selected the controller branch and cannot apply its own offline, cache, or synthetic-response handler. The repository’s static bootstrap uses precisely this branch order at `packages/scramjet/packages/bootstrap/src/static.ts:196–205`.  
Failure scenario: An embedder serves `/offline-shell` exclusively from its worker. A cold fetch gets the host’s 404 or an offline network error. The same fetch succeeds once the prefix read finishes. Upstream left this URL to the embedder at either time.  
Repro sketch: Give a `playwrightTest` worker a fallback branch returning `"shell"` for `/offline-shell`, and configure the HTTP server to return 404 there. Gate the prefix-cache read, request the shell, then release the read. Assert the response is `"shell"` and the HTTP server saw no request.

### U5-controller-sw-3. Retired prefixes keep intercepting ordinary host routes and accumulate across registrations

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/sw.ts:157–158,181–198,239–243,299` (HEAD), upstream `packages/controller/src/sw.ts:160–163`  
Mechanism: Every distinct base prefix is appended to one origin-wide cache entry. There is no removal, registration scope, or check for a real controller ID before claiming a path. The list grows with distinct configured prefixes, not with the number of tabs using a fixed prefix. Independent registrations also rewrite the complete entry from their own snapshots, so one can erase a prefix learned by another.  
Failure scenario: Move a proxy from `/preview/` to `/browse/` and reuse `/preview/report` as an ordinary host endpoint. Even after every old tab is closed and the worker restarts, it interprets `report` as a controller ID and intercepts the request. Upstream allowed that host route through.  
Repro sketch: Initialize `/preview/`, wait for persistence, close its owner, and restart with `/browse/`. Have the host serve a distinctive `/preview/report` response and assert it reaches the caller. For the lost-write case, start two differently scoped workers before either registers a prefix, register one prefix in each, restart both, and assert both live pages recover.

### U5-controller-sw-4. A controller that registers during the cache read can have its healthy port closed again

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/sw.ts:229–235,249–256,279` and `packages/scramjet/packages/controller/src/index.ts:475–480,523–542` (HEAD)  
Mechanism: `findTabForPath()` checks `tabs` before awaiting `prefixesReady` and never checks it again. An init received during that await registers the tab while there are no waiters. When the read finishes, the first lookup asks for another init. The controller closes its working port, including the return path for requests already dispatched on it. RPC replies use the controller’s current port, and each new SW-side RPC helper starts its token counter at zero. An outstanding request can lose its reply or a later request can receive it.  
Failure scenario: A cold fetch waits on storage, an open controller registers, and a second, slow fetch starts over that connection. The first fetch then triggers redundant revival. The slow fetch can reach the destination successfully while its caller never receives its response.  
Repro sketch: Gate the prefix read with a previously persisted prefix. Start fetch A, register the controller, and start fetch B against a server-held response. Release the cache read, then release B. Assert each fetch receives its own distinct body within a deadline, the destination sees each once, and only one controller port was installed.

### U5-controller-sw-5. A frame can keep using a missing or obsolete worker for transport setup

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/inject.ts:38–45,165,216–226,332–339` (HEAD)  
Mechanism: `dac63876` made reading `.controller` optional, but the module still captures the worker once. Every subsequent `ExecutionContextWrapper` posts its transport port through that captured value. If it was null, the send is silently skipped and the transport’s readiness promise has no rejection or timeout. A parent realm that survives a worker update can likewise use its redundant worker when hooking a new child.  
Failure scenario: Inject before `clients.claim()`, let the page become controlled, then create a child that needs a WebSocket transport. The new controller is available, but the captured value is still null, so the handshake never starts.  
Repro sketch: Delay claim until after inject has evaluated, then claim and open an echo WebSocket from a newly hooked `about:blank` child. Assert it opens and echoes within a deadline. Repeat with a controlled parent kept open across a worker update.

### U5-controller-sw-6. Opaque sandbox documents can throw before the injection guard runs

Kind: PRE-EXISTING Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/inject.ts:165,187` (HEAD)  
Mechanism: Optional chaining handles a missing `serviceWorker` value. Chrome’s `navigator.serviceWorker` getter can itself throw `SecurityError` in a sandboxed document lacking `allow-same-origin`. The module reads the getter at evaluation time, before `load()` can recognize an already-injected client.  
Failure scenario: A rewritten HTTP document in `<iframe sandbox="allow-scripts">` can run its own script in Chrome, but its injected controller bundle throws during startup.  
Repro sketch: Serve a sandboxed child whose first author script posts a ready marker. Collect child `pageerror` events and a client-initialization signal. Assert initialization completes, the marker arrives, and no service-worker getter exception occurs.

### U5-controller-sw-7. Compatible release-patch combinations fail during controller construction

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/src/version.ts:19` and `src/index.ts:453` (HEAD), upstream `packages/controller/src/version.ts:17–26`  
Mechanism: HEAD compares version strings for equality. Upstream `45fb6c68` accepts stable releases with matching major and minor numbers while requiring matching prereleases. Porting it involves **both** controller and utils version checks, their diagnostics, the `semver` runtime and type dependencies in both manifests, and the workspace lockfile.  
Failure scenario: An embedder pairs a controller built for stable `3.0.1` with core `3.0.2`. Construction throws before any frame opens. The current `3.0.0-alpha` pairing still requires an exact prerelease match upstream.  
Repro sketch: Exercise the version checks with stable `3.0.1`/`3.0.2`, stable `3.0.1`/`3.1.0`, and `3.0.0-alpha`/`3.0.0-beta`. Assert only the first pair succeeds, including through the utils entry point.

### U5-controller-sw-8. The incremental build can report success with the worker or injection bundle missing

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/controller/cv.ts:17`, `packages/scramjet/packages/cv/graph.ts:211`, and `packages/scramjet/rspack.config.ts:556–563` (HEAD)  
Mechanism: The controller task tracks only `controller.api.js` and `controller-external.mjs` as outputs. Rspack also emits `controller.sw.js`, `controller.inject.js`, and public declarations. Removing one of those leaves the tracked output manifest unchanged, allowing an incremental build to skip repair.  
Failure scenario: A partial artifact restore retains the API bundle and module stub. The next build is considered current, but the embedder gets a 404 importing the worker or injecting the first frame.  
Repro sketch: In an isolated build fixture, complete one controller build, remove only `dist/controller.sw.js`, and invoke the same task again. Assert it restores the worker. Repeat for `controller.inject.js` and the exported declaration entry.

### Checked and fine

- For an idle restart with a persisted prefix and an open owner, concurrent fetches for one controller ID share a revival broadcast. Each waiting fetch dispatches its own request once. I found no automatic replay of a POST.
- An ordinary SW restart leaves the open controller’s transport, config, frame objects, cookie jar, and frame fetch handlers alive. Cache Storage holds base-prefix strings only. Already-established frame-to-controller transport ports communicate directly after setup.
- `01ab48d0` filters targeted revival messages by controller ID. `c76f6324` adds custom-prefix recovery and derives the base prefix from an older controller’s init **when that init arrives**. The legacy Chrome controller constructs its URLs with the same `/~/sj/` base its bundled worker expects.
- The already-injected path synchronizes document initialization before the WASM check. Removing generated iframe names also avoids mutating the hooking window’s `name` when an unnamed child is accessed.
- The package export keys and `./path` entry match upstream. Per-frame flag overrides are additive, and frames without overrides retain the shared controller config.
- This was a source review. No builds, runway tests, or browsers were run.
