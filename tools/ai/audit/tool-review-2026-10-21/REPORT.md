# KiCad 工具直连审查与实测报告

日期：2026-10-21。工作目录：`/Users/mosc/Downloads/Kicad`。所有修改和安装均为本地操作，未发布远程版本。

## 当前调用结构

聊天面板和扩展内终端都在各自宿主进程中导入同一个 `kicad-direct.mjs`，再调用 KiCad 原生 IPC、原生 `kicad-cli`，或对关闭文档执行有备份和回读的原生文件事务。335 项动作包含 79 项已迁移的原生工作流。SDK 中的 `mcp__kicad__` 名字是进程内工具注册名；这里没有启动独立 stdio MCP 服务。

- 聊天：扩展宿主 → 进程内 SDK 工具定义 → 共享 JS → KiCad 原生 IPC/CLI/文件。
- 终端：编译后的原生终端 → 进程内插件 → 同一共享 JS → KiCad 原生 IPC/CLI/文件。
- 自动布线、流水线、交付审计等原 Go 功能保留在共享实现中。
- ngspice、freerouting、FreeCAD/STEP 检查器等可选能力仍是明确标注的外部实用程序，直接启动对应程序。它们并非 KiCad 内置算法，也不经过 Go 或嘉立创连接器。
- 联网搜索和参考资料查询属于辅助工具，不代表 KiCad 编辑操作。

## 验收结果

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 335 项动作目录 | 全部有执行记录；324 项正向结果，11 项分类结果见下表 | [coverage-matrix.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/coverage-matrix.json) |
| 原连接器剩余 79 项 | 79/79 正向；覆盖真实 IPC/CLI、原生文件事务及 GUI 状态回读 | [workflow-final.jsonl](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/workflow-final.jsonl)、[gui.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/gui.json) |
| 共享封装最终回归 | 46/46，通过；0 跳过 | [direct-regression-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/direct-regression-final.log) |
| 原生 CLI 目录 | 57 项实际执行，55 项成功；2 项 HPGL 当前原生不支持 | [cli/cli-catalog.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/cli/cli-catalog.json) |
| 原生 IPC 补充覆盖 | 96 项执行；无界面环境限制项追加 GUI 验证 | [ipc/ipc-catalog.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/ipc/ipc-catalog.json) |
| 原生 GUI | 23/23 调用；另完成封装库打开和条目回读 | [gui.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/gui.json)、[gui-library.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/gui-library.json) |
| 聊天面板的 20 个工具 | 20/20；真实安装扩展宿主、SDK 和原生工具；过孔/网表/工作流文件回读通过 | [chat-tools-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/chat-tools-final.log)、[chat-tools-final/readback.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/chat-tools-final/readback.json) |
| 已安装终端的 20 个工具 | 20/20；真实编译终端与原生工具，MCP 路由表为空 | [terminal-tools-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/terminal-tools-final.log)、[terminal-tools-final/readback.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/terminal-tools-final/readback.json) |
| 终端自身测试与构建 | 206 通过、1 跳过、0 失败；完整 Web UI、类型检查和二进制启动通过 | [terminal-build-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/terminal-build-final.log) |
| 主扩展完整构建 | 后端/前端类型检查、封装与打包测试通过；0.4.26 已安装 | [extension-build-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/extension-build-final.log)、[extension-install.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/extension-install.log) |
| 轻量旧 UI | 已改用进程内共享模块；0.1.1 编译、直接调用、取消与路径测试通过 | [legacy-extension-build-final.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/legacy-extension-build-final.log) |
| npm 包 | 3/3 单测；空缓存 npx、全局安装和重复安装无需 force；32 种大小写在本机均通过；579 个包文件哈希通过 | [npm-acceptance-final.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/npm-acceptance-final.json) |
| 实际 VS Code 启动 | 0.4.26 激活；2/2 Webview 挂载；原生终端启动；内部健康工具成功 | [startup-final.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/startup-final.json) |
| 当前普通窗口可视验收 | KiCad 聊天和内置终端均可见，无钥匙串缺失弹窗 | [visible-acceptance.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/visible-acceptance.json)、[final-ui.png](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/final-ui.png) |
| 安装一致性 | 7 处共享模块完全相同；6 个分发包校验通过；旧中转进程为 0 | [artifact-verification.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/artifact-verification.json) |

