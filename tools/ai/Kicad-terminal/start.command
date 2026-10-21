#!/bin/zsh
# Start the complete branded terminal in this KiCad workspace.
set -e
cd "$(dirname "$0")/../../.."
export PATH="$HOME/.local/bin:$PATH"
printf '\033]0;Kicad 终端\007'
exec "$HOME/.local/bin/Kicad" "$@"
