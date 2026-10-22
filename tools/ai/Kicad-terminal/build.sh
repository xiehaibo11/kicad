#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${1:-$SCRIPT_DIR/cache/Kicad}"
export PATH="$HOME/.bun/bin:$PATH"
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'This build target is macOS arm64.' >&2
  exit 1
fi
if [ ! -d "$SOURCE_DIR/.git" ]; then
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone --depth 1 --branch v1.19.3 https://github.com/anomalyco/opencode.git "$SOURCE_DIR"
fi
test "$(git -C "$SOURCE_DIR" rev-parse HEAD)" = e3c4eb242585dcd77be1a867391b7c25fd47ce52
# Overlays apply to a pristine checkout, so every build is reproducible from this directory.
# Ignored files (node_modules, build caches) are kept.
git -C "$SOURCE_DIR" checkout -- .
git -C "$SOURCE_DIR" clean -fdq
python3 "$SCRIPT_DIR/test-launcher.py"
python3 "$SCRIPT_DIR/test-retire-legacy.py"
bash "$SCRIPT_DIR/build-session-runtime.sh"
node "$SCRIPT_DIR/../direct/build.mjs"
cp "$SCRIPT_DIR/../direct/dist/kicad-direct.mjs" "$SCRIPT_DIR/../direct/dist/LICENSE-protobufjs.txt" "$SCRIPT_DIR/../direct/dist/LICENSE-blocks-MIT.txt" "$SCRIPT_DIR/dist/"
node "$SCRIPT_DIR/apply-branding.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-composer.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-waiting.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-reasoning.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-workbench.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-runtime-fixes.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-demand.mjs" "$SOURCE_DIR"
(
  cd "$SOURCE_DIR"
  bun install --frozen-lockfile --filter opencode --filter @opencode-ai/app --filter @opencode-ai/tui --filter @opencode-ai/client --filter @opencode-ai/core --filter @opencode-ai/server --filter @opencode-ai/httpapi-codegen --network-concurrency=12
  bun run --cwd packages/client generate
  bun run --cwd packages/tui typecheck
  bun run --cwd packages/opencode typecheck
  (cd packages/tui && bun test --timeout 30000 --only-failures)
  # Kicad's own runtime tests: on-demand KiCad tools and the update channel.
  (cd packages/opencode && bun test test/kicad --timeout 30000)
  # Keep the embedded Web UI too: no --skip-embed-web-ui feature reduction.
  OPENCODE_VERSION=1.19.3 OPENCODE_CHANNEL=latest OPENCODE_RELEASE= bun run --cwd packages/opencode build --single --skip-install
)
# Editor support: overlay/ sources type-check in place against the installed checkout.
bash "$SCRIPT_DIR/link-overlay.sh"
mkdir -p "$SCRIPT_DIR/dist"
install -m 755 "$SOURCE_DIR/packages/opencode/dist/opencode-darwin-arm64/bin/opencode" "$SCRIPT_DIR/dist/kicad-terminal"
cp "$SOURCE_DIR/LICENSE" "$SCRIPT_DIR/dist/LICENSE-OpenCode.txt"
cp "$SCRIPT_DIR/upstream.json" "$SCRIPT_DIR/dist/upstream.json"
cp "$SOURCE_DIR/kicad-branding.json" "$SCRIPT_DIR/dist/branding.json"
cp "$SOURCE_DIR/kicad-composer.json" "$SCRIPT_DIR/dist/composer.json"
cp "$SOURCE_DIR/kicad-waiting.json" "$SCRIPT_DIR/dist/waiting.json"
# Built-in KiCad tool instructions, loaded by launcher.sh.
cp "$SCRIPT_DIR/../composer/eda-agent-instructions.md" "$SCRIPT_DIR/dist/eda-agent-instructions.md"
"$SCRIPT_DIR/dist/kicad-terminal" --version

python3 "$SCRIPT_DIR/../build-manifest.py" terminal "$SCRIPT_DIR" "$SOURCE_DIR"
