The attempted messaging and incumbency fixes have been reverted. This plan keeps
the new regression tests and their per-test configuration support, records the
baseline failures, and separates the replacement into independently reviewable
changes. The obsolete nonce-mode removal is now implemented; the replacement
messaging and callback implementations remain planned.

The `nonce` incumbency mode and its sourceURL machinery have been removed from
the working tree, along with the stale nonce regression test. Historical baseline
results below include that test; the replacement design excludes nonce mode and
sourceURL-based attribution.

Production scope: design and validate the replacement for `pst` and `lazystamp`.
Do not spend implementation effort on full `stamp` or `none`; their historical
test results below are diagnostic context, not acceptance requirements. Run the
messaging matrix under both production modes instead of relying on stamp-only
coverage.

1. **Baseline and motivation**

   Restored to HEAD: `core/src/client/shared/{event,incumbency,postmessage,settimeout}.ts`
   (paths below are relative to `packages/scramjet/packages/` unless stated otherwise).
   The discarded patch is saved at `/tmp/browserjs-rejected-postmessage-fixes.patch`.
   The editor settings and Dreamland submodule changes were left alone.

   After rebuilding the browser bundles, ran both groups against Scramjet and the
   bare browser, with `OMIT_WPT=1` and without fast mode:

   | Group                         | Result              | What it establishes                                                                                                                                        |
   | ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `pnpm runway test review113-` | 3 passed, 10 failed | Invalid origin, Window transfers, sender origin, nonce attribution, all three bound timer cases, script-only mode override, and `none` array payload fail. |
   | `pnpm runway test pmatrix-`   | 14 passed, 8 failed | Default/slash/empty-options/wrong-options-origin filtering, invalid options origin, duplicate transfer, buffer detachment, and transfer-only ports fail.   |

   Commands run from the repository root. Logs:
   `/tmp/browserjs-review113-baseline.log` and
   `/tmp/browserjs-pmatrix-baseline.log`. The build generated usable bundles but
   reported a core TypeScript declaration-generation failure; it is not a clean
   typecheck. Build log: `/tmp/browserjs-postmessage-baseline-build.log`.
   A direct `pnpm exec tsc --project tsconfig.types.json` in core also failed:
   six diagnostics involving `wrap.ts`, fetch exports/declaration types,
   `Error.stackTraceLimit`, `JsRewriterOutput.sourceurl`, and URL Blob typing.
   Details: `/tmp/browserjs-baseline-declarations.log`.

   These are the causes found in the restored source:

   | Failure                                   | Cause                                                                                                                                                                                       |
   | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Target-origin validation and restrictions | Window interception discards the supplied origin/options and calls native `postMessage` with just its envelope. Native restrictions then concern the proxy origin.                          |
   | Window transfer lists                     | The transfer argument is discarded. Ports in the payload throw `DataCloneError`; buffers are copied, not transferred; duplicate entries are never examined.                                 |
   | `MessageEvent.origin`                     | The envelope records the target client's URL origin instead of the incumbent sender's document origin.                                                                                      |
   | `nonce` and PST host callback             | Both use a fixed stack index and `getScriptHash()` lookup. Nonce mode registers by nonce; a host-called bound native function has no author script frame to index. Unchecked lookups throw. |
   | Stamp/lazystamp host callback             | `box.incumbent` is the last stamped call and is never restored. An unrelated call can overwrite the callback's registration context.                                                        |
   | Script URL override                       | Runtime helper installation follows document mode; rewriting can select another mode for an external script.                                                                                |
   | `none` array payload                      | Payload-prototype inference does not identify Array's creator through the Object-prototype map; dereferencing the missing sender throws. Payload identity is not evidence of the caller.    |

   The one-argument MessagePort/Worker cases and the leading-comment strict-mode
   case **pass** in this run. Keep them as guards. The strict-prologue regexp in
   `core/src/shared/rewriters/js.ts` is still visibly unable to recognize comments
   or a complete directive sequence; first obtain a focused failing reproduction
   that demonstrably executes that wrapping path. Do not claim the passing test
   reproduced it. Similarly, inspect one-argument interceptor fall-through before
   attributing those passing cases to envelope handling.