聊天与终端端到端测试使用本地确定性模型响应来发出工具调用；工具执行、SDK、KiCad IPC/CLI 和产物回读均为真实执行。这验证工具链，不代表在线模型服务可用性验证。所有编辑测试使用隔离工程，没有借测试改动用户设计。

当前普通窗口没有连接正在打开的 KiCad 文档，状态显示“IPC 未连接”；CLI 10.99.0 与 335 动作/20 内部工具可用。真实原生读写已在隔离工程完成。该状态和工具是否采用进程内直连是两个独立检查项，见 [final-health.png](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/final-health.png)。

971 是可检索的原生 GUI 命令目录数量；没有将其宣称为 971 个完整交互场景验收。交互移动测试只验证动作成功提交，随后在隔离编辑器中终止，未将提交当作移动完成。

## 11 项分类结果

| 动作 | 分类 | 实测含义 |
| --- | --- | --- |
| `board.plane.verify` | 原生连通性保护 | 检测到测试过孔未连接平面，返回 PLANE_UNCONNECTED。 |
| `board.impedance.check` | 检查命中 | 实际线宽不满足目标阻抗，返回 IMPEDANCE_VIOLATIONS。 |
| `audit.run` | 证据门禁 | 测试工程的设计和制造证据不齐，返回 AUDIT_NOT_PASSED。 |
| `release.check` | 证据门禁 | 缺少与当前修订绑定的放行证据，返回 RELEASE_EVIDENCE_INCOMPLETE。 |
| `board.decap.place` | 修改保护 | 移动去耦电容导致原生 DRC 回退，返回 DECAP_DRC_REGRESSION，原始数据已恢复。 |
| `board.check.unified` | 检查命中 | 测试工程含原生违规、启发式发现或未完成检查，返回 CHECK_FINDINGS。 |
| `external.step.meshcheck` | 可选工具缺失 | 本机未安装 kicad-stepcheck，返回 TOOL_MISSING。 |
| `web.search` | 环境限制 | 搜索域名被当前网络解析到保留地址；SSRF 防护拒绝访问。未降低网络防护。 |
| `board.items.from_string` | 原生尚未实现 | KiCad 原生处理器原本返回空结果；现改为明确 UNIMPLEMENTED，并在目录标记不可用。使用已实测的 typed board.items.create。 |
| `board.export.hpgl / schematic.export.hpgl` | 原生已移除（2 项） | 当前 KiCad 10.99 CLI 不提供 HPGL；目录已标记不可用，保留清晰原因。 |

这 11 项分别为 6 项预期检查/修改保护、2 项环境或可选依赖限制、3 项原生不可用能力。它们不是 11 项已成功完成的设计操作；完整输入、结果和来源索引保留在覆盖矩阵中。

## 本轮修复

1. 移除独立 stdio 工具转发入口；两端统一使用共享工具注册与调用函数。旧 MCP 配置即使改名，也会在合并后按执行命令过滤，其他用户服务保留。
2. 修复嵌套 jobSettings 覆盖文档、输出和超时参数；冲突容器参数明确拒绝。
3. 修复 PDF/SVG 等输出文件被误建为目录；按原生命令及模式判断目录输出。导入工程的实际 `.kicad_pro` 输出与 jobset 的目标 ID 分别处理。
4. 修复工程 fp-lib-table 被忽略，查询和放置均优先使用实际工程封装库；支持 `${KIPRJMOD}`。
5. 修复 document.list 将封装/符号编辑器类型强制改成 PCB，加入类型保留与未知类型拒绝测试；原生封装库打开后成功回读 `Test:Test`。
6. KiCad C++ 中未实现的字符串创建处理器明确返回 UNIMPLEMENTED，避免空成功结果误导调用方。原生 CLI 和 PCB 模块已重新编译。
7. 解决 npm 在 macOS 重复创建大小写等价链接导致的 EEXIST。只登记标准入口 Kicad，移除安装期链接补丁；默认大小写不敏感文件系统仍可使用所有大小写组合。
8. 测试宿主使用隔离 profile/HOME 和内存 SecretStorage，避免测试触发缺失 Code Key 的系统钥匙串弹窗；不会重置用户 macOS 钥匙串。更新启动测试自动选择最新 VSIX。普通窗口重新加载后也未复现弹窗。
9. 轻量扩展修正原生 CLI 默认路径为 kicad-cli，移除多余 Node 选择配置及 stdio/MCP 配置片段，显示实际进程内模块信息。

