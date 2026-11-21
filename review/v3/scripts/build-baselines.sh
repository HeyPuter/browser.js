#!/usr/bin/env bash
# Build the frozen review baselines in ~/.cache/sjreview-v3/{up,head}.
#   up   = MercuryWorkshop/scramjet main (worktree of upstream/main, scramjet at repo root)
#   head = browser.js main at review start (c9af0cba), scramjet under packages/scramjet
# Recreate worktrees with:
#   git worktree add --detach ~/.cache/sjreview-v3/up upstream/main
#   git worktree add --detach ~/.cache/sjreview-v3/head c9af0cba
set -euo pipefail
which="${1:-both}"
build_up() {
	cd ~/.cache/sjreview-v3/up
	CI=1 pnpm install --frozen-lockfile
	(cd packages/core && pnpm rewriter:build)
	npx rspack build --mode production
}
build_head() {
	cd ~/.cache/sjreview-v3/head
	CI=1 pnpm install --frozen-lockfile
	./cv build scramjet --yes
}
case "$which" in
	up) build_up ;;
	head) build_head ;;
	both) (build_up) && (build_head) ;;
esac
