---
description: Run DRC on a KiCad board and triage the violations
allowed-tools: Bash, Read
---
Run `kicad-direct call board.drc.run` with the board path (default: the active
`.kicad_pcb` in the workspace), `format: "json"`, and a 300000 ms timeout.
Group violations by severity and type, list the affected nets/items, and
propose concrete fixes. Do not edit the board unless the user asks. $ARGUMENTS
