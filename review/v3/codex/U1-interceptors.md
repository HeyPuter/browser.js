### U1-interceptors-1. `RawProxy(instance, key)` still changes every instance that inherits the method

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/client.ts:1142`, `:1185`, `:1540` (HEAD). Upstream `packages/core/src/client/client.ts:626`, `:805`.  
Mechanism: `slotFor` walks up to the property owner and registers the handler on that owner's slot. Upstream read the inherited function but defined its replacement on the supplied instance. The commit fixed the always-last emulator by removing its per-event `RawProxy` calls. It did not restore instance scope for other callers.  
Failure scenario: An embedder suppresses `preventDefault` on one synthetic event. A later, unrelated cancelable event also fails to become default-prevented. Neither event gains an own property at HEAD, so checking enumeration alone would miss the regression.  
Repro sketch: In a `scramjetOnly` test, create two cancelable events `a` and `b`. Install `c.RawProxy(a, "preventDefault", {apply(ctx) { ctx.return(undefined); }})`. Call both methods and assert `[a.defaultPrevented, b.defaultPrevented]` equals `[false, true]`. HEAD gives `[false, false]`.

### U1-interceptors-2. Adding a layer can silently remove an intervening page wrapper

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/client.ts:1142`, `:1275`, `:1551` (HEAD). Upstream `packages/core/src/client/client.ts:626`, `:801`.  
Mechanism: Once a slot exists, lookup returns it before reading the current descriptor. Installing another layer then writes the cached callable back over the page's current property. Upstream wrapped the function present at installation time.  
Failure scenario: A page instruments `EventTarget.prototype.addEventListener` after core hooks it. An embedder subsequently adds a layer to that member. All later registrations stop reaching the page's instrumentation. The same issue affects an embedder that manually restores a descriptor and later installs a fresh layer.  
Repro sketch: Save the hooked `addEventListener`, replace it with a counting function that delegates to the saved one, then install a counting `c.Proxy` layer. Register one listener. Assert both counters equal one. The page counter stays zero.

### U1-interceptors-3. Existing embedders that pass arrays to `Proxy` or `Trap` lose their hooks

Kind: REGRESSION Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/client.ts:982`, `:1029`, `:1555` (HEAD). Upstream `packages/core/src/client/client.ts:594`, `:812`.  
Mechanism: Both public methods lost their array overload and installation loop. At runtime `String_split` coerces a multi-name array to one comma-joined path. Lookup ordinarily misses and returns silently. The commit migrated core's storage caller, but existing JavaScript embedders still pass the old argument shape.  
Failure scenario: An embedder registers one history observer for `["History.prototype.pushState", "History.prototype.replaceState"]`. Neither SPA operation reaches it. TypeScript consumers instead fail when compiling the formerly valid call.  
Repro sketch: Install one counting handler with that array, call each history method once without a URL, and assert two hits. Repeat with a getter trap over `["localStorage", "sessionStorage"]` on a normal-origin test page.

### U1-interceptors-4. An early static wrapper can make a core `super` call recurse

Kind: NEW-BUG Confidence: high Impact: site-breaking  
Where: `packages/scramjet/packages/core/src/client/client.ts:1651`, `:1720`; `packages/scramjet/packages/core/src/client/shared/blob.ts:11` (HEAD).  
Mechanism: Instance `super` resolves through the native store. Static `super` resolves through descriptors copied from the **live constructor**. If a `Proxy` layer already wraps a static, that copy contains the slot's callable. Once `Intercept` installs the base implementation on the same slot, a static `super` call re-enters the outer layer and the base implementation.  
Failure scenario: An embedder instruments `URL.createObjectURL` before core hooks the realm. Creating an object URL for a local image preview exhausts the call stack. Core-first installation works, which is why a test confined to post-hook installation misses this.  
Repro sketch: In a client-initialization fixture, install a fall-through `Proxy("URL.createObjectURL", handler)` before `hook()`. After hooking, call `URL.createObjectURL(new Blob(["x"]))`. Assert it returns a blob URL and the handler ran once.

### U1-interceptors-5. An aborted listener can suppress the browser.js context menu for subsequent events

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/inject/src/emulators/alwaysLastBubble.ts:132`, `:210`, `:225`; mirrored in `packages/scramjet/packages/utils/src/alwaysLastBubble.ts` (HEAD).  
Mechanism: The rewritten bookkeeping handles explicit removal and `once`, but records a descriptor even for an already-aborted signal. Aborting after registration also leaves the descriptor behind. The emulator waits for the last recorded wrapper, which Chrome will never invoke.  
Failure scenario: A component registers a window `contextmenu` listener with a signal and aborts it on unmount. Subsequent context menus can miss the browser.js menu entirely, even when the page has no remaining listener.  
Repro sketch: In the always-last fixture, register the emulator callback on `document`, add a window `contextmenu` listener with `{signal}`, then abort. Dispatch a bubbling, cancelable `contextmenu` from `body`. Assert the page callback ran zero times and the emulator callback ran once. Repeat with the signal already aborted before registration.

