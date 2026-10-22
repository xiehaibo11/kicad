---
name: kicad-environment
description: 检查 KiCad 环境/依赖/连接状态（kicad-cli、IPC API、已打开文档、Freerouting/ngspice 等外部工具）。Use automatically when the user asks to check, start or diagnose KiCad, e.g. "检查 KiCad 环境", "KiCad 启动了吗", "IPC 能用吗", "check kicad health".
---

# KiCad environment check

1. Call the built-in KiCad tool `kicad_health`. Shell fallback: `kicad-direct health`.
2. Report three layers separately: kicad-cli (version), IPC (socket
   `/tmp/kicad/api.sock` and whether it answers), and the loaded PCB and
   schematic documents. Then list external tools with available/missing and
   the install hint.
3. If the user's question depends on capabilities, call `kicad_actions`
   (filter with `search`) and summarize only the relevant domains.
4. If IPC is unavailable, say which work still runs CLI-only: DRC/ERC,
   exports, BOM, netlist and diff. To fix it, open the project in the KiCad
   GUI (`kicad-eda <project.kicad_pro>`, API server enabled) or call
   `kicad_project` action `project.open` for a headless server.