2. **Replace the incumbent model before adding messaging-specific guesses**

   Fetched and read HTML's [incumbent definition, backup stack, callback entry,
   and cleanup](https://html.spec.whatwg.org/multipage/webappapis.html#incumbent-settings-object).
   A local copy of that section, including its bound-timer and synchronous-event
   examples, is at `/tmp/browserjs-backup-incumbent-spec.txt`.

   The normative rule is: use the topmost script-having execution context's
   settings unless that context is absent or its skip counter is positive; then
   use the backup stack's top. Callback entry pushes captured settings and
   increments the existing top script context's counter. Cleanup decrements it
   and pops the matching settings. A skipped top context selects the backup;
   it does not authorize searching older author frames.

   Proposed runtime records in `client/shared/incumbency.ts` and `singletonbox.ts`:
   - A stable settings record for each document/worker realm, independent of its
     URL text and client lookup lifetime.
   - Author activation records with identity, settings, and skip count, plus a
     separate backup stack scoped to the relevant agent/event loop.
   - Callback records containing the original callable/object and the incumbent
     captured at the actual Web IDL conversion boundary. Each registration owns
     its context; a single WeakMap entry per function is insufficient.
   - Shared capture, prepare, resolve, and cleanup operations. Cleanup runs in
     `finally`, including conversion failures and exceptions. Internal wrappers
     never count as author activations.

   Keep the callback's relevant realm separate from its captured incumbent.
   [Web IDL callback conversion](https://webidl.spec.whatwg.org/#js-callback-function)
   captures the incumbent; [invocation](https://webidl.spec.whatwg.org/#invoke-a-callback-function)
   uses both settings. Neither `Object.getPrototypeOf(fn).constructor` nor a
   callback's creation realm supplies its registration context. Prototypes and
   constructors are also page-mutable and can run proxy traps.

   Route timers and event listeners/handlers through the shared callback adapter,
   preserving listener identity, removal, once/abort semantics, dynamic
   `handleEvent`, receiver, arguments, and native exception reporting. Duplicate
   listener registration must retain the original registration context. Apply
   the same design to other callback APIs and audit
   [HTML job hooks](https://html.spec.whatwg.org/multipage/webappapis.html#hostmakejobcallback)
   separately for promises; wrapping `.then` alone does not intercept `await` or
   every native job. String timers are scripts, not callback records.

   Acceptance examples: B registers A's bound native `postMessage`; C later
   dispatches the event synchronously. The bound call uses B's captured context,
   despite C remaining on the stack. If the callback instead enters author code
   in A, that new script context wins. Returning or throwing restores C. Also
   schedule the same function independently from two realms and interleave tasks.

3. **Make attribution modes providers of evidence, not different semantics**

   Completed: removed the leftover `nonce` mode from TypeScript and Rust definitions,
   stale fallback documentation, sourceURL nonce emission and URL parameters,
   sourceURL attribution and stack-display compensation, and nonce-only metadata.
   Updated the test harness mode union and removed `review113-nonce-postmessage`.
   Add coverage of the intended supported-mode selection when PST is unavailable
   as part of the attribution redesign.
   The actual default already selects `pst` or `lazystamp`; verify that remains
   consistent rather than introducing a nonce fallback. Keep ordinary page sourceURL
   behavior intact. Audit private PST registration identifiers independently;
   naming a private ID `nonce` does not make it sourceURL-based attribution.
   HTML/CSP nonces are unrelated and must remain untouched.

   Select the correct execution context using registered script identity and
   explicit callback boundaries. A fixed offset is acceptable for a controlled,
   tested wrapper layout; variable offsets are not a conformance requirement.
   Neither an offset nor a generic first-page-frame scan supplies an absent
   author context or accounts for a skipped context during callback dispatch.
   Use the backup stack where required. Retain the valid PST part of `realmForFrame`, but
   test identical source evaluated in multiple realms, eval, Function, modules,
   custom sourceURL, debug trampolines, and unavailable stack APIs. A script hash
   identifies source, not inherently a particular evaluation's realm; prove the
   registration scheme disambiguates it. Never recover identity by URL/path/origin
   matching or payload prototypes, and never silently invent the target as sender.

   For lazystamp, an author getter/setter that directly calls `postMessage`
   supplies a script-having context, and that explicit call is rewritten.
   Implicit entry alone does not justify instrumenting property access or every
   function entry. Start with concrete failures for registration-time capture,
   bound native callbacks, and aliased sends. Preserve direct eval, lexical scope,
   `super`, and generator/async semantics.

   Lazystamp's syntactic `postMessage` matching misses aliases and callback
   registration. Full conformance requires
   adequate instrumentation or a native host facility. Define these modes'
   capability contracts explicitly. Do not rename guesses as a spec fallback.
   If a production mode cannot supply required evidence, the implementation plan
   must expand its instrumentation or explicitly classify that mode as limited.

   Runtime bootstrap must provide the helpers required by every script mode that
   can execute in the realm, including per-script overrides, eval, and modules.
   Decide that capability set from configuration before author code runs; do not
   use the receiver document's mode to interpret another script's identity.

4. **Implement the actual Window bindings before the HTML algorithm**

   Model the two [Window IDL overloads](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object)
   and use shared Web IDL conversion helpers in `client/webidl.ts`. TypeScript
   parameter types and `typeof value === "object"` are not overload resolution.
   Preserve argument count, undefined/default distinctions, null, callable
   dictionaries, USVString conversion, and single observable reads.

   `WindowPostMessageOptions` inherits `StructuredSerializeOptions`. Extend the
   existing dictionary reader to preserve inheritance order: convert `transfer`
   before the derived `targetOrigin`. Do not flatten and alphabetically sort both
   members. Finish binding conversion before origin parsing or serialization.
   The rejected implementation reversed that order, used nullish defaults for
   values that require conversion, and tested magic strings before coercion.

   Add observable-order cases: throwing transfer getter/iterator plus invalid
   origin; `targetOrigin: null`; coercion yielding `"*"` or `"/"`; Symbols;
   reentrant getters; and getters that must execute exactly once. Reuse the
   existing interceptor tests and bare-browser comparisons.

   Audit the Worker/MessagePort declarations too: optionality inside a union
   string is not a real IDL optional argument. Ensure valid one-argument calls
   take the intended path. Preserve their distinct native origin/source rules;
   they do not need Window sender attribution.

5. **Separate origins, transport, and event presentation**

   Introduce an origin record with tuple or opaque identity, a same-origin
   comparison, and serialization. Reuse it for inherited about:blank/srcdoc
   origins and document lifecycle handling. `scopeOrigin` is a storage namespace
   and explicitly forbids security use; serialized `"null"` also cannot identify
   an opaque origin. Cover sandboxing and blob/data documents. A parsed opaque
   target URL must not match every opaque document.

   Follow the [Window post-message algorithm](https://html.spec.whatwg.org/multipage/web-messaging.html#window-post-message-steps):
   resolve the incumbent, resolve/parse target origin, serialize with transfer,
   queue delivery, compare the target document's origin, then deserialize and
   deliver. Preserve the sender settings and its WindowProxy across navigation;
   do not reconstruct them by dereferencing a possibly removed client ID.

   Prefer native structured serialization, transfer validation/detachment, task
   ordering, and MessagePorts. Serialize page data exactly once, including cycles
   and shared references. A wrong destination still causes synchronous clone
   failures and successful transfers still detach before the queued origin gate.

   Define an internal transport record distinct from arbitrary page payloads.
   Validate internal metadata at ingress; reserved property names alone are not
   proof of a transport record. Decode once and share the resulting event view
   across listeners, `onmessage`, and `window.event`. Decide acceptance once per
   event, against the actual recipient, before invoking any page listener; the
   realm that installed a listener is not necessarily the recipient realm.
   Preserve native event identity/behavior, ports, source, and error delivery.

   **Transport feasibility gate:** a native wildcard envelope deserializes before
   a JavaScript listener can filter it. That does not automatically implement the
   specified pre-deserialization origin gate, and native `messageerror` may not
   carry envelope metadata. Prototype these paths, target navigation, and source
   lifetime first. If the current bridge cannot preserve these observables,
   identify the required host/transport hook before claiming full compliance.
   Per-listener filtering and synthetic redispatch are not sufficient evidence.

6. **Fix source wrapping using parser information**

   Have the existing Rust/Oxc parser identify the complete directive prologue and
   legal prelude insertion boundary. Return the needed offset through the
   rewriter result or insert through its existing change machinery. Remove the
   regexp and the 256-byte scan limit. Preserve hashbangs, comments, BOM, ASI,
   multiple directives, UTF-8 offsets, and source-map/stack locations. Follow
   [ECMA-262 directive prologues](https://tc39.es/ecma262/multipage/ecmascript-language-source-code.html#sec-directive-prologues-and-the-use-strict-directive).
   Verify both string and byte entry paths with direct rewriter tests before the
   browser test; do not enlarge the regexp until one example passes.

7. **Implementation order and completion criteria**

   With the obsolete nonce-mode surface removed, strengthen reproductions and
   complete the attribution/transport feasibility probes. Then land focused
   changes for parser boundaries and
   bootstrap capabilities; shared settings/callback state and attribution;
   inherited dictionary/overload conversion; origin records and Window delivery;
   and the remaining callback/job integrations. Each change should cite the
   algorithm it implements and carry observable behavior tests.

   Keep both new test files. Strengthen negative-delivery tests with a successful
   send/ready handshake so a missing send cannot pass through an 800ms timeout.
   Keep per-test flags isolated, preserving unrelated site flags and restoring
   configuration on every exit. The current harness edits are retained, not
   certified as the final design.

   Expand coverage to nested dispatch, exceptions, callback re-registration,
   same-URL realms, altered function prototypes, mode overrides, opaque/inherited
   origins, navigation between send and delivery, transfer errors, messageerror,
   and getters that reenter another realm. Run under PST and lazystamp;
   a green stamp-only matrix is not evidence for either production mode.

   Cross-check the upstream tests inspected for this plan:
   [event listener incumbent 1](https://github.com/web-platform-tests/wpt/blob/master/dom/events/EventListener-incumbent-global-1.sub.html),
   [event listener incumbent 2](https://github.com/web-platform-tests/wpt/blob/master/dom/events/EventListener-incumbent-global-2.sub.html),
   [invalid target origin](https://github.com/web-platform-tests/wpt/blob/master/webmessaging/postMessage_invalid_targetOrigin.htm),
   and [options with undefined transfer](https://github.com/web-platform-tests/wpt/blob/master/webmessaging/with-options/undefined-transferable.html).
   Then run the existing incumbent, messaging, listener, timer, and relevant WPT
   suites in both bare and proxied harnesses. Do not update the expected-failure
   list to conceal regressions. Report unsupported engine capabilities and build
   failures separately from conformance results.
