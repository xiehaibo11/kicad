---
name: kicad-agent
description: Design, route, and verify KiCad PCBs and schematics through the shared native KiCad tools. Use for DRC/ERC, schematic generation, BGA fanout, autorouting, differential pairs, length tuning, DFM, impedance, stackup, connectivity proof, and STEP collision checks.
---

# KiCad Agent

Call the built-in `kicad_*` tools. Shell fallback is `kicad-direct`. It prints one JSON
envelope per command. Prefer typed actions over raw file edits: they go through
KiCad's commit/DRC/connectivity engines.

## First steps

1. `kicad-direct health` — confirms kicad-cli and the IPC socket.
2. `kicad-direct actions --domain board` — discover available actions.
3. For IPC actions, attach a headless server:
   `kicad-direct call project.open --payload '{"document":"/abs/board.kicad_pcb"}'`
   This returns `{socket,pid}`; pass `--socket <path>` to later commands (or set
   `KICAD_API_SOCKET`).

## Common workflows

- Schematic: `kicad-direct call schematic.generate --spec circuit.json --project DIR` →
  ERC runs automatically. Search libraries with `kicad-direct call library.search.symbols --query NAME`.
- Place/route: `kicad-direct call board.route.autoroute --planner grid --apply`, then
  `kicad-direct call board.drc.run ...` and
  `kicad-direct call board.connectivity.prove ...`.
- Differential pair: `kicad-direct call board.route.diff_pair --pairs '[...]' --apply`.
  The router refuses pairs that would short other copper.
- Length: `kicad-direct call board.route.length_report --net N`; tune with
  `kicad-direct call board.route.tune_length --net N --target-mm L --apply`.
- Planes: `board.plane.create` then `board.plane.verify`; require
  `hasFilledPolygons` and zero unconnected pads.
- BGA: `kicad-direct call board.fanout.run ...` (dry-run by default; add `--apply`).
- DFM: `kicad-direct call board.dfm.analyze` then `kicad-direct call board.dfm.fix --apply`; angle violations are
  reported, never moved automatically.
- Fabrication: `kicad-direct pipeline run --spec design.spec.json --project DIR`.
- 3D: `kicad-direct call board.check.3d --document board.kicad_pcb --exact-step`
  runs OpenCASCADE solid intersection on the exported STEP.

## Rules

- Never claim success without a passing DRC/connectivity result.
- Mutating actions are opt-in: `--apply` or `"dryRun": false`.
- If a tool returns `ok:false`, read `error.code` and `data` before retrying.
- Prefer `--json` output and address items by UUID.
- Do not parse `.kicad_pcb`/`.kicad_sch` as the source of truth; use actions.
