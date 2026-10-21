#!/usr/bin/env bash
# Bundle the upstream easyeda-agent stdio MCP adapter (EDA Agent Connector)
# into one self-contained ESM file, so the Kicad terminal and the VS Code
# extension can start it with plain `node` and no install step.
#
# Usage: build-easyeda-mcp.sh OUTPUT.mjs
set -euo pipefail

OUT="${1:?usage: build-easyeda-mcp.sh OUTPUT.mjs}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="$SCRIPT_DIR/../upstream/easyeda-agent"
export PATH="$HOME/.bun/bin:$PATH"

if [ ! -f "$UPSTREAM/mcp/src/server.mjs" ]; then
  echo "missing $UPSTREAM/mcp; run: git submodule update --init tools/ai/upstream/easyeda-agent" >&2
  exit 1
fi
for tool in git npm bun node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/easyeda-mcp.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Pinned sources (submodule HEAD) and the pinned MCP SDK lockfile.
git -C "$UPSTREAM" archive HEAD mcp | tar -x -C "$WORK"
(cd "$WORK/mcp" && npm ci --ignore-scripts --no-audit --no-fund --silent)
mkdir -p "$(dirname "$OUT")"
bun build "$WORK/mcp/src/server.mjs" --target=node --format=esm --outfile="$OUT" >/dev/null
chmod 644 "$OUT"

# The bundle must speak MCP: initialize and list tools against a stub CLI
# that only serves the offline action catalog.
STUB="$WORK/easyeda-stub"
cat > "$STUB" <<'STUB'
#!/bin/sh
[ "$1" = actions ] && { echo '[{"name":"system.health","domain":"system","mutates":false}]'; exit 0; }
echo '{"ok":false}'; exit 1
STUB
chmod +x "$STUB"
REPLY="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"build","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | EASYEDA_BIN="$STUB" node "$OUT" 2>/dev/null | head -n 2)"
case "$REPLY" in
  *easyeda_health*) echo "easyeda MCP bundle: $OUT" ;;
  *) echo "easyeda MCP bundle failed its tools/list check" >&2; exit 1 ;;
esac
