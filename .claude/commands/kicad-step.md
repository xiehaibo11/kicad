---
description: Run the exact STEP solid-collision check on a board
allowed-tools: Bash, Read
---
Run `kicad-agent structural check --document <board.kicad_pcb> --exact-step`.
Report the STEP path, solid count, every collision with component names and
overlap volume, and whether the check was verified. If export fails, report the
missing 3D model paths instead of claiming success. $ARGUMENTS
