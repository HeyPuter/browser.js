# Replacing scramjet's apply proxies with plain functions

Written 2026-09-29. Measurements are from headless Chromium (Playwright's build) on an idle machine.

## Summary

Replace the `Proxy` scramjet puts over each patched native with a plain method function. In Chromium the Proxy's `apply` trap alone adds about 11 ns to a 28 ns `getElementById` call; a plain wrapper adds nothing, even with 241 of them built from one factory.

Every observable property of a native method can be reproduced by a function. The one thing lost is the Proxy's live transparency over the native as an object, and only scramjet itself relies on that.

## Where the overhead comes from

Under ppsc, native DOM calls stay 1.4–1.7× slower than legacy even after elision removes the document proxy. The cost is the slot patch, not the proxy.

ppsc's IDL unproxy layer patches about 247 members. About half (127) only fix the receiver, because a proxy can end up as `this`: `createElement`, `getElementById`, `createTextNode` and `EventTarget.prototype.addEventListener`, among others. Legacy (dpsc) never patches these, so it calls straight into native code.

`callableFor` in `client.ts` installs every patched method as a Proxy, even when the slot has no layers:

```ts
new Proxy(fn, {
	apply: (_t, thisArg, args) => this.dispatchApply(slot, thisArg, args),
});
```

Each call then pays for, in order:

1. the Proxy `apply` trap, with the arguments materialized as an array;
2. `dispatchApply`: `fixReceiver`, plus a `run` closure allocated per call;
3. `applyLayer`, walking a layer list that is empty for these members;
4. `slot.tramp.apply(native, that, args)`.

Elision makes the receiver real, but the member is still patched, so every call still pays all four.

## Measurements

The Proxy trap is most of the cost; a plain method wrapper is inlined completely.

`document.getElementById`, best of 7 samples, 3 runs each:

| How the call reaches the native                                       | ns/call | Overhead |
| --------------------------------------------------------------------- | ------: | -------: |
| the native directly (legacy)                                          |   28.25 |        – |
| `Proxy` whose `apply` trap just does `Reflect.apply`                  |   39.50 |    +11.3 |
| same trap plus the receiver fix                                       |   39.00 |    +10.8 |
| `Proxy` plus the slot dispatch (scramjet today)                       |   43.60 |    +15.4 |
| method-shorthand wrapper, `nat.apply(fix(this), args)` with `...args` |   28.20 |       ±0 |
| same wrapper, fixed arity                                             |   27.70 |       ±0 |
| plain wrapper keeping today's slot dispatch                           |   32.80 |     +4.6 |

At scale: 241 wrappers built from one factory function, all exercised, cost 24.6 ns per call against 24.1 ns native and 38.7 ns through the Proxy. The shared function literal does not make the call site megamorphic.

The gap it closes, from the shapes microbenchmarks (hybrid elision, no `$t`):

| Call                            |  Legacy | Hybrid, no `$t` | Overhead |
| ------------------------------- | ------: | --------------: | -------: |
| `getElementById`                |   26 ns |           44 ns |   ~18 ns |
| `createElement`                 |   57 ns |           78 ns |   ~21 ns |
| `createTextNode`                | 74.5 ns |          105 ns |   ~30 ns |
| element add/removeEventListener |  707 ns |          755 ns |      ~7% |

## What a wrapper has to reproduce

A method-shorthand function matches a native method on everything checked in Chromium except `toString`, which scramjet already patches for the Proxy.

| Observable                    | Native method                                 | Proxy today                     | Method-shorthand wrapper                  |
| ----------------------------- | --------------------------------------------- | ------------------------------- | ----------------------------------------- |
| Own keys                      | `length`, `name`                              | same                            | same                                      |
| `name`, `length`              | `getElementById`, 1                           | same                            | same (`length` set with `defineProperty`) |
| Has `prototype`               | no                                            | no                              | no                                        |
| `new f()`                     | TypeError "not a constructor"                 | same                            | same                                      |
| `.caller`, `.arguments`       | throws TypeError                              | same                            | same                                      |
| `Function.prototype.toString` | `function getElementById() { [native code] }` | `function () { [native code] }` | its own source                            |

`toString` goes through the same `box.unproxy` mapping, with the wrapper registered instead of the Proxy. Getter and setter halves work the same way as `({ get body() {…} })`, which gets the right `get body` name.

**Constructors** (`WebSocket`, `Image`, `XMLHttpRequest`, …) need more, but each piece is doable:

- **`new.target`:** forward with `Reflect.construct(native, args, new.target)`. Subclassing worked in the check: `class S extends W` instances passed `instanceof` for both `S` and the native.
- **Calling without `new`:** throw the native's exact message. "Failed to construct 'WebSocket': Please use the 'new' operator…" reproduced.
- **`prototype`:** defined as the native's, non-writable.
- **`Object.getPrototypeOf(WebSocket) === EventTarget`:** a fresh wrapper gets this wrong until you `setPrototypeOf` it to the parent's wrapper. That beats today: the Proxy forwards to the native parent, which is not the global the page sees.
- **Statics** (`OPEN`, `CONNECTING`, …): copied in the native's key order. Accessor statics such as `Notification.permission` stay live when their descriptors are copied.
- **Constructible with no `prototype`:** only the `Proxy` constructor. A bound function covers it.

## What a wrapper cannot do

A wrapper is a separate object, so it cannot be transparent over the native the way a Proxy is. A Proxy with no traps forwards every property operation to its target, so the native and what the page sees stay one object.

- **What the native gains later is not on the wrapper.** Properties added to the native after patching have to be copied across. Only scramjet can add them, since the page never reaches the native, so this is a rule to follow rather than a limit.
- **What the page does to the wrapper stays off the native.** Expandos, `Object.freeze(document.getElementById)` or `defineProperty` on it touch only the wrapper. That is an improvement: a Proxy without those traps forwards them to the native scramjet itself calls.

The freeze difference could not be demonstrated in the check, because an earlier case in the same page had already frozen the shared native.

## How it fits the slot system

The slot keeps one patch per member; `render()` only picks which callable to install. Nothing sits on top of anything else, so the no-proxy-over-proxy rule holds.

- **Receiver fix only** (no layers, no base): install a wrapper that calls the native directly. Measured free.

  ```ts
  ({
  	getElementById(...a) {
  		return nat.apply(fix(this), a);
  	},
  }).getElementById;
  ```

- **With layers:** the wrapper calls `dispatchApply` instead. As a plain function that costs +4.6 ns, against +15.4 ns for the Proxy with the same dispatch.
- **Layers added or removed later:** `render()` re-renders the slot and swaps the form, as it re-renders today.
- **Bookkeeping:** register the wrapper in `box.unproxy` and `slotsByNative`, as `callableFor` does for the Proxy now.

## The same for IDL attribute getters

The ~37 IDL attributes that can return a window or document likely have the same cost on every read, though only method calls were measured here. They include `parentNode`, `firstChild`, `nextSibling` and `ownerDocument`.

Each read goes through an accessor-half Proxy (`accessorHalf`), then `dispatchGet`, a `ctx` object and `proxyValue`. That is why the shape `el === doc || el.ownerDocument === doc` costs 5 ns under legacy and about 75 ns under every ppsc build, elided or not.

The fast path is a plain getter: call the native getter, and swap in the proxy only when the result is the real window or document. That would speed up DOM traversal under ppsc generally, not just calls on the document.

## Plan

Build the equivalence test first, so every later step is checked against it.

- [ ] Write an observational-equivalence test over every slot scramjet installs, comparing each patched member with its native: own keys and descriptors, `name`, `length`, `prototype`, `toString`, `new` behaviour and error messages, subclassing, the set of statics, and `getPrototypeOf` chains.
- [ ] Receiver-fix-only methods: install the direct wrapper from `render()` / `callableFor`.
- [ ] Methods with layers: a plain wrapper calling `dispatchApply`.
- [ ] Accessor halves: plain getters and setters in place of `accessorHalf`'s Proxy.
- [ ] Constructors: `new.target`, `prototype`, statics, `setPrototypeOf` to the parent's wrapper, the call-without-`new` message.
- [ ] Measure the attribute-getter fast path on the shapes (`parentNode`, `ownerDocument`).
- [ ] Run runway, then the Speedometer, Octane and shapes matrix against the current build.

## Context and open questions

This came out of the ppsc proxy-elision work on `exp/member-key-wrap`. That work is uncommitted, and the benchmark pages lived in a session scratchpad that will not persist.

- [ ] Does anything else in scramjet rely on the patched callable being a Proxy? `callableFor` passes `getOwnPropertyDescriptorHandler` as a trap, and its purpose needs checking.
- [ ] Does `toString` resolve a wrapper from another realm? `box` looks shared across realms, but that is unverified.
- [ ] Is the `Proxy` constructor itself ever patched? It is the one native needing the bound-function form.
