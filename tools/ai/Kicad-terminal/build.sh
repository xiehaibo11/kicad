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
python3 "$SCRIPT_DIR/test-launcher.py"
bash "$SCRIPT_DIR/build-session-runtime.sh"
node "$SCRIPT_DIR/apply-branding.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-composer.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-waiting.mjs" "$SOURCE_DIR"
node "$SCRIPT_DIR/apply-reasoning.mjs" "$SOURCE_DIR"
(
  cd "$SOURCE_DIR"
  bun install --frozen-lockfile --filter opencode --filter @opencode-ai/app --filter @opencode-ai/tui --filter @opencode-ai/client --filter @opencode-ai/core --filter @opencode-ai/server --filter @opencode-ai/httpapi-codegen --network-concurrency=12
  bun run --cwd packages/client generate
  bun run --cwd packages/tui typecheck
  bun run --cwd packages/opencode typecheck
  (cd packages/tui && bun test --timeout 30000 --only-failures)
  # Keep the embedded Web UI too: no --skip-embed-web-ui feature reduction.
  OPENCODE_VERSION=1.19.3 OPENCODE_CHANNEL=latest OPENCODE_RELEASE= bun run --cwd packages/opencode build --single --skip-install
)
mkdir -p "$SCRIPT_DIR/dist"
install -m 755 "$SOURCE_DIR/packages/opencode/dist/opencode-darwin-arm64/bin/opencode" "$SCRIPT_DIR/dist/kicad-terminal"
cp "$SOURCE_DIR/LICENSE" "$SCRIPT_DIR/dist/LICENSE-OpenCode.txt"
cp "$SCRIPT_DIR/upstream.json" "$SCRIPT_DIR/dist/upstream.json"
cp "$SOURCE_DIR/kicad-branding.json" "$SCRIPT_DIR/dist/branding.json"
cp "$SOURCE_DIR/kicad-composer.json" "$SCRIPT_DIR/dist/composer.json"
cp "$SOURCE_DIR/kicad-waiting.json" "$SCRIPT_DIR/dist/waiting.json"
# Auto-use tool routing and the EDA Agent Connector MCP bundle, loaded by launcher.sh.
cp "$SCRIPT_DIR/../composer/eda-agent-instructions.md" "$SCRIPT_DIR/dist/eda-agent-instructions.md"
"$SCRIPT_DIR/../composer/build-easyeda-mcp.sh" "$SCRIPT_DIR/dist/easyeda-mcp.mjs"
"$SCRIPT_DIR/dist/kicad-terminal" --version

python3 "$SCRIPT_DIR/../build-manifest.py" terminal "$SCRIPT_DIR" "$SOURCE_DIR"
