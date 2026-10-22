# KiCad 实际工程与两端直连验收

日期：2026-10-21。范围：修复实际窗口的 IPC 连接，打开 RK3308B_IPC 摄像头模块工程，复查上一轮未通过的能力，并从聊天面板和扩展内终端执行原生工作流。本报告接续 [上一轮工具审查](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/REPORT.md)，以前轮结果为历史证据，以本目录为当前验收结果。

**结果：实际工程已打开，聊天面板与扩展内终端均连接 `/tmp/kicad/api.sock`。两端在线模型已完成原生文档发现、实时 DRC/ERC、SVG 和网表导出、连通性检查。工具链可用；当前工程仍有原生违规和未连接项，未通过制造/交付放行。**

当前安装：主扩展 **0.4.27**，终端 **1.19.3**，npm 与轻量扩展 **0.1.2**，本地原生 KiCad **10.99.0**。运行状态和构建包版本以本报告及构建清单为准；上一版扩展 README 中的 0.4.26 属于旧版本说明。

## 实际调用路径

```text
聊天面板 → 扩展宿主中的 SDK 工具绑定 ─┐
                                    ├→ 同一共享 JavaScript 实现
扩展内终端 → 终端进程中的工具插件 ───┘    ├→ KiCad C++ 编辑器原生 IPC
                                         ├→ 原生 kicad-cli 检查/导出任务
                                         └→ 同进程 JS 工作流、关闭文档的文件事务
```

`mcp__kicad__...` 是聊天 SDK 的进程内注册名，没有独立 stdio MCP 转发服务。原生 IPC 是到拥有实时文档的 KiCad 编辑器的接口。两端均直接导入共享模块，没有 Go daemon、嘉立创客户端、WebSocket 连接器或 `.eext` 运行依赖。

自动布线、仿真、STEP 碰撞检查等能力会直接运行明确标注的 freerouting、ngspice、OpenCASCADE 检查器等程序。它们是外部实用程序，并非 KiCad 内置算法。联网搜索与参考资料也是辅助能力，不能称为 KiCad 编辑器内部功能。

源路径：[聊天工具绑定](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/kicadRuntime.ts:123)、[终端工具插件](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-terminal/overlay/session-runtime.ts:12)、[共享分派](/Users/mosc/Downloads/Kicad/tools/ai/direct/runtime.mjs:58)、[IPC 协议实现](/Users/mosc/Downloads/Kicad/tools/ai/direct/ipc.mjs:47)。[provenance.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/provenance.json) 保存原生二进制和调用源文件 SHA256。

## 本轮修复及未通过项处理

| 问题 | 处理与验证 |
| --- | --- |
| 扩展内终端 IPC 未连接 | 空配置被写入 `KICAD_API_SOCKET=''`，IPC 构造函数又将空串视为有效路径。扩展现在仅传入非空 socket，共享实现对空值回退原生默认 socket。空参数/空环境变量回归及两端实际连接通过。 |
| live ERC 仅检查根页 | 原生 `SaveSchematicCopy` 现在捕获整个已加载层次的 8 页，包括未保存子页；拒绝指向目标目录外的层次引用。隔离测试确认原文档未改变。 |
| 临时检查副本丢失库上下文 | 复制项目库表，并把相对 URI 与 `${KIPRJMOD}` 绑定回原工程；保留 `.kicad_pro`、自定义规则、图框，DRC parity 同时捕获相邻原理图层次。 |
| `board.items.from_string` 未实现 | 实现 C++ 原生解析及 typed 创建事务；验证类型、图层、网络，重映射 UUID，拒绝不支持的组。重复导入、非法输入无写入、原生回读通过。 |
| `board.decap.place` DRC 回退 | 候选避障纳入封装引用/值文本，跳过锁定器件，多方向搜索并遵守最大距离；原生 DRC 回读与失败回滚测试通过。 |
| `external.step.meshcheck` 缺少程序 | 编译并安装 OpenCASCADE 原生检查器。合法 STEP 正向通过；重叠立方体正确返回 `STEP_COLLISIONS`，不能算工具故障。 |
| `web.search` 被合成 DNS 阻断 | 对基准保留地址的 DNS 答复使用经 TLS 验证的公共解析，并固定已校验的公网地址；私网、混合私网结果仍拒绝。实际搜索返回 5 条结果。 |
| `board.plane.verify`、`board.impedance.check`、`board.check.unified` | 在满足条件的原生隔离工程中补齐正向执行；违规输入仍保留失败语义。 |
| 两项 HPGL 导出 | 原生 KiCad 10 已移除格式。两项从活动目录退役，明确返回 `CAPABILITY_REMOVED` 并给出 PDF/SVG/DXF/PS 替代格式，没有假实现。活动动作由 335 调整为 **333**。 |
| `audit.run`、`release.check` | 在实际工程上重新执行，分别返回 `AUDIT_NOT_PASSED`、`RELEASE_EVIDENCE_INCOMPLETE`。原生检查/制造证据未满足，正确保持拦截。 |

