---
name: kicad-agent
description: Design, route, and verify KiCad PCBs and schematics through the kicad MCP server (fallback - the kicad-agent terminal). Use automatically, without slash commands, for any KiCad/PCB/原理图/封装/布线/DRC/ERC/制造文件 request - DRC/ERC, schematic generation, BGA fanout, autorouting, differential pairs, length tuning, DFM, impedance, stackup, connectivity proof, STEP collision checks, native GUI tools and datasheet lookup.
---

# KiCad Agent

Call the `kicad` MCP tools directly; the user does not need to type a slash
command. Prefer typed actions over raw file edits: they go through KiCad's
commit, DRC and connectivity engines. If the MCP server is unavailable, the
same actions run from a shell as `kicad-agent call <action> --payload '<json>'`.
Every command prints exactly one JSON envelope.

## First steps

1. `kicad_health` confirms kicad-cli, the IPC socket (`/tmp/kicad/api.sock`
   for the KiCad GUI with the API server enabled) and the loaded documents.
2. `kicad_actions` (with `search` or `domain`) discovers actions and their
   inputs.
3. IPC actions need a live document. Either open the project in the GUI
   (`kicad-eda <project.kicad_pro>`), or call `kicad_project` action
   `project.open` for a headless server. That call returns `{socket,pid}`;
   pass the socket to later calls.

## Engineering constraints (automatic)

For design/review/manufacturing work, first use `kicad_reference` action
`reference.plan`, then relevant `reference.get` cards. Missing inputs stay
unresolved; use exact device and manufacturer requirements. For original demos
use `reference.examples`. For release use `kicad_audit` actions
`release.template`, `release.snapshot`, `release.check`; evidence completeness
is separate from accountable final engineering/quality/manufacturer approval.
Workflow flags are task tracking and cannot certify production readiness.

## Common workflows

- Schematic: `kicad_schematic` action `schematic.generate`; ERC runs
  automatically. Search libraries with `library.search.symbols` and
  `library.search.footprints`.
- Place/route: resolve stackup/constraints and protect locked items before
  scoped `board.place.autoplace` / `board.route.autoroute`, then
  `board.drc.run` and `board.connectivity.prove`.
- Differential pair: `board.route.diff_pair`. The router refuses pairs that
  would short other copper.
- Length: `board.route.length_report`, then `board.route.tune_length`.
- Planes: `board.plane.create`, then `board.plane.verify`. Require filled
  polygons and zero unconnected pads.
- BGA: `board.fanout.run` (dry-run by default).
- DFM: `board.dfm.analyze`, then `board.dfm.fix`. Angle violations are only
  reported, never moved automatically.
- Fabrication: `kicad_pipeline`, or the `board.export.*` actions.
- 3D: `board.check.3d` and `external.step.check` for an exact OpenCASCADE
  solid intersection.
- Native GUI tools: search with `kicad_native_tools`, then `kicad_editor`
  action `editor.run_action`.
- Review: `kicad_audit` actions `audit.rules` and `audit.run`.
- Datasheets: `kicad_web` actions `web.search` and `web.fetch`.

## Rules

- Never claim success without a passing DRC/connectivity result.
- Mutating actions are opt-in: dry-run first, then `"dryRun": false` or
  `--apply`.
- If a tool returns `ok:false`, read `error.code` and `data` before retrying.
- Address items by UUID.
- Do not parse `.kicad_pcb`/`.kicad_sch` as the source of truth; use actions.
