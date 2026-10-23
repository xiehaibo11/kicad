#!/usr/bin/env bash
# Build the kicad VS Code extension from the upstream Claudix
# submodule plus the local overlay.
#
# The overlay is applied to a throwaway copy of the submodule; nothing in
# tools/ai/upstream/Kicad-extension is modified, so the submodule can track upstream
# cleanly.  The result is written to tools/ai/Kicad-extension/dist/*.vsix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="$SCRIPT_DIR/../upstream/Kicad-extension"
OVERLAY="$SCRIPT_DIR/overlay"
APPLY="$SCRIPT_DIR/apply-overlay.mjs"

if [ ! -f "$UPSTREAM/package.json" ]; then
  echo "missing $UPSTREAM; run: git submodule update --init tools/ai/upstream/Kicad-extension" >&2
  exit 1
fi
for tool in node pnpm git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/Kicad-extension.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Copying upstream Claudix (git archive HEAD) to $BUILD_DIR ..."
git -C "$UPSTREAM" archive HEAD | tar -x -C "$BUILD_DIR"

echo "Applying KiCad overlay ..."
node "$APPLY" "$BUILD_DIR" "$OVERLAY"
cp "$SCRIPT_DIR/pnpm-lock.yaml" "$BUILD_DIR/pnpm-lock.yaml"
printf 'ignore-scripts=true\nverify-deps-before-run=false\n' > "$BUILD_DIR/.npmrc"
cp "$SCRIPT_DIR/README.md" "$BUILD_DIR/README.md"
cp "$SCRIPT_DIR/ARCHITECTURE_REVIEW.txt" "$BUILD_DIR/ARCHITECTURE_REVIEW.txt"
# Built-in KiCad tools share the native JavaScript implementation,
# shipped under resources/kicad and resolved by overlay/kicadRuntime.ts.
mkdir -p "$BUILD_DIR/resources/kicad"
node "$SCRIPT_DIR/../direct/build.mjs"
cp "$SCRIPT_DIR/../direct/dist/kicad-direct.mjs" "$SCRIPT_DIR/../direct/dist/LICENSE-protobufjs.txt" "$SCRIPT_DIR/../direct/dist/LICENSE-blocks-MIT.txt" "$BUILD_DIR/resources/kicad/"
cp "$SCRIPT_DIR/../composer/eda-agent-instructions.md" "$BUILD_DIR/resources/kicad/eda-agent-instructions.md"
bash "$SCRIPT_DIR/../Kicad-terminal/build-session-runtime.sh"
cp "$SCRIPT_DIR/../Kicad-terminal/dist/agent-doctor.mjs" "$BUILD_DIR/resources/kicad/"
cp "$SCRIPT_DIR/../Kicad-terminal/dist/session-runtime.mjs" "$BUILD_DIR/resources/kicad/session-runtime.mjs"

echo "Installing dependencies and packaging (first run can take a few minutes) ..."
(
  cd "$BUILD_DIR"
  # pnpm 10+ blocks dependency lifecycle scripts by default.  esbuild resolves
  # its binary through the @esbuild/<platform> optional dependency, and
  # @vscode/vsce-sign / keytar are only needed for signing and publishing, so
  # skipping the scripts is safe for a plain `vsce package`.
  pnpm install --frozen-lockfile --ignore-scripts
  # Replace the outdated upstream 2.0.76 CLI with the pinned effort-capable CLI.
  cp -R node_modules/@anthropic-ai/claude-code/. resources/claude-code/
  pnpm exec tsc --noEmit
  pnpm exec vue-tsc --noEmit -p src/webview/tsconfig.json
  node "$SCRIPT_DIR/test-vscode-launch.mjs"
  node "$SCRIPT_DIR/test-overlay.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-native-tools.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-lazy-tools.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-prompt-optimizer.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-composer.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-probe-lifecycle.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-provider-routing.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-membership.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-config-discovery.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-slash-menu.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-permissions.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-delegation.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-composer-keyboard.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-reasoning.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-dashboard.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-execution.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-editor-images.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-tool-content.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-inventory.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-lifecycle.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-model-selection.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-message-editing.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-continuity.mjs" "$BUILD_DIR"
  node "$SCRIPT_DIR/test-tool-output.mjs" "$BUILD_DIR"
  pnpm package
  # Check the deliverable, not just the compiler exit code.
  test -s dist/extension.cjs
  test -s dist/media/main.js
  test -s resources/claude-code/cli.js
  test -s resources/kicad/eda-agent-instructions.md
  node "$SCRIPT_DIR/test-bundle.mjs" "$BUILD_DIR"
)

mkdir -p "$SCRIPT_DIR/dist"
cp "$BUILD_DIR"/*.vsix "$SCRIPT_DIR/dist/"

echo
echo "Built:"
ls -1 "$SCRIPT_DIR"/dist/*.vsix

python3 "$SCRIPT_DIR/../build-manifest.py" extension "$SCRIPT_DIR" "$UPSTREAM"
