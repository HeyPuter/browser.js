# Shell development and tests

After installing dependencies and building Dreamland and the Rust rewriter using
the repository's normal setup, run:

```sh
CI=1 pnpm build
pnpm -C packages/chrome typecheck
pnpm -C packages/chrome test
pnpm -C packages/chrome build
```

The workspace build waits for TypeScript declarations and fails if their
generation fails. It also publishes `controller.sw.js` and its source map to
`packages/chrome/public` and `packages/sandbox`. These are generated assets;
build the workspace before building or serving the shell. Changes to controller
sources are published automatically by the workspace watcher.

Model tests require Node 22.15+ for `registerHooks`. They run real shell models
and Dreamland state with application bootstrap replaced by a small fixture.

For the browser smoke test, run `pnpm dev` in another terminal, then:

```sh
pnpm -C packages/chrome test:browser
```

The test uses Playwright from the workspace's Runway package and a fresh Chrome
profile. It opens Settings, loads a proxied localhost document through the
configured transport, and verifies a page-initiated fetch. Uncaught page errors
fail the test. Chrome must be installed; set `CHROME_EXECUTABLE_PATH` to use a
different Chromium executable, or `BROWSER_URL` for a different dev-server URL.

The shell typecheck and workspace declaration build are separate from Scramjet
core's standalone `tsc --noEmit` check, which still has existing diagnostics.
