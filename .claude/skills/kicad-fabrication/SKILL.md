---
name: kicad-fabrication
description: 生成 KiCad 制造文件（Gerber、钻孔、坐标、BOM、STEP、IPC-2581、ODB++）并给出验证报告。Use automatically for "生成制造文件", "导出 Gerber", "出生产资料", "投板文件", "fabrication outputs", "export gerbers".
---

# Fabrication outputs

1. Run `board.drc.run` first and report the result. Never present outputs as
   ready while DRC errors remain.
2. Export with `kicad_board` actions `board.export.gerbers`,
   `board.export.drill`, `board.export.position` and `board.export.step`
   (optionally `board.export.ipc2581` / `board.export.odb`), plus
   `kicad_schematic` action `schematic.export.bom`. For a full spec-driven
   flow, use `kicad_pipeline` and report each stage from its report.
3. List every artifact path, the DRC/ERC counts and the connectivity proof
   result. Flag any failed or unimplemented stage.
