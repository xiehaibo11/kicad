#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.bun/bin:$PATH"
mkdir -p "$SCRIPT_DIR/dist"
cd "$SCRIPT_DIR"
bun build "$SCRIPT_DIR/overlay/session-runtime.ts" --target=node --format=esm --outfile="$SCRIPT_DIR/dist/session-runtime.mjs"
bun build "$SCRIPT_DIR/../composer/doctor.ts" --target=node --format=esm --outfile="$SCRIPT_DIR/dist/agent-doctor.mjs"
