#!/usr/bin/env bash
# Editor support only: let overlay/ sources resolve the pinned checkout's dependencies, so the
# TypeScript projects in overlay/ type-check in place. Needs cache/Kicad installed (build.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
for package in tui opencode; do
  ln -sfn "../../../cache/Kicad/packages/$package/node_modules" "$SCRIPT_DIR/overlay/packages/$package/node_modules"
done
ln -sfn "../cache/Kicad/packages/plugin/node_modules" "$SCRIPT_DIR/overlay/node_modules"