具体输入和结果：[remaining-tools.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/remaining-tools.json)、[web-search.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/web-search.json)、[release-gates.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/release-gates.log)。

## 实测范围与证据

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 当前 333 项活动动作 | 累计全部有执行记录；331 项有正向结果；2 项放行门禁正确阻断 | [逐项覆盖矩阵](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/coverage-matrix.json) |
| 原连接器剩余 79 项 | 已迁移到两端共用 JS 原生工作流；前轮 79/79 正向执行证据保留，本轮回归再次覆盖对应实现及文件/原生事务 | [原生工作流记录](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/workflow-final.jsonl)、[当前回归日志](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/direct-tests-final.log) |
| 当前共享封装回归 | **51/51 通过，0 失败、0 跳过**；包含原生 PCB/SCH、层次副本、解析创建、去耦正向及回滚 | [direct-tests-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/direct-tests-final.log) |
| 聊天面板工具绑定 | **20/20**；实际扩展宿主/SDK、原生 IPC/CLI、过孔/网表/流水线持久化回读通过 | [chat-tools.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-tools.log)、[回读](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-tools/readback.json) |
| 终端工具绑定 | **20/20**；实际编译终端、原生 IPC/CLI、相同持久化回读通过，MCP 转发配置为空 | [terminal-tools.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/terminal-tools.log)、[回读](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/terminal-tools/readback.json) |
| 实际聊天面板在线验收 | 19 次工具调用，其中 14 次 KiCad 内置工具；IPC 已连接、PCB/SCH 均被发现，实时检查、导出完成，设计连通性失败如实返回 | [聊天调用记录](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-final/tool-trace.json) |
| 实际扩展内终端在线验收 | 16 次工具调用，其中 11 次 KiCad 内置工具；完成同样的原生工作流。模型第一次 DRC 漏传 `document`，收到 BAD_INPUT 后查字段并重试成功 | [终端调用记录](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/terminal-final/tool-trace.json) |
| 实际启动 | 0.4.27 激活；2/2 Webview 挂载；原生终端启动；进程内健康调用通过 | [startup.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/startup.json)、[最终健康结果](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/health-final.json) |
| 终端构建与自身测试 | 206 通过、1 跳过、0 失败；类型检查、完整 Web UI、arm64 二进制启动通过 | [terminal-build.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/terminal-build.log) |
| 原生构建、扩展、轻量 UI、npm | 原生编译通过；主扩展完整构建、轻量 UI、npm 3 项测试与打包/本地安装通过 | 本目录各 `*-build.log`、`*-install.log`、`npm-tests.log` |

20/20 工具绑定测试使用确定性本地模型响应发出请求，但工具、原生进程与回读是真实执行。随后两端在线验收使用实际配置的 DeepSeek Flash，没有使用模型夹具；其中 Bash/Read/Glob 等只用于读取验收产物，不替代 KiCad 检查操作。

**333 项是跨轮累计覆盖，不是 333 项全部在用户原工程上重新运行。** 写入、删除、清空、放置等操作使用隔离工程；实际用户工程验收采用只读检查及副本导出。971 是原生 GUI 命令说明目录的数量，不代表 971 个完整交互场景均已验收。

机器可读汇总：[acceptance.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/acceptance.json)。调用记录只提取本次验收首条请求的工具输入/输出；随后人工输入到同一 UI 的任务已排除，没有替用户接受后续权限请求。

## 实际工程的检查结果

工程：[RK3308B_IPC 摄像头模块.kicad_pro](</Users/mosc/Downloads/Kicad/projects/RK3308B_IPC 摄像头模块/RK3308B_IPC 摄像头模块.kicad_pro>)。PCB 为 155 个封装、837 个焊盘、1329 条走线、77 个过孔、3 个铜区、126 个网络、4 个铜层。

