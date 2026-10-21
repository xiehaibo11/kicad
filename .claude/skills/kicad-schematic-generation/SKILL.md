---
name: kicad-schematic-generation
description: 根据电路描述/规格 JSON 生成 KiCad 原理图、放置符号、连线并跑 ERC；搜索符号和封装库。Use automatically for "画原理图", "生成原理图", "放一个电阻/芯片", "搜索封装", "generate a schematic", "place symbol".
---

# Schematic generation

1. Search parts: `kicad_library` actions `library.search.symbols`,
   `library.get.symbol` and `library.search.footprints`. Reuse proven
   circuits through `kicad_blocks`.
2. Validate a spec with `kicad_spec_validate`. Then call `kicad_schematic`
   action `schematic.generate` (spec and project directory). For single
   edits, use `schematic.place.symbol` / `schematic.items.*`.
3. Map each ERC violation back to the spec: missing PWR_FLAG, unconnected
   pin, duplicate reference. Propose the spec change. Report the placed parts,
   the net labels and the ERC result.
