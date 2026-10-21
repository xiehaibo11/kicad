#!/usr/bin/env bash
# Install this checkout's verified, complete Kicad terminal without rebuilding KiCad.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX="$HOME/.local"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo 'Kicad: --prefix requires an installation directory.' >&2
        exit 2
      fi
      PREFIX="$2"
      shift 2
      ;;
    -h|--help)
      printf '%s\n' 'Install Kicad terminal from this checkout.' \
        'Usage: bash tools/ai/Kicad-terminal/install.sh [--prefix DIRECTORY]' \
        'Default: ~/.local/bin/Kicad; start with: Kicad' \
        'For the KiCad backend and VS Code extension too: bash tools/ai/install.sh'
      exit 0
      ;;
    *) echo "Kicad: unknown installer option: $1" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { echo 'Kicad: python3 is required by the launcher.' >&2; exit 1; }
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Kicad: this checkout currently provides a macOS Apple Silicon build.' >&2
  exit 1
fi
if [ ! -x "$SCRIPT_DIR/dist/kicad-terminal" ]; then
  echo 'Kicad: build the terminal first: bash tools/ai/Kicad-terminal/build.sh' >&2
  exit 1
fi
python3 "$SCRIPT_DIR/../build-manifest.py" verify "$SCRIPT_DIR"
PREFIX="$(python3 -c 'import os,sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$PREFIX")"
BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/kicad-terminal"
mkdir -p "$BIN_DIR" "$SHARE_DIR"

STAGE="$(mktemp -d "$BIN_DIR/.Kicad-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
install -m 755 "$SCRIPT_DIR/dist/kicad-terminal" "$STAGE/kicad-terminal"
install -m 755 "$SCRIPT_DIR/launcher.sh" "$STAGE/Kicad"
python3 - "$STAGE" "$BIN_DIR" "$SHARE_DIR" "$SCRIPT_DIR/dist" <<'PY'
import os
from pathlib import Path
import shutil
import sys
import tempfile

stage, binary, share, dist = map(Path, sys.argv[1:])
# Never write through the historical kicad -> kicad-cli symlink.
# Publish the launcher last, after all of its dependencies are in place.
for name in ('Kicad', 'kicad', 'kicad-terminal'):
    if (binary / name).is_dir():
        raise SystemExit(f'Kicad: cannot replace a directory: {binary / name}')
for name in ('LICENSE-OpenCode.txt', 'upstream.json', 'composer.json', 'waiting.json',
             'eda-agent-instructions.md', 'session-runtime.mjs', 'easyeda-mcp.mjs'):
    with tempfile.NamedTemporaryFile(dir=share, prefix='.Kicad-', delete=False) as stream:
        temporary = Path(stream.name)
    try:
        shutil.copyfile(dist / name, temporary)
        temporary.chmod(0o644)
        os.replace(temporary, share / name)
    finally:
        temporary.unlink(missing_ok=True)
os.replace(stage / 'kicad-terminal', binary / 'kicad-terminal')
os.replace(stage / 'Kicad', binary / 'Kicad')
primary, legacy = binary / 'Kicad', binary / 'kicad'
if legacy.exists() and os.path.samestat(primary.lstat(), legacy.lstat()):
    # APFS commonly resolves both spellings to one file. Set its visible name
    # with a case-only rename; installing two symlinks would create a loop.
    os.rename(legacy, primary)
else:
    os.symlink('Kicad', stage / 'kicad')
    os.replace(stage / 'kicad', legacy)
PY

printf '\nKicad installed: %s\n' "$BIN_DIR/Kicad"
VERSION="$("$BIN_DIR/Kicad" --version)"
printf 'Version: %s\n' "$VERSION"
printf '\nStart:   Kicad\nHelp:    Kicad --help\nResume:  Kicad --continue\n'
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '\nAdd the installation directory to PATH:\n  export PATH=%s:"$PATH"\n' \
       "$(python3 -c 'import shlex,sys; print(shlex.quote(sys.argv[1]))' "$BIN_DIR")" ;;
esac
if [ ! -x "$BIN_DIR/kicad-agent" ] || [ ! -x "$BIN_DIR/kicad-cli" ]; then
  printf '\nTo install the KiCad backend and VS Code extension too:\n  bash tools/ai/install.sh\n'
fi
