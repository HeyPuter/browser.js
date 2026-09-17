#!/bin/bash
# P4 randomness gate: N identical runs must produce identical web-crypto draws.
#
# Determinism claims need N runs, not two that agree (RULES.md #17) -- a passing
# pair has been wrong three times in this project.
#
#   CHROME=/path/to/Chromium ./p4gate.sh
CHROME="${CHROME:-$(cd "$(dirname "$0")/../../.." && pwd)/src/out/sbx/Chromium.app/Contents/MacOS/Chromium}"
FIXTURE="$(cd "$(dirname "$0")" && pwd)/fixtures/rand.html"
[ -x "$CHROME" ] || { echo "no Chromium at $CHROME (set CHROME=...)" >&2; exit 1; }

draws() {
  local key="$1" UDD args=""
  UDD=$(mktemp -d)
  [ -n "$key" ] && args="--sbxdiff-run-key=$key"
  TZ=America/Los_Angeles "$CHROME" --headless=new --no-sandbox --user-data-dir="$UDD" \
    --use-mock-keychain --enable-unsafe-swiftshader \
    --js-flags='--random-seed=1337 --hash-seed=1337' \
    $args --dump-dom "file://$FIXTURE" 2>/dev/null \
    | grep -oE '"draw1":"[0-9a-f]*","draw2":"[0-9a-f]*","uuid":"[0-9a-f-]*"'
  rm -rf "$UDD"
}

echo "--- same key x5: distinct results must be 1 ---"
for i in 1 2 3 4 5; do draws alpha-key; done | sort | uniq -c | sort -rn
echo "--- different key x2: must differ from above ---"
for i in 1 2; do draws beta-key; done | sort -u
echo "--- no key x3: must be 3 distinct ---"
for i in 1 2 3; do draws ""; done | sort | uniq -c | wc -l
