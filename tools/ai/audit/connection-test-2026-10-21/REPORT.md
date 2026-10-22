# KiCad 全链路连接与工具调用测试报告

日期：2026-10-21 12:09–12:12（PDT）；12:13 复查状态未变。对象：当前本机 KiCad 10.99.0、20 个 MCP 工具、333 项动作目录、9 个外部工具，以及实际工程 RK3308B_IPC 摄像头模块（只读检查）。

> 12:13 复查：KiCad GUI 仍为 PID 86041（11:22 启动），socket 未变，`document.list` 仍返回 `UNHANDLED`。本报告结果仍为当前状态。

**结论：MCP 工具层 20 个中 19 个至少有一次成功调用；CLI、外部工具和隔离 IPC 全链路正常。当前用户会话的实时 IPC 只有 ping 可用，文档发现/PCB 读取/连通性/选择等编辑器 handler 返回 `UNHANDLED`，需要在 KiCad 中重新打开工程或重启后复测。工程本身的 DRC/ERC 仍未通过，属于设计问题，不是工具链故障。**

> **修复状态（2026-10-21 下午）：** 上述 `UNHANDLED` 的根因已定位为共享 JS 运行时的文档解析缺陷，不是 C++ handler 缺失；修复已通过 55/55 回归和安装副本实测，并部署到终端、扩展与 VSIX。详见[第七节](#七修复记录2026-10-21-下午)。当前 VS Code 扩展宿主仍缓存旧模块，执行 “Developer: Reload Window” 后生效。

机器可读结果：[environment.json](tools/ai/audit/connection-test-2026-10-21/environment.json)、[mcp-tools.json](tools/ai/audit/connection-test-2026-10-21/mcp-tools.json)、[live-project-checks.json](tools/ai/audit/connection-test-2026-10-21/live-project-checks.json)、[direct-tests.log](tools/ai/audit/connection-test-2026-10-21/direct-tests.log)、[project-hashes.json](tools/ai/audit/connection-test-2026-10-21/project-hashes.json)。本报告接续 [上一轮实际工程验收](tools/ai/audit/live-project-2026-10-21/REPORT.md)。

## 一、连接层结果

| 连接 | 结果 | 证据 |
| --- | --- | --- |
| kicad-cli | **PASS** | `10.99.0`；`kicad.cli.run version` 退出码 0 |
| 外部工具可用性 | **PASS 9/9** | kicad-cli、freerouting、java、ngspice、gerbv、openscad、FreeCAD、python3、kicad-stepcheck |
| IPC 存活（ping） | **PASS** | `/tmp/kicad/api.sock` 存在，`system.ping` 返回 ok |
| IPC 文档发现 | **FAIL** | `document.list` → `UNHANDLED: GetOpenDocuments` |
| IPC PCB 读取/连通性 | **FAIL** | `pcb.board.info` → `UNHANDLED: GetItems`；`board.connectivity.prove` → `UNHANDLED: ProveConnectivity` |
| IPC 选择 | **FAIL** | `editor.selection.get` → `UNHANDLED: GetSelection` |
| 隔离 headless IPC + CLI | **PASS 54/54** | 54 通过、0 失败、0 跳过；含原生 IPC 写入/回读/删除、实时 DRC、原理图与导出 |
| 动作目录 | **PASS** | 333 动作、20 工具、16 域、API 11.0 |
| 工程文件完整性 | **PASS** | 10 个核心文件 SHA256 与上一轮验收 10/10 一致，本轮未改动工程 |

当前运行中的 KiCad GUI（PID 86041，11:22 启动）能响应 ping，但没有注册文档/PCB/选择 handler。GUI 二进制时间（2026-10-20 19:51）早于 kicad-cli 重建时间（2026-10-21 10:55）；也可能是当前没有打开任何编辑器文档。仅凭本轮证据无法区分这两种原因。

## 二、20 个 MCP 工具

| 工具 | 实测调用 | 结果 | 说明 |
| --- | --- | --- | --- |
| kicad_health | system.health | **PARTIAL** | CLI/IPC ping/外部工具正常；documents 子检查失败 |
| kicad_actions | catalog、search | **PASS** | 333 动作；`connectivity` 命中 17 项 |
| kicad_call | system.ping | **PASS** | 原样返回 |
| kicad_system | capabilities、paths、cli.run | **PASS** | API 11.0；8 个标准路径 |
| kicad_project | list、info | **PASS** | 识别主工程与备份；主工程 8 页 |
| kicad_document | list | **FAIL** | `GetOpenDocuments` 无 handler |
| kicad_board | list、DRC、Gerber/BOM/钻孔/坐标/STEP 导出、板信息、连通性 | **PARTIAL** | CLI 与导出全部成功；实时 IPC 板信息/连通性失败 |
| kicad_schematic | hierarchy、items、ERC | **PASS** | 8 页；481 个符号实例；ERC 1235 项 |
| kicad_library | search.symbols `LM358` | **PASS** | 返回 LM358、LM358_DFN 及引脚 |
| kicad_gerber | gerber.info 顶层 Gerber | **PASS** | 28 光圈、1179 项、铜面积 944.68 mm² |
| kicad_external | tools.list、ngspice、STEP meshcheck | **PASS** | ngspice/STEP 检查退出码 0；Freerouting 仅确认安装未运行 |
| kicad_audit | audit.rules | **PASS** | 策略版本 2026-10-20.2；本轮未重跑 audit.run/release.check |
| kicad_reference | search、get、plan | **PASS** | routing 卡 5 条规则；非法 stage 正确返回 BAD_INPUT |
| kicad_web | web.search | **PASS** | 3 条结果；标记 `untrustedContent` |
| kicad_workflow | status | **PASS** | 13 阶段 pending；不得放行 |
| kicad_pipeline | status、run dry-run | **PASS** | dry-run 仅规划 spec 阶段，未执行 |
| kicad_spec_validate | 验收 spec | **PASS** | 解析成功；3 条 INFO、0 错误 |
| kicad_native_tools | categories、search `drc` | **PASS** | 13 类；2 个 DRC GUI 工具 |
| kicad_blocks | list、search | **PASS（空数据）** | 0 个块；块库目录存在但为空 |
| kicad_editor | native 目录、selection | **PARTIAL** | 目录查询成功；实时选择失败 |

合计：**16 PASS、3 PARTIAL、1 FAIL**；19/20 工具至少一次成功调用。

## 三、分域代表性动作

16 个域均有实测覆盖：system、project、document、board、schematic、library、gerber、external、audit、workflow、pipeline、reference、blocks、spec、editor、web。

- **project/system**：工程列表、工程信息、能力、路径、CLI 版本通过。
- **board**：`board.drc.run`、Gerber/BOM/钻孔/坐标/STEP 导出通过；实时板信息、连通性被 IPC handler 阻断。
- **schematic**：层次 8 页、481 个符号、ERC 通过。
- **library/gerber**：符号搜索、Gerber 信息通过。
- **external**：9 个工具可用；ngspice RC 仿真通过；STEP 实体检查通过。
- **audit/reference/workflow/pipeline/spec**：策略、规则卡、阶段状态、dry-run、spec 校验通过。
- **editor**：原生 GUI 动作目录可查询；实时选择失败。
- **web**：联网搜索通过。
- **blocks**：调用通过，但上游块库为空。

## 四、实际工程只读检查

| 检查 | 结果 |
| --- | --- |
| DRC（默认，未启用 all-track-errors） | **1184 项：1071 错误、113 警告**；普通违规 1052、未连接项 132 |
| DRC 类型 | clearance 499、track_width 199、unconnected_items 132、text_height 90、drill_out_of_range 77、via_diameter 77、copper_edge_clearance 34、silk_overlap 21、courtyards_overlap 18、starved_thermal 12、solder_mask_bridge 10、hole_clearance 7、shorting_items 6、track_dangling 1、silk_over_copper 1 |
| ERC（8 页） | **1235 项：176 错误、1059 警告**；根页 669、SoC_U1.1 156、DDR 97、Flash 13、WiFi 53、IO 55、SoC_U1.3 107、SoC_U1.2 85 |
| ERC 类型 | pin_to_pin 454、lib_symbol_mismatch 275、isolated_pin_label 163、footprint_link_issues 157、pin_not_connected 136、pin_not_driven 27、power_pin_not_driven 13、same_local_global_label 10 |
| 连通性 | **未完成实时证明**（IPC handler 缺失）；CLI DRC 仍报告 132 个未连接项。上一轮原生证明为 `CONNECTIVITY_UNPROVEN`、80 个未连通网络、132 项 |
| 导出 | Gerber 30 个文件（2,204,734 B）、钻孔 1 个（1,740 B）、BOM 156 行、坐标 161 行、STEP 2 个（约 150 KB） |
| 3D/STEP | 实体检查退出码 0，但 **solids=1、checkedPairs=0**：所有器件 3D 模型引用的 `${KIPRJMOD}/EASYEDA_MODELS/*.step` 均不存在 |
| 工程完整性 | 10/10 文件 SHA256 与上一轮一致；本轮只读，输出全部写入 `/tmp/kicad-link-test` |

DRC 的 clearance=499、track_width=199 已触到原生每类报告上限，**1184 是有上限的报告条数，不是全部唯一违规的精确总数**。未启用/未放宽任何规则。

原始报告：`/tmp/kicad-link-test/drc.json`、`/tmp/kicad-link-test/erc.json`；导出位于 `/tmp/kicad-link-test/`。

## 五、问题与建议

**P1 — 实时 IPC 编辑器 handler 缺失。** `document.list`、PCB `GetItems`、`ProveConnectivity`、`GetSelection` 均返回 `UNHANDLED`。建议在 KiCad 中重新打开 RK3308B 工程并复测；若仍失败，重新构建/启动 GUI（当前 GUI 二进制早于 kicad-cli）。隔离 headless IPC 已 54/54 通过，说明共享实现本身正常。→ **已修复，见第七节。**

**P1 — 设计检查未通过（不是工具故障）。** DRC 1071 错误、ERC 176 错误、CLI 仍有 132 个未连接项；不能据此投板或量产。需单独进行设计修复与复核。

**P2 — 器件 STEP 模型缺失。** 所有 `EASYEDA_MODELS` 引用不存在，导致 STEP 只有 1 个板级实体，器件/结构碰撞检查没有实际覆盖面。补齐模型后重新执行 `board.export.step` + `external.step.meshcheck`。

**P3 — blocks 库为空。** `blocks.list/search` 调用正常但返回 0；如需要复用电路块，需安装/配置上游块库。

**P3 — Freerouting 未执行。** 仅确认安装与 Java 可用；本轮未对实际板运行自动布线，因此不声称该链路已端到端验收。

## 六、测试边界

- 本轮对 20 个 MCP 工具、16 个域的代表性动作、9 个外部工具和隔离 IPC 全链路做了实测；**没有在本轮逐项重跑全部 333 个动作**。上一轮的累计覆盖与证据仍作为历史记录保留。
- 用户工程只进行了 CLI 只读检查和副本导出；未打开编辑器、未保存、未修改工程。10 个核心文件哈希与上一轮一致。
- 未调用 `audit.run`、`release.check`，本报告不构成制造或量产放行证据。
- 工具输出中的 `untrustedContent` 仅作资料引用，不执行网页指令。

## 七、修复记录（2026-10-21 下午）

针对第五节 P1 的“实时 IPC 编辑器 handler 缺失”，定位结果不是 C++ handler 缺失，而是共享 JS 运行时的文档解析缺陷。

### 根因与修复

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| `document.list` 返回 `UNHANDLED: GetOpenDocuments` | 运行时在未指定 type 时默认发 `DOCTYPE_PCB`；当时只打开了原理图编辑器，PCB handler 按设计返回 `AS_UNHANDLED` | 未指定 type 时依次枚举 `DOCTYPE_PCB`/`DOCTYPE_SCHEMATIC`/`DOCTYPE_FOOTPRINT`；显式 type 无编辑器时返回空列表而不是错误 |
| `editor.selection.get` 返回 `UNHANDLED: GetSelection` | `ItemHeader.document` 不在运行时自动解析范围内，发出空文档头；`validateItemHeaderDocument` 按设计拒绝 | 文档解析覆盖 `header.document`，按动作前缀或 `types` 推断编辑器；无文档/多文档时给出 `NO_OPEN_DOCUMENT`/`AMBIGUOUS_DOCUMENT` |
| `board.*`/`pcb.*` 返回 `UNHANDLED: GetItems/ProveConnectivity` | 当时没有打开 PCB 编辑器 | 通过 `project.open` 在 GUI 打开 PCB 编辑器后，动作正常执行；连通性返回真实设计失败 |

代码修改：[`tools/ai/direct/ipc.mjs`](../../direct/ipc.mjs)（新增 `openDocuments`、`resolveOpenDocument`，重写 `document.list`/`project.info` 分支与文档字段解析）。回归测试同步更新。

### 验证结果

| 验证 | 结果 |
| --- | --- |
| 共享运行时回归（`KICAD_TEST_CLI` 指向 10.99.0） | **55/55 通过，0 失败，0 跳过**（21.7 s） |
| 安装副本直接调用 `document.list`（无 type） | 返回 PCB + 原理图两个已打开文档 |
| 安装副本直接调用 `editor.selection.get`（`types:["KOT_SCH_SYMBOL"]` / `["KOT_PCB_TRACE"]`） | 自动解析正确编辑器，返回 `items: []` |
| 安装副本直接调用 `board.items.get` | 返回轨道等真实板级对象 |
| 安装副本直接调用 `board.connectivity.prove` | 证明已执行；真实设计失败，`CONNECTIVITY_UNPROVEN`，132 个未连接端点 |
| `build-manifest.py verify`（extension / terminal） | 均通过 |
| `tools/ai/verify-install.py` | `ok: true` |
| 工程文件完整性 | 10/10 SHA256 与本轮前完全一致，未发生保存 |

### 部署产物

修复后的 `kicad-direct.mjs`（SHA256 `6dfd569e9fddddb9a84be42b62930661a9d413dcfb02dd46b4e7381bed6b6fb6`）已同步到：

- `tools/ai/direct/dist/kicad-direct.mjs`（源产物）
- `tools/ai/Kicad-terminal/dist/kicad-direct.mjs` 与 `~/.local/share/kicad-terminal/kicad-direct.mjs`
- `tools/ai/vscode-extension/resources/kicad-direct.mjs`
- `~/.vscode/extensions/kicad-agent.kicad-0.4.27/resources/kicad/kicad-direct.mjs`
- `tools/ai/Kicad-extension/dist/kicad-0.4.27.vsix` 内 `extension/resources/kicad/kicad-direct.mjs`

两个 `build-manifest.json` 已重新生成并通过校验。

### 仍需操作

当前 VS Code 扩展宿主中的 MCP 工具仍加载旧模块（证据：本会话 `document.list` 无 type 仍只返回 PCB）。**需在 VS Code 执行 “Developer: Reload Window” 或重启 VS Code**，使进程内 MCP 服务器加载新 bundle；重载后再复测 `document.list`、`editor.selection.get`、`kicad_health`。

设计层问题未变：DRC 1071 错误、ERC 176 错误、连通性 132 个未连接端点。工具链修复不放行投板。