| 检查 | 当前报告 |
| --- | --- |
| 聊天 live DRC（默认每轨首错） | 1550 项：1075 错误、475 警告 |
| 终端 live DRC（默认每轨首错） | 1543 项：1068 错误、475 警告 |
| 独立共享封装复核，启用 `allTrackErrors` | 两次均 1572 项：1097 错误、475 警告；普通违规 1078、未连接项 132、原理图一致性项 362 |
| 聊天/终端 live ERC | 两端均覆盖 8 页，1235 项：176 错误、1059 警告 |
| 原生连通性证明 | `CONNECTIVITY_UNPROVEN`；**80 个未连通网络、132 个未连接项**，danglingItems 为 0 |
| SVG、网表导出 | 两端均产生非空产物；网表来自对应 live ERC 检查副本 |
| 生产审计及交付检查 | 均未通过，不具备放行证据 |

两端 PCB 检查副本 SHA256 相同：`0423ecb5158f4e5d0386396c6adb970a17cf1f4c8f268fac27d3f0eda2b7b742`。默认 DRC 会在每轨首错后停止，其遍历顺序会影响条数。进一步打开 `allTrackErrors` 后，两次汇总相同，但条目集合仍不同：原生引擎每类报告上限为 199/499，clearance=499、track_width=199、net_conflict=199 已触顶，并行处理可能保留不同条目。因此 **1572 是当前有上限的报告条数，不是全部唯一违规的精确总数**。已有 5 类 ignore 设置原样保留；未降低规则以取得通过结果。来源：[原生报告上限](/Users/mosc/Downloads/Kicad/pcbnew/drc/drc_engine.cpp:57)、[运行时上限设置](/Users/mosc/Downloads/Kicad/pcbnew/drc/drc_engine.cpp:922)、[原子限额执行](/Users/mosc/Downloads/Kicad/pcbnew/drc/drc_engine.cpp:2308)。

报告产物：[聊天 DRC](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-final/drc.json)、[终端 DRC](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/terminal-final/drc.json)、[逐轨全部错误复核](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/drc-complete-1.json)、[8 页 ERC](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-final/erc.json)、[PCB SVG](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-final/board.svg)、[网表](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/chat-final/schematic.net)。

## 安装一致性与清理

重新校验 7 处已构建/安装模块，SHA256 完全一致：`2c45c05fc66717f04e3f2c4eccc4044db03fd0b90c9ca6c654396eed8eafed48`。6 个分发包均通过内容校验；活动旧中转进程为 0；`tools/ai` 的活动源中无 Go 实现，原 Go 目录和独立 stdio 转发脚本不存在。详见 [artifact-verification.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/artifact-verification.json)。

用户指定的 [easyeda-agent-connector.eext](/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/easyeda-agent-connector.eext) 现在与 [kicad-native-tools.zip](/Users/mosc/Downloads/Kicad/tools/ai/direct/dist/kicad-native-tools.zip) 内容相同，SHA256 为 `0d53e67a1469d7eee25fe5c39911e9fbed7cd97f12ac7c67a7dd46bc6bba3e63`。它是兼容原路径的原生 JS 工具 ZIP 别名，已不含嘉立创扩展入口，也不是嘉立创扩展管理器安装包；正常聊天/终端调用直接导入内置模块，不加载此别名。

当前主扩展包：[kicad-0.4.27.vsix](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/dist/kicad-0.4.27.vsix)。原生 C++ EasyEDA 文件格式导入器、许可证、原设计迁移备份和无关的全局 EasyEDA 工具保留；它们不在本项目工具转发链内。

## 工程保护与证据边界

最终两端验收前后及汇总时，PCB、8 页 SCH、`.kicad_pro` 共 10 个文件的 SHA256 完全一致，见 [验收前](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/final-validation-before.json)、[验收后](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/final-validation-after.json)、[汇总时](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/final-validation-current.json)。

不能据此宣称整个会话从未改变工程：最初打开/恢复编辑器状态后，PCB/SCH 在 18:17:55 UTC 已出现变化，早于第一轮在线聊天（18:18:36）和终端（18:18:37）。其中存在标签类型等实质变化，不能仅归为格式化。恢复编辑器状态与并行设计操作尚未区分来源，未擅自回滚。已保留 [最初工程快照](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/project-before.zip)、[打开后快照](/Users/mosc/Downloads/Kicad/tools/ai/audit/live-project-2026-10-21/project-after-opening.zip) 和对应哈希/时间说明。

本次完成软件调用链和工作流验收，没有将设计违规修复、制造认证或人工/板厂审批伪造为工具测试通过。
