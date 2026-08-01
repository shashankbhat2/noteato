#!/usr/bin/env bash
# Builds NoteatoAgent and stages it where electron-builder's extraResources
# expects it. Run by `npm run build:agent:release`, and by the release workflow
# before electron-builder packages the app.
#
# Apple Silicon only, per revamp brief §6 — there is no degraded Intel path.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/resources"

swift build -c release --package-path "$ROOT/agent" --arch arm64

BIN="$(swift build -c release --package-path "$ROOT/agent" --arch arm64 --show-bin-path)/NoteatoAgent"
if [ ! -x "$BIN" ]; then
  echo "build-agent: expected binary at $BIN" >&2
  exit 1
fi

mkdir -p "$OUT"
cp "$BIN" "$OUT/NoteatoAgent"
echo "build-agent: staged $(du -h "$OUT/NoteatoAgent" | cut -f1) -> resources/NoteatoAgent"
