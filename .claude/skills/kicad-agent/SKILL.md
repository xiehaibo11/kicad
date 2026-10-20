---
name: kicad-agent
description: Design, route, and verify KiCad PCBs and schematics through the kicad-agent terminal. Use for DRC/ERC, schematic generation, BGA fanout, autorouting, differential pairs, length tuning, DFM, impedance, stackup, connectivity proof, and STEP collision checks.
---

# KiCad Agent

Use the `kicad-agent` terminal for every KiCad operation. It prints one JSON
envelope per command. Prefer typed actions over raw file edits: they go through
KiCad's commit/DRC/connectivity engines.

## First steps

1. `kicad-agent health` — confirms kicad-cli and the IPC socket.
2. `kicad-agent actions --domain board` — discover available actions.
3. For IPC actions, attach a headless server:
   `kicad-agent call project.open --payload '{"document":"/abs/board.kicad_pcb"}'`
   This returns `{socket,pid}`; pass `--socket <path>` to later commands (or set
   `KICAD_API_SOCKET`).

## Common workflows

- Schematic: `kicad-agent sch generate --spec circuit.json --project DIR` →
  ERC runs automatically. Search libraries with `kicad-agent sch search`.
- Place/route: `kicad-agent route autoroute --planner grid --apply`, then
  `kicad-agent call board.drc.run ...` and
  `kicad-agent call board.connectivity.prove ...`.
- Differential pair: `kicad-agent route diff-pair --pairs '[...]' --apply`.
  The router refuses pairs that would short other copper.
- Length: `kicad-agent route length --net N`; tune with
  `kicad-agent route tune --net N --target-mm L --apply`.
- Planes: `board.plane.create` then `board.plane.verify`; require
  `hasFilledPolygons` and zero unconnected pads.
- BGA: `kicad-agent fanout run ...` (dry-run by default; add `--apply`).
- DFM: `kicad-agent dfm analyze` then `dfm fix --apply`; angle violations are
  reported, never moved automatically.
- Fabrication: `kicad-agent pipeline run --spec design.spec.json --project DIR`.
- 3D: `kicad-agent structural check --document board.kicad_pcb --exact-step`
  runs OpenCASCADE solid intersection on the exported STEP.

## Rules

- Never claim success without a passing DRC/connectivity result.
- Mutating actions are opt-in: `--apply` or `"dryRun": false`.
- If a tool returns `ok:false`, read `error.code` and `data` before retrying.
- Prefer `--json` output and address items by UUID.
- Do not parse `.kicad_pcb`/`.kicad_sch` as the source of truth; use actions.
