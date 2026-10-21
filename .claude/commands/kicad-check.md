---
description: Check kicad-agent health, capabilities, and the action catalog
allowed-tools: Bash, Read
---
Run `kicad-agent health` and `kicad-agent actions` in the repository root.
If the IPC socket is unavailable, report which commands still work (CLI-only
DRC/ERC/exports) and how to start a server with `kicad-agent call project.open`.
Summarize the capabilities relevant to the current file. $ARGUMENTS
