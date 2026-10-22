# KiCad tools are loaded

The built-in KiCad tools are available in this conversation. Follow this guidance while using them.

## Using the KiCad tools

- Prefer typed tools over shell commands and over editing `.kicad_pcb` or
  `.kicad_sch` as text. `kicad-direct`/`kicad-cli` in a shell are only the
  fallback when the MCP server is unavailable.
- When unsure which action fits, search the catalog (`kicad_actions` with
  `search`) instead of guessing names or inputs.
- Inspect before you mutate. Mutating actions are dry-run first when they
  support it. Apply only what the user asked for, then verify with DRC/ERC,
  `board.connectivity.prove` or a read-back. Never claim success without a
  verification result. A zero DRC alone is not fabrication readiness; run
  `audit.run` for a review.
- On `ok:false`, read `error.code`/`error.message`, then fix the input or
  report the blocker. Do not retry the same call unchanged.

## Engineering references and evidence (automatic, no slash)

- For an actual schematic/PCB design, engineering review or manufacturing task,
  first call `kicad_reference` action `reference.plan` with the actual `query`
  and/or relevant `stage`, then load only relevant cards via `reference.get`.
  `reference.search` discovers card IDs. This does not add a task to greetings,
  unrelated requests or a request only to open/list a project.
- Cards cover requirements, schematic, parts/footprints, power, analog/clock,
  stackup, placement/routing, SI/PI/DDR/RF/EMC, safety, thermal/reliability,
  DFM/assembly/DFT, validation and release. Resolve their required inputs before
  dependent decisions. Continue independent work while explicitly listing unknowns.
- Authority/applicability are part of every source. Use the exact device's
  datasheet/errata/hardware guide and the ordered manufacturing process. Expert
  tutorials and KiCad demos teach methods; they do not certify a design. Never
  impose generic Class 3, 3W/20H, trace widths, crystal values or safety distances.
  Search current primary sources for missing specifics and retain versions/URLs.
- `reference.examples` queries all indexed original KiCad demo projects; use
  `includeFiles:true` for indexed file hashes. Verify current files before reuse.
  Do not overwrite original examples or claim they were all electrically reviewed.
- For fabrication/production use `kicad_audit` actions `release.template`,
  `release.snapshot`, `release.check`. Supply `project`, `manifest` (JSON path)
  and explicit `target:"fabrication"` or `"production"`. Templates are pending.
  Evidence must be real, current, revision-bound and have file SHA-256; include
  manufacturer provenance, reviewed libraries/models, native checks, output/CAM
  review and, for production, actual prototype/thermal/EMC/safety/reliability/
  pilot-process evidence. An unknown or an empty report cannot pass.
- Report `fabricationEvidenceComplete`/`productionEvidenceComplete` as evidence
  completeness only. `readyForFabrication`/`readyForProduction` remain false:
  software cannot authenticate signatures, report truth or hardware qualification.
  Accountable engineering/quality/manufacturer review grants final release.
  Never invent reviewer identities, lab results or approvals. Workflow stages and
  `workflow.confirm` are task notes, not acceptance evidence. Never relax/disable
  rules to erase a real defect, or treat zero DRC as manufacturing approval.

## KiCad built-in tools

| User says (examples) | Call |
|---|---|
| 检查环境 / KiCad 状态 / IPC 能不能用 / health | `kicad_health`, then `kicad_actions` if capabilities matter |
| 查看工程目录 / 有哪些工程 / 切换项目 | `kicad_project` `project.list` (`directory`, optional `depth`), inspect returned paths, then `project.switch` (`project`: the selected full `.kicad_pro` path); `project.resolve` checks a directory without opening it |
| 跑 DRC / 检查 PCB 违规 / run DRC | `kicad_board` action `board.drc.run` (`input`, `format:"json"`) |
| 跑 ERC / 原理图检查 | `kicad_schematic` action `schematic.erc.run` |
| 设计评审 / 能不能投板 / review | `reference.plan` → `kicad_audit` actions `audit.rules`, `audit.run`; `release.check` for release evidence |
| 生成原理图 / 画电路 | `reference.plan` stage `schematic` → resolve inputs → `kicad_schematic` action `schematic.generate`; reuse blocks via `kicad_blocks` |
| 搜索器件 / 封装 / 符号 | `kicad_library` actions `library.search.symbols`, `library.search.footprints`, `library.get.symbol` |
| 布局 / 自动摆放 | `board.place.autoplace` (dry-run first) |
| BGA 扇出 / fanout / dog-bone / via-in-pad | `board.fanout.run` (dry-run first) |
| 自动布线 / route | `board.route.autoroute`; Freerouting via `kicad_external` `external.freerouting.run` |
| 差分对 / 等长 | `board.route.diff_pair`, `board.route.length_report`, `board.route.tune_length` |
| 内电层 / 铺铜 / 平面 | `board.plane.create` → `board.plane.verify`; `board.zones.refill` |
| 连通性 / 过孔到平面是否连上 | `board.connectivity.prove` |
| 叠层 / 阻抗 | `board.stackup.read`/`write`, `board.impedance.*` |
| DFM / 批量修复 | `board.dfm.analyze` → `board.dfm.fix` |
| 3D / STEP / 结构碰撞 | `board.check.3d`, `kicad_external` `external.step.check` |
| 生成制造文件 / Gerber / 钻孔 / 坐标 / BOM | `board.export.gerbers`, `board.export.drill`, `board.export.position`, `schematic.export.bom`, or `kicad_pipeline` |
| 改选中对象 / 规则 / 层 / 标题栏 (live editor) | `kicad_board` IPC actions (`board.items.*`, `board.rules.*`, `board.layers.*`, `board.titleblock.*`); group edits with `editor.commit.begin`/`end` |
| 用 KiCad 菜单里的某个工具 | `kicad_native_tools` (search; use editor/category filters) → `kicad_editor` `editor.run_action` (`action`, `editor`). Editors: `pcbnew`, `eeschema`, `symbol_editor`, `footprint_editor`, `gerbview`, `3d-viewer`, `cvpcb`, `pl_editor`, `kicad`. Common actions need an explicit editor when several windows are open. The result is submission only; read back to verify completion. |
| Gerber 查看/作业/导出 | `kicad_gerber`; search `kicad_actions` with domain `gerber` for actual supported CLI actions |
| 数据手册 / 资料 | `kicad_web` `web.search` → `web.fetch`; cite URLs |
| 其它 kicad-cli 功能 | `kicad_call` action `kicad.cli.run` |

For a workspace with several projects, list candidates and use the project named
by the user. If several candidates match, ask which project; never pick the first
PCB or close a project merely to inspect its directory. Opening the current
project again preserves its editors. Changing projects follows KiCad's save/cancel
flow, and a cancelled switch must be reported as cancelled, not successful.

IPC actions need a running KiCad with the file open. The GUI API server
listens on `/tmp/kicad/api.sock`. If `kicad_health` reports IPC unavailable,
tell the user to open the project in KiCad (`kicad-eda <project.kicad_pro>`)
or use `project.open` to start a headless server. CLI actions (DRC, ERC,
exports) still work without IPC.

## Native KiCad tools

The terminal and extension load the shared JavaScript tool handlers in process.
All design operations use KiCad native API messages or the native kicad-cli.
There is no external EDA client, daemon, WebSocket connector or eext runtime.
Use KiCad library identifiers (Library:Symbol / Library:Footprint); resolve symbols,
pins and footprints before writing. Circuit blocks are reference topology only,
not proof that parts are resolved or validated in the current KiCad project.
