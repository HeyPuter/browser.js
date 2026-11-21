# scramjet v3: notes for embedders (draft)

Breaking or behaviour changes from v2 (`MercuryWorkshop/scramjet` main as of 2026-11-20) that the v3 review found. Each one is deliberate. This is a draft for the release notes; where it goes is up to the maintainers.

## Configuration

- **`siteFlags` is gone from the core config.** In v2, `scramjetConfig.siteFlags` mapped URL regexes to flag overrides, and core applied them per URL. In v3 an old `siteFlags` entry is **silently ignored**. Per-frame overrides are now set when creating the frame:
  ```js
  controller.createFrame(iframe, { flags: { captureErrors: true } });
  ```
  They apply to everything loaded in that frame (subframes, workers, and popups that use its prefix), whatever site it navigates to. There is no per-URL matching any more.
- **Removed flags:** `scramitize`, `allowFailedIntercepts`.
- **New flag:** `incumbency: "pst" | "stamp" | "lazystamp" | "none"`. The defaults choose `pst` on V8 and `lazystamp` elsewhere.
- **`cleanErrors` is on by default.** Stack traces have scramjet's own frames removed and proxied URLs restored. While it's on, `Error.prepareStackTrace` belongs to scramjet: a page's assignment is ignored (SCR-39).

## Stored site data

- **localStorage, sessionStorage, IndexedDB, Cache Storage and OPFS are keyed differently** (for example `https://example.com@key` for storage keys). Data stored under v2 isn't found by v3, so users upgrading lose site data, including logins. There is no migration; this was accepted for v3.

## Client API (`client.Proxy` / `RawProxy` / `Trap` / `Intercept`)

- **`RawProxy(instance, key)` wraps the member for every object that inherits it.** The patch lands on the prototype that owns the member, not on `instance`. v2 defined an own property on the instance. An embedder that relied on per-instance wrapping now has to filter on `ctx.this` in its handler.
- **Layer order** is core's base, then embedder layers (latest outermost), then anything the page installs on top. A page wrapper installed after `hook()` stays outermost when an embedder adds a layer later.
- **`Intercept()` after `hook()` throws.** Use `Proxy`/`Trap` for late patches.
- `Proxy` and `Trap` still accept an array of names, as in v2.

## Service worker

- The worker learns each controller's base prefix from its init message and keeps the set in Cache Storage (`$controller$sw`), so it can route requests after being stopped and restarted. With that cache emptied by hand, an open page's requests went to the host instead; no natural trigger has been reproduced (SCR-32).
- Request bodies are buffered (`request.arrayBuffer()`) rather than streamed, so they carry a `Content-Length` as in Chrome. True `duplex: "half"` streaming uploads aren't streamed.
