# KiCad 原生工作流迁移与启动验收

日期：2026-10-21。范围：此前剩余的 79 项工作流、两端进程内调用、聊天面板和扩展内终端启动、发行包一致性。测试环境为 macOS arm64，KiCad 10.99.0、扩展 0.4.25、终端 1.19.3。

结论：79/79 项已有实现、原生输入契约和成功执行记录；新构建包的启动验收通过。当前目录为 335 个动作、130 个 IPC 映射（125 个独立原生请求）、20 个工具定义。335 个动作均经分派覆盖检查；本次 79 项逐项执行验证与全目录分派验证是不同的证据范围。

## 调用链

- 终端：原生工具插件 → 同进程共享 JavaScript → KiCad 原生 IPC、CLI 任务或本地原生文件事务。
- 主扩展：SDK 进程内工具注册 → 同一实现 → KiCad 原生 IPC、CLI 任务或文件事务。
- 轻量扩展：动态导入共享 ESM 模块，直接调用 Runtime。

Go 源码目录与 build/bin/kicad-agent 已从当前工作区删除；旧连接器代码不加载、不打包。两端不构造或启动 KiCad stdio MCP 子进程。主扩展原来的 getKiCadMcpServer 配置构造器已改为 getKiCadRuntimeConfig，只返回模块路径和原生环境配置。终端在合并配置后移除旧 kicad/easyeda MCP 项。

KiCad 的 IPC 是连接拥有当前文档的 C++ 编辑器或原生 headless context；原生 CLI 用于导出与检查。外部客户端显式使用的 stdio 兼容入口仍可单独调用，两端内置工具不走它。模型 SDK 自身的会话进程与工具中转服务属于不同职责。

## 79 项实现

| 范围 | 数量 | 实现 |
| --- | ---: | --- |
| 工程、板文件、原理图层级 | 16 | workspace-native.mjs |
| 原生封装与符号库 | 11 | library-native.mjs |
| 原理图属性、符号、图片、引脚与检查 | 18 | schematic-native.mjs |
| 网络类、差分对与等长约束 | 9 | rules-native.mjs |
| PCB 叠层、丝印、图片、同步、报告等 | 20 | board-native.mjs |
| 原生 DSN/SES、铺铜、走线整理与换层 | 5 | board-routing-native.mjs |

每项原生参数定义见 [workflow-contracts.json](workflow-contracts.json)，逐项成功证据见 [coverage-79.json](coverage-79.json) 与 [executions-final.jsonl](executions-final.jsonl)。模块说明见 [NATIVE-WORKFLOWS.md](../../direct/NATIVE-WORKFLOWS.md)。

170 项旧处理器审查现为 79 项原生工作流、72 项原生能力参考、19 项平台契约移除。72 项仍要求按原生参数和单位调用，不表示旧连接器参数可原样使用。外部云工程、登录、平台 UUID 与浏览器脚本能力已去除。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 共享工具完整 Node 测试 | 41 通过，0 失败，0 跳过，使用真实原生二进制 | direct-tests-final.log |
| Bun 进程内绑定、入口与取消 | 5 通过 | bun-bindings-tests.log |
| 79 项工作流 | 79 项成功执行，含原生 GUI 视图筛选读取 | coverage-79.json、native-gui.json |
| 真实层级原理图 | 子页 sheetPath、子页标题持久化、根页不受影响；生成符号库由原生 CLI 解析导出 SVG | native-hierarchy.test.mjs、direct-tests-final.log |
| 原生 PCB 修改 | 图片、丝印、叠层、约束、换层、合并、DSN/SES、回读与报告；封装移动时焊盘同步位移 | native-board-workflows.test.mjs、direct-tests-final.log |
| SES 实际铜线导入补验 | 非空 SES 生成 GND、0.25 mm 宽、(40,70) 至 (60,70) mm 的铜线，逐字段回读通过 | native-ses-copper-test.log |
| 原生原理图修改 | 属性哈希冲突、符号替换、真实引脚位置、VCC 网络与 pin 1 连通、NC、保存回读与导出 | native-schematic-workflows.test.mjs |
| 原生 C++ | pcbnew_kiface、eeschema_kiface、pcbnew、kicad-cli、共享 bundle 构建成功 | native-build.log、native-bundle-build.log |
| 终端完整 TUI 测试 | 206 通过，1 跳过，0 失败；内嵌 Web UI 及 arm64 原生二进制构建成功 | terminal-build.log |
| 主扩展 | TypeScript、Vue、实际 SDK 20 个工具注册、335/79 目录检查、权限和生命周期等检查通过 | extension-build-final.log |
| 轻量扩展 | 编译后真实导入、335 动作、参考调用、路径与取消检查通过 | legacy-extension.log |
| 终端原生服务 | 真实终端二进制启动、注册进程内工具、健康检查、本地模型流式 fixture、失败响应检查通过 | terminal-native-server.json |
| 终端插件与安装 | 任务连续性、配置合并、旧 MCP 清理、隔离安装及重装通过 | terminal-plugin.log、terminal-isolated-install.log |
| npm 包隔离安装 | 空缓存 npx、32 个大小写命令、22 个原生命令、580 个文件、8 项技能、335 动作、20 工具、服务及 Web 资源通过 | npm-install-acceptance.json |
| 真实 VS Code 新包启动 | 扩展激活；聊天与设置页 2/2 挂载；终端 PTY PID 42898，健康检查后仍运行；内部健康检查成功 | editor-startup.json、editor-startup.log |
| 发行包一致性 | 八处共享模块哈希一致，插件文件一致；53 项原生源码生成输入哈希有效 | artifact-consistency.json |

