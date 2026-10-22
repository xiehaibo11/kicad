---
name: kicad-routing
description: KiCad PCB 布局布线：自动摆放、BGA 扇出、自动布线（内置规划器/Freerouting）、差分对、等长、内电层/铺铜与连通性验证。Use automatically for "自动布线", "BGA 扇出", "差分对", "等长", "铺地/内电层", "route the board", "fanout".
---

# Placement and routing

1. Inspect first: `board.nets.get`, `board.items.get` and
   `board.stackup.read` on the board.
2. Plan in dry-run mode, then show the per-net counts and the skipped nets:
   - placement: `board.place.autoplace`
   - BGA escape: `board.fanout.run`
   - routing: `board.route.autoroute`, or Freerouting through
     `external.freerouting.run`
   - pairs: `board.route.diff_pair`
   - lengths: `board.route.length_report` → `board.route.tune_length`
   - planes: `board.plane.create` → `board.plane.verify`
3. Apply only when the user asked to, then verify with `board.drc.run` and
   `board.connectivity.prove`. Do not claim the board is routed if either
   verification fails.