### U1-interceptors-6. A `once` listener that stops propagation can strand the emulated default action

Kind: NEW-BUG Confidence: high Impact: visible  
Where: `packages/inject/src/emulators/alwaysLastBubble.ts:112`, `:127`, `:178`; mirrored in `packages/scramjet/packages/utils/src/alwaysLastBubble.ts` (HEAD).  
Mechanism: The wrapper removes its descriptor before invoking a `once` callback. If that callback calls `stopPropagation`, `descs.indexOf(current)` is `-1`, so the search for _remaining_ listeners starts at zero. It can select a listener that already ran.  
Failure scenario: An anchor has two bubble listeners. The first logs the click, and the second is a `once` listener that calls only `stopPropagation()`. Chrome still performs the link's default action. Browser.js can miss its new-tab callback because it waits for the first listener to finish a second time.  
Repro sketch: Register the always-last callback on a target first, then an ordinary click listener and a `{once:true}` listener that stops propagation. Dispatch a bubbling click. Assert the order is `ordinary, once, always-last`. HEAD omits the final entry.

### U1-interceptors-7. A passive page listener can prevent the emulator from canceling the native default

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/inject/src/emulators/alwaysLastBubble.ts:127`; `packages/inject/src/emulators/anchors.ts:31` (HEAD).  
Mechanism: The emulator invokes its deferred callback synchronously inside the final page listener's native invocation. When that registration is passive, Chrome's passive-listener restriction still applies to the emulator's own `preventDefault()`.  
Failure scenario: A passive click analytics listener is last on the bubble path of a `_blank` link. Browser.js requests a tab over RPC, but the event remains uncanceled, leaving the browser's native default eligible to run as well.  
Repro sketch: Register an always-last callback that calls `preventDefault()`, followed by a passive no-op page listener. Dispatch a bubbling, cancelable `MouseEvent`. Assert the emulator callback ran once and `dispatchEvent` returned `false`. The latter assertion fails without needing to open a real tab.

### U1-interceptors-8. An iframe's SPA navigation can replace the top-level address displayed by browser.js

Kind: PRE-EXISTING Confidence: high Impact: visible  
Where: `packages/inject/src/context.ts:162`; `packages/inject/src/emulators/history.ts:17`, `:30`; `packages/chrome/src/proxy/scramjet.ts:171` (HEAD).  
Mechanism: Child frames get their own `ExecutionContextWrapper` and history emulator. A successful child history call sends the child's resulting URL to the same tab-history handlers. Those handlers update the tab without checking which frame owns the `History` receiver.  
Failure scenario: An embedded widget calls `history.replaceState({}, "", "#step2")`. Chrome updates the widget's frame URL and preserves the top-level address. Browser.js sends the widget URL to `tab.history.replace`.  
Repro sketch: Load a top page and a same-origin child at distinct paths in the browser.js fixture. Call `replaceState` in the child. Assert its location changed, the top address still names the top page, and no top-level history-replace notification was emitted for the child.

### Checked and fine

- Ordinary method layering runs latest-first. `ctx.call()` consumes the fall-through, `ctx.next()` reaches the inner chain, and `ctx.fn` names the original function. A re-entrant call gets a fresh context. Calling the public member from its own wrapper starts a fresh outer invocation.
- Ordinary method and native-accessor proxies preserve the target's `.name` and `.length`. Later layers retain callable identity, and the `unproxy` entry points directly to the native. The updated always-last emulator no longer adds stop-method properties to individual events. There is no public layer-removal operation.
- Constructor forwarding carries `newTarget` through the layer chain. Getter-only layering retains an existing native setter. In the normal core-first order, a previously captured reference to an intercepted member sees subsequently installed layers.
- Installing another layer does not add a property lookup on the receiver's prototype chain per invocation. There is a per-dispatch `run` closure, and each active method layer constructs a context with `next`, `return`, and `call` closures. Trap contexts are also per access. These are source-level costs; no timing claim follows from this reading.
- Top-level history notification now follows the underlying operation. A rejected navigation exits before RPC, and a URL-less successful call reports the resulting current URL.
- After `41a37557`, the core IIFE, module, and bundled variants still use the shared TypeScript rule. The heritage rewrite runs before SWC. The WebSocket modules read `self` from the **target realm**, so replacing only the parent's binding does not redirect a clean child's lookup. A replacement already present in the **target** before hooking is still trusted: `WebSocket.ts:345` and `WebSocketStream.ts:86` capture it, and `Intercept` uses its name for lookup. The loader provides no pristine-target guarantee for those local bindings.
- This was a static review. No runway tests, builds, or browsers were run.
