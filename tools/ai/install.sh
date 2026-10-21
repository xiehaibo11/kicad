#!/usr/bin/env bash
# Install the terminal, Claude skill/commands, and (optionally) the VS Code
# extension for kicad-agent.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT="$REPO_ROOT/build/bin/kicad-agent"
CLI="$REPO_ROOT/build/kicad/KiCad.app/Contents/MacOS/kicad-cli"
BIN_DIR="${HOME}/.local/bin"

# Rebuild from current sources, including go:embed inputs, before any installation.
# Keep the working checkout and user configuration intact.
cmake --build "$REPO_ROOT/build" --target kicad-agent --parallel 4
python3 "$SCRIPT_DIR/build-manifest.py" verify "$SCRIPT_DIR/Kicad-terminal"
python3 "$SCRIPT_DIR/build-manifest.py" verify "$SCRIPT_DIR/Kicad-extension"
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
# `kicad-eda` starts the KiCad GUI from the build tree; its IPC API server
# (Preferences > Plugins > Enable KiCad API) listens on /tmp/kicad/api.sock.
cat > "$BIN_DIR/kicad-eda" <<WRAPPER
#!/bin/sh
export KICAD_RUN_FROM_BUILD_DIR=1
exec "$(dirname "$CLI")/kicad" "\$@"
WRAPPER
chmod +x "$BIN_DIR/kicad-agent" "$BIN_DIR/kicad-cli" "$BIN_DIR/kicad-eda"
# The standalone installer and the full installation share the same Kicad entry.
# Native EDA commands remain available through kicad-cli.
bash "$SCRIPT_DIR/Kicad-terminal/install.sh"

# Seed the DeepSeek credentials used by the chat extension.  The key stays in
# the user's home directory (mode 600), never in the built VSIX.  An existing
# file is never overwritten.  Delete it and use "Kicad: Set DeepSeek API Key"
# to manage the key through VS Code SecretStorage instead.
DEEPSEEK_FILE="$HOME/.kicad-agent/deepseek.json"
if [ ! -f "$DEEPSEEK_FILE" ] && [ -f "$REPO_ROOT/模型.md" ]; then
  DEEPSEEK_KEY="$(grep -o 'sk-[A-Za-z0-9]*' "$REPO_ROOT/模型.md" | head -n 1 || true)"
  if [ -n "$DEEPSEEK_KEY" ]; then
    mkdir -p "$HOME/.kicad-agent"
    chmod 700 "$HOME/.kicad-agent"
    ( umask 077
      printf '{\n  "apiKey": "%s",\n  "baseUrl": "https://api.deepseek.com/anthropic"\n}\n' \
        "$DEEPSEEK_KEY" > "$DEEPSEEK_FILE" )
    chmod 600 "$DEEPSEEK_FILE"
    echo "DeepSeek key seeded: $DEEPSEEK_FILE"
  fi
fi

# User-level skills, auto-triggered by plain requests in Claude Code and the
# Kicad terminal (OpenCode also reads ~/.claude/skills). Slash commands remain
# optional aliases.
mkdir -p "$HOME/.claude/skills" "$HOME/.claude/commands"
for skill in "$REPO_ROOT"/.claude/skills/kicad-*/; do
  name="$(basename "$skill")"
  mkdir -p "$HOME/.claude/skills/$name"
  cp "$skill/SKILL.md" "$HOME/.claude/skills/$name/SKILL.md"
done
cp "$REPO_ROOT"/.claude/commands/kicad-*.md "$HOME/.claude/commands/"
# EDA Agent Connector skill from the pinned upstream; a skill the user installed
# or updated with `easyeda skill` is left as is.
EASYEDA_SKILL="$SCRIPT_DIR/upstream/easyeda-agent/.agents/skills/easyeda-agent"
if [ ! -f "$HOME/.claude/skills/easyeda-agent/SKILL.md" ] && [ -f "$EASYEDA_SKILL/SKILL.md" ]; then
  cp -R "$EASYEDA_SKILL" "$HOME/.claude/skills/easyeda-agent"
fi

echo "Installed:"
echo "  $BIN_DIR/kicad-agent"
echo "  $BIN_DIR/kicad-cli"
echo "  $BIN_DIR/kicad-eda   (KiCad GUI, IPC on /tmp/kicad/api.sock)"
echo "  $BIN_DIR/Kicad   (AI terminal launcher; kicad remains compatible)"
echo "  ~/.claude/skills/kicad-*/SKILL.md   (auto-triggered, no slash needed)"
echo "  ~/.local/share/kicad-terminal/{eda-agent-instructions.md,easyeda-mcp.mjs}"
echo "  ~/.claude/commands/kicad-*.md"
echo
echo "Terminal:      Kicad"
echo "Check backend: kicad-agent health"
echo "Start GUI:     kicad-eda /abs/project.kicad_pro"
echo "Start server:  kicad-agent call project.open --payload '{\"document\":\"/abs/board.kicad_pcb\"}'"
echo "MCP (user):    claude mcp add --scope user kicad -- \"$AGENT\" mcp"
echo "VS Code:       tools/ai/Kicad-extension/build.sh"

# Install the Claudix-based KiCad extension if it has already been built; the
# build needs pnpm and takes a few minutes, so it is left to the user to run
# explicitly (see the VS Code line above).
VSIX_DIR="$SCRIPT_DIR/Kicad-extension/dist"
CODE_BIN="$(command -v code || true)"
if [ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
  CODE_BIN="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
fi
if [ -n "$CODE_BIN" ] && [ -d "$VSIX_DIR" ]; then
  VSIX="$(ls -t "$VSIX_DIR"/*.vsix 2>/dev/null | head -n 1 || true)"
  if [ -n "$VSIX" ]; then
    "$CODE_BIN" --install-extension "$VSIX" --force
    echo "VS Code extension installed: $(basename "$VSIX")"
    "$CODE_BIN" --list-extensions --show-versions | grep -F "kicad-agent.kicad@"

  fi
fi

# Store the actual compiled capabilities alongside source and artifact hashes.
mkdir -p "$SCRIPT_DIR/audit"
"$BIN_DIR/kicad-agent" manifest > "$SCRIPT_DIR/audit/installed-capabilities.json"
python3 "$SCRIPT_DIR/Kicad-extension/audit-tools.py" --agent "$AGENT" --output "$SCRIPT_DIR/audit/installed-tools.json"
python3 "$SCRIPT_DIR/verify-install.py"