真实 VS Code 验收使用最终 VSIX、隔离 HOME/配置/工作区、内存 secret storage，将兼容 nodePath 故意设为不存在的路径，仍通过进程内健康检查和原生终端启动。未读取真实模型密钥或修改系统钥匙串。在线服务模型回复未列入本次验收，本地流式模型 fixture 单独记录。

## 原生修正

- 新增原生 Specctra DSN 导出与 SES 导入 protobuf 请求及 C++ 处理器；导入使用原生提交和异常回滚。
- headless PCB 保存检查副本采用 SaveProjectCopy，避免改动正在使用的工程目录；保存副本失败显式报错。
- headless 原理图标题栏定位到唯一实际顶层页，避免写入未序列化的虚拟根页。
- 原生 GUI 支持 KICAD_API_SOCKET 的绝对路径，允许隔离验收。
- JS 封装移动会同步移动原生序列化的子图元和焊盘；原理图引脚使用原生坐标变换，实际网表验证 VCC 连接到目标引脚。
- 聊天页面开发模式只在显式指定开发服务器时启用；打包资源启动和挂载回执已验证。终端启动不再查询扩展的系统 SecretStorage。

## 产物与哈希

- 扩展：[kicad-0.4.25.vsix](../../Kicad-extension/dist/kicad-0.4.25.vsix)
- 终端：[kicad-terminal](../../Kicad-terminal/dist/kicad-terminal)
- npm 包：[-kicadai-kicad-code-0.1.1.tgz](../../Kicad-terminal/dist/-kicadai-kicad-code-0.1.1.tgz)
- 共享归档：[kicad-native-tools.zip](../../direct/dist/kicad-native-tools.zip)
- 外部指定文件：/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/easyeda-agent-connector.eext

外部 .eext 与 .zip 是完全相同的原生工具 ZIP；旧扩展文件名保留为归档名，不能作为嘉立创扩展安装。归档含 10 项文件和许可证，未包含旧连接器实现、Go 可执行文件或 extension.json。

共享模块 SHA-256：`0624b8a1e4cdd9304aaac28c07160d31f684f558f53220aa499f85d48d4dd151`。
归档 SHA-256：`6c428ae45833182b86f4d9e44a62c67edab58b2d464bc7cb8a7872d7200c17bd`。
其余产物哈希见 [artifact-consistency.json](artifact-consistency.json)。终端及主扩展 build-manifest verify 均成功。

原始 Go 源码和连接器备份：/Users/mosc/Downloads/Kicad-migration-backup-2026-10-21.zip。

## 使用边界

文件事务要求关闭相关原生文档并保留备份；在打开的文档上修改使用 IPC。子页打开返回可操作的原生 sheetPath，不移动 GUI 视口；图像导出是原生 SVG 渲染。差分对依赖 KiCad 原生命名，网络类分配使用原生标签/模式。SVG 丝印导入支持明确列出的轮廓子集。SES 导入遵循 KiCad 原生替换未锁定布线的行为，导入回读仍需 DRC 和设计验收；软件测试不证明投板就绪。

验收对象为新构建包和隔离启动实例；机器上先前运行的其他编辑器或测试会话不在本次进程清理范围，存量窗口只有加载新版本后才使用这套实现。未发布 npm、未改动用户硬件工程，也未覆盖并行开发变更。
