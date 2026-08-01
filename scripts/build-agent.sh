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

BIN_DIR="$(swift build -c release --package-path "$ROOT/agent" --arch arm64 --show-bin-path)"
mkdir -p "$OUT"

# Both binaries ship. NoteatoTranscribe is a separate process because the ASR
# model peaks near the agent's whole memory budget, and the agent looks for it
# beside itself — so they have to land in the same directory.
for name in NoteatoAgent NoteatoTranscribe; do
  if [ ! -x "$BIN_DIR/$name" ]; then
    echo "build-agent: expected binary at $BIN_DIR/$name" >&2
    exit 1
  fi
  cp "$BIN_DIR/$name" "$OUT/$name"
  echo "build-agent: staged $(du -h "$OUT/$name" | cut -f1) -> resources/$name"
done