## 清理范围与恢复点

- Go 源码目录、原连接器上游引用、旧的独立 MCP 脚本与活动可执行入口已移除；源目录不再包含 Go 实现。
- 旧 kicad-agent 可执行文件、easyeda-mcp.mjs 和历史终端启动脚本移至 `~/.local/state/kicad/retired-middleware/`，含 SHA256 清单。
- 26 个历史主扩展 VSIX、3 个旧版安装目录、旧轻量扩展包、过时 npm 缓存与历史中间产物移至 `/Users/mosc/Downloads/Kicad-retired-artifacts-2026-10-21/`。
- 已安装的 KiCad skill 中指向旧 Go 命令的文件改为原生入口；修改前文件另存备份。
- 清理记录：[retired-installed.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/retired-installed.json), [retired-artifacts.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/retired-artifacts.json), [retired-vscode.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/retired-vscode.json), [retired-caches.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/retired-caches.json), [installed-skills.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/tool-review-2026-10-21/installed-skills.json).
- 本轮源文件备份：`/Users/mosc/Downloads/Kicad-tools-review-backup-2026-10-21.zip`，SHA256 `4dad3c221a523691c73eb88c6c8ebcf643563ec445453664531bc0e932308d95`。
- 原 Go 迁移备份：`/Users/mosc/Downloads/Kicad-migration-backup-2026-10-21.zip`，SHA256 `2b39feb23fbc7499c3e7c9877da9f1b304d7f641bf14d88c7a53c3608a1b24f2`。
- 原生 C++ 的 EasyEDA 文件导入器、原始设计迁移备份、必要许可证/数据归属、无关的全局 EasyEDA 工具保留。它们不属于本项目工具调用链。

## 当前分发包与哈希

共享模块 SHA256：`0b6ccafd1bd4ba0b634cba14a34336baf715806ddc55f9918b13e0e15a0eec90`。主扩展 0.4.26，原生终端 1.19.3，npm 包 0.1.1。

| 文件 | SHA256 |
| --- | --- |
| [kicad-0.4.26.vsix](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/dist/kicad-0.4.26.vsix) | `78fa63ae07c36fb669b19b48a76eb4e45e5bbf9de087c1f9f22101e8bf3dfbfa` |
| [kicad-agent-vscode-0.1.1.vsix](/Users/mosc/Downloads/Kicad/tools/ai/vscode-extension/kicad-agent-vscode-0.1.1.vsix) | `9fd0fba513cca1b580a7dcccc560cb45c70333a26aa0b0416f8c9a6257b4a364` |
| [-kicadai-kicad-code-0.1.1.tgz](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-terminal/npm/-kicadai-kicad-code-0.1.1.tgz) | `65a2599dcfcef659357d8651a192896205180f920885475823c53b5ed10e5971` |
| [kicad-native-tools.zip](/Users/mosc/Downloads/Kicad/tools/ai/direct/dist/kicad-native-tools.zip) | `42ed07ac3aad2be233f14e8f7e3d491a641beb5c3351bdf7dbcbb31518a4f711` |
| [easyeda-agent-connector.eext](/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/easyeda-agent-connector.eext) | `42ed07ac3aad2be233f14e8f7e3d491a641beb5c3351bdf7dbcbb31518a4f711` |
| [kicad-native-tools.zip](/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/kicad-native-tools.zip) | `42ed07ac3aad2be233f14e8f7e3d491a641beb5c3351bdf7dbcbb31518a4f711` |

用户指定的 `.eext` 路径已替换为共享原生工具 ZIP 的同内容别名；不再含嘉立创连接器、WebSocket 转发或 Go 程序。它不是可导入嘉立创扩展管理器的安装包。两端内置调用直接导入模块，正常使用无需再安装该别名文件。独立分发推荐使用 `kicad-native-tools.zip`。

构建来源及安装模块哈希均已核对；`git diff --check` 通过。以上为本地软件和工具链验收结果，不赋予测试工程制造或量产放行结论。
