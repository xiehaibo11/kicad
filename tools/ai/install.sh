#!/usr/bin/env bash
# Install the terminal, Claude skill/commands, and (optionally) the VS Code
# extension with shared in-process KiCad tools.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT="$SCRIPT_DIR/direct/dist/kicad-direct.mjs"
CLI="$REPO_ROOT/build/kicad/KiCad.app/Contents/MacOS/kicad-cli"
BIN_DIR="${HOME}/.local/bin"

# Bundle the common runtime before installing either client.
# Keep the working checkout and user configuration intact.
node "$SCRIPT_DIR/direct/build.mjs"
python3 "$SCRIPT_DIR/build-manifest.py" verify "$SCRIPT_DIR/Kicad-terminal"
python3 "$SCRIPT_DIR/build-manifest.py" verify "$SCRIPT_DIR/Kicad-extension"
if [ ! -f "$AGENT" ]; then
  echo "missing $AGENT; build with: node tools/ai/direct/build.mjs" >&2
  exit 1
fi
if [ ! -x "$CLI" ]; then
  echo "missing $CLI; build with: ninja -C build kicad-cli" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/kicad-direct" <<WRAPPER
#!/bin/sh
exec "$(command -v node)" "$AGENT" "\$@"
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
chmod +x "$BIN_DIR/kicad-direct" "$BIN_DIR/kicad-cli" "$BIN_DIR/kicad-eda"
if [ -x "$REPO_ROOT/build/bin/kicad-stepcheck" ]; then
  install -m 755 "$REPO_ROOT/build/bin/kicad-stepcheck" "$BIN_DIR/kicad-stepcheck"
  install -m 755 "$REPO_ROOT/build/bin/kicad-stepcheck" "$(dirname "$CLI")/kicad-stepcheck"
fi
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
  cp -R "$skill/." "$HOME/.claude/skills/$name/"
  if [ "$name" = "kicad-engineering" ]; then
    mkdir -p "$HOME/.codex/skills/$name"
    cp -R "$skill/." "$HOME/.codex/skills/$name/"
  fi
done
cp "$REPO_ROOT"/.claude/commands/kicad-*.md "$HOME/.claude/commands/"
echo "Installed:"
echo "  $BIN_DIR/kicad-direct"
echo "  $BIN_DIR/kicad-cli"
echo "  $BIN_DIR/kicad-eda   (KiCad GUI, IPC on /tmp/kicad/api.sock)"
echo "  $BIN_DIR/Kicad   (AI terminal launcher; kicad remains compatible)"
echo "  ~/.claude/skills/kicad-*/SKILL.md   (auto-triggered, no slash needed)"
echo "  ~/.local/share/kicad-terminal/{eda-agent-instructions.md,session-runtime.mjs,kicad-direct.mjs}"
echo "  ~/.claude/commands/kicad-*.md"
echo
echo "Terminal:      Kicad"
echo "Check backend: kicad-direct health"
echo "Start GUI:     kicad-eda /abs/project.kicad_pro"
echo "Start server:  kicad-direct call project.open --payload '{\"document\":\"/abs/board.kicad_pcb\"}'"
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
"$BIN_DIR/kicad-direct" manifest > "$SCRIPT_DIR/audit/installed-capabilities.json"
python3 "$SCRIPT_DIR/Kicad-extension/audit-tools.py" --agent "$AGENT" --output "$SCRIPT_DIR/audit/installed-tools.json"
python3 "$SCRIPT_DIR/verify-install.py"
