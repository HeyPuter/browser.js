# Development Setup

Node.js 22.18+ and pnpm are required. Everything else goes through `./cv`
(`.\cv.ps1` on Windows, or `pnpm cv`), which installs dependencies, fetches
dreamland at its pinned commit, builds the rust rewriter and only rebuilds what
changed.

```bash
./cv chrome        # browser.js dev server (chrome + wisp + isolation zone + rspack watch)
./cv dev           # scramjet's own dev server (demo page)
./cv build         # build everything
./cv build chrome  # just the frontend and what it needs
./cv build wasm    # just the rust rewriter
./cv test          # runway tests (args are forwarded, e.g. --headed, --parallel 4)
./cv npm           # release build + pnpm pack of every published package
./cv               # help, including every target and command
```

The rewriter needs rust nightly plus `wasm-bindgen-cli`, `wasm-opt` and
`wasm-snip`; if cargo is installed, `cv` offers to install the rest for you
(`--yes` skips the prompt).

Useful flags: `--why` explains why a task runs, `--dry` shows the plan,
`--force` ignores the change tracking. Each package declares its tasks in a
`cv.ts` next to its `package.json`; the runner lives in
`packages/scramjet/packages/cv`.
