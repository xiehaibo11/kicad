#!/usr/bin/env bash
# Install the terminal, Claude skill/commands, and (optionally) the VS Code
# extension for kicad-agent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT="$REPO_ROOT/build/bin/kicad-agent"
CLI="$REPO_ROOT/build/kicad/KiCad.app/Contents/MacOS/kicad-cli"
BIN_DIR="${HOME}/.local/bin"

if [ ! -x "$AGENT" ]; then
  echo "missing $AGENT; build with: ninja -C build kicad-agent" >&2
  exit 1
fi
if [ ! -x "$CLI" ]; then
  echo "missing $CLI; build with: ninja -C build kicad-cli" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/kicad-agent" <<WRAPPER
#!/bin/sh
exec "$AGENT" "\$@"
WRAPPER
cat > "$BIN_DIR/kicad-cli" <<WRAPPER
#!/bin/sh
export KICAD_RUN_FROM_BUILD_DIR=1
exec "$CLI" "\$@"
WRAPPER
chmod +x "$BIN_DIR/kicad-agent" "$BIN_DIR/kicad-cli"

# User-level Claude Code skill and slash commands.
mkdir -p "$HOME/.claude/skills/kicad-agent" "$HOME/.claude/commands"
cp "$REPO_ROOT/.claude/skills/kicad-agent/SKILL.md" "$HOME/.claude/skills/kicad-agent/SKILL.md"
cp "$REPO_ROOT"/.claude/commands/kicad-*.md "$HOME/.claude/commands/"

echo "Installed:"
echo "  $BIN_DIR/kicad-agent"
echo "  $BIN_DIR/kicad-cli"
echo "  ~/.claude/skills/kicad-agent/SKILL.md"
echo "  ~/.claude/commands/kicad-*.md"
echo
echo "Terminal:      kicad-agent health"
echo "Start server:  kicad-agent call project.open --payload '{\"document\":\"/abs/board.kicad_pcb\"}'"
echo "MCP (user):    claude mcp add --scope user kicad -- \"$AGENT\" mcp"
echo "VS Code:       cd tools/ai/vscode-extension && npx @vscode/vsce package --no-dependencies"

if command -v code >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/vscode-extension/kicad-agent-vscode-0.1.0.vsix" ]; then
  code --install-extension "$SCRIPT_DIR/vscode-extension/kicad-agent-vscode-0.1.0.vsix" --force >/dev/null 2>&1 \
    && echo "VS Code extension installed"
fi
