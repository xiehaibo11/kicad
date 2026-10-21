---
name: kicad-step-collision
description: KiCad 3D/结构检查：导出 STEP 并做精确实体碰撞、高度/外壳干涉检查。Use automatically for "3D 检查", "STEP 碰撞", "结构干涉", "器件高度", "check STEP collisions".
---

# STEP collision check

1. Call `kicad_board` action `board.check.3d` with the board. When an exact
   solid check is required, call `kicad_external` action `external.step.check`
   on the exported STEP.
2. Report the STEP path, the solid count, and every collision with component
   names and overlap volume. Say whether the check was verified.
3. If the export fails, report the missing 3D model paths instead of claiming
   success.
