---
description: Route a board with the obstacle-aware planner and verify it
allowed-tools: Bash, Read
---
Run `kicad-agent route autoroute --planner grid --dry-run` first. Show the
planned per-net route counts and any skipped nets. If the plan looks sane and
the user asked to apply, rerun with `--apply`, then run DRC and
`board.connectivity.prove` and report both. Do not claim the board is routed if
either verification fails. $ARGUMENTS
