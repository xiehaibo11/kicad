---
description: Check kicad-direct health, capabilities, and the action catalog
allowed-tools: Bash, Read
---
Run `kicad-direct health` and `kicad-direct actions` in the repository root.
If the IPC socket is unavailable, report which commands still work (CLI-only
DRC/ERC/exports) and how to start a server with `kicad-direct call project.open`.
Summarize the capabilities relevant to the current file. $ARGUMENTS
