---
name: kicad-drc-review
description: 对 KiCad PCB 跑 DRC/ERC 并分类整理违规、给出修复建议；设计评审/投板前检查。Use automatically for "跑 DRC", "检查 PCB 违规", "ERC", "能不能投板", "review the board", "design rule check".
---

# DRC / ERC triage

1. Find the board: the `.kicad_pcb` the user names or the one in the
   workspace. Call `kicad_board` action `board.drc.run` with `input`,
   `format:"json"` and `timeoutMs:300000`. For schematics, call
   `kicad_schematic` action `schematic.erc.run`.
2. Group violations by severity and type. List the affected nets and items,
   and propose concrete fixes. Do not edit the board unless asked.
3. For a fabrication-readiness question, also call `kicad_audit` actions
   `audit.rules` and `audit.run`. Zero DRC alone is not readiness.
4. Live-editor checks (with IPC): `board.connectivity.prove` proves pad, via
   and plane connectivity, including filled zones.
