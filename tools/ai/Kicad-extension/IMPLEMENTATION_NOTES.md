# 扩展开发记录

保留自 0.4.66 的扩展详情页，供开发与验证查阅。

---

# Kicad

当前构建版本：0.4.66。项目根目录为 `Kicad`，扩展源码为 `tools/ai/Kicad-extension`，
终端源码为 `tools/ai/Kicad-terminal`。扩展显示为 **Kicad**，终端显示为 **Kicad 终端**。
扩展安装 ID 仍为 `kicad-agent.kicad`，可直接升级并保留用户配置。

后端状态检查由用户点击状态栏或调用 health 工具时按需执行。原生 IPC 连接与项目打开仍交给 KiCad，显式 socket 不重定向。

0.4.62 支持点击工具卡片 IN / OUT / ERR 的文字，在第一编辑器组打开完整内容的命名只读标签页。
IN 命令、OUT 输出和 ERR 错误分别查看；复制按钮独立，Enter / 空格同样可打开。只在手动查看时打开，不执行命令、不弹窗，也不停止对话。

0.4.61 将 Read 图片文件名和 OUT 图片结果变为可点击入口，沿用 open_file 消息通道，在 VS Code 第一编辑器组的内置图像预览中打开。
仅点击、Enter 或空格激活时打开，不随模型读取自动切换编辑器。支持临时目录、中文及含空格路径；缺失图片显示错误，不模糊匹配其他文件。

0.4.60 将子代理授权绑定到聊天输入流中的当前真实用户请求，SDK 钩子、子代理提示、模型计划、历史及工具结果均不能授予授权。
“请把项目进行深度了解”始终由主代理处理；只有明确要求子代理的当前请求才允许启动，并仍服从子代理开关。
打包检查使用真实 SDK/CLI 与本地模型响应夹具，验证普通请求、权限模式、跨轮撤销、显式请求与禁用设置。
UI 截图标明模拟事件来源；界面测试不能证明真实模型的工具选择。安装后需在当前任务结束时重载 VS Code 窗口，
才能替换已加载的旧版扩展代码；仅安装 VSIX 不会热替换活动窗口中的服务。


0.4.58 修复显式子代理授权（描述、附件、示例和历史不视为启动请求），并让关闭子代理设置同时禁用原生入口。
Codex 根据当前请求启用或禁用原生 V2 协作，沿用本地 app-server 和同一线程历史；动态工具遵守相同的钩子拒绝与只读判定。
MCP 配置变化或工具清单通知会使旧能力和只读标记失效；技能索引顺序稳定、避免符号链接循环，正文仍在调用时读取。
设置 **MCP mode**（按需 / 直连 / 关闭）、**Skills mode**（按需 / 原生 / 关闭）、禁用名单、额外目录、
**Subagents enabled** 和可选提示组件在聊天会话启动或重启时生效；当前运行中的工具配置保持一致。
这些聊天设置不改写独立 OpenCode 终端的用户配置，终端仍使用共享按需目录和显式委派规则。

0.4.30 增加当前工作区的共享会话历史：聊天面板历史列表可读取终端会话，标题标记为 `[终端]`，以只读方式展示；标题栏的历史按钮或 `Kicad: 共享会话历史` 命令可查看原始记录，并在终端继续原生会话。终端使用 `/kicad-history` 或 `session_history` 工具读取两端历史。跨运行时不混用会话 ID。

扩展用户消息与助手回复逐条保存到 `${KICAD_HISTORY_DIR:-${XDG_DATA_HOME:-~/.local/share}/kicad/history}/extension/` 的 0600 JSONL 备份，原生 Claude 会话仍保留在 `CLAUDE_CONFIG_DIR/projects`。历史读取合并未刷新的备份并按 UUID 去重；终端 SQLite 数据库以只读方式读取（macOS 使用系统 `/usr/bin/sqlite3`）。记录包含对话内容，应按用户数据保管；不会自动上传。Harness 的任务提醒、重复失败保护与大结果归档也随本版本集成。

0.4.36 将扩展（Claude / Codex）与终端的工具、MCP 和技能统一为按需发现：
初始只注册 `capability_search`、`capability_call` 两个扩展能力入口，不因提到 PCB 就加载整套工具。
搜索每页最多返回 5 个匹配工具的参数定义；调用使用返回的 ID，并保留原工具权限、日志和错误分析。
外部 MCP 先仅发现名称，指定服务器搜索其工具时才连接，未选择的服务器不启动。
技能搜索只返回名称和描述，调用后才读取该技能正文；模型上下文不预载完整技能目录。
全部操作可在同一轮自然语言任务中完成，无需重新发送“继续”。Codex 的 MCP / 技能关闭覆盖仅作用于
该扩展会话，不改写本地会员登录和配置。扩展原生 Skill 入口由共享技能发现入口替代。


0.4.28 更新共享工具模块与终端插件：`board.export.*` 等命令行导出接受 `document` 作为输入文件；
SVG/DXF/PDF/PS 导出缺少 `layers` 时在调用前报错；阻抗计算找不到层时列出实际铜层；
未指定类型的 `document.list` 同时列出打开的 PCB 与原理图。从扩展打开的 Kicad 终端（0.2.0）
随附 `/kicad-drc`、`/kicad-fab`、`/kicad-route`、`/kicad-step`、`/kicad-schematic` 快捷任务命令。

本版本安装包见 [GitHub Release 0.4.66](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.66)。
下载 `kicad-0.4.66.vsix`，在 VS Code 扩展菜单中选择 **从 VSIX 安装…**，或者执行：

```sh
code --install-extension ./kicad-0.4.66.vsix --force
```

需要 VS Code 1.98 或以上版本，当前验证平台为 macOS Apple Silicon。
VSIX 包含聊天界面、Claude Agent SDK/CLI、会话插件和共享原生工具；
KiCad 软件、原生 CLI 及完整终端运行时单独安装，共享 JavaScript 工具随 VSIX 提供，参见
[AI 工具集安装说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/README.md)和
[终端安装说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-terminal/npm/README.md)。
发行页同时提供 SHA-256 校验文件与本次构建验证报告；该发布渠道为 GitHub Release。

执行过程采用与终端一致的逐步输出：模型实际调用一个工具，才追加该步骤及其 IN / OUT；
工具完成后，再依据结果继续。没有整轮折叠入口、调用次数或失败次数汇总。思考、普通进度、
重要问题和交互式问题保留事件顺序，最终回复显示在步骤之后。工具输出较长时先预览几行，
可用鼠标或键盘在编辑器中打开完整内容；查看、复制和阅读记录不会调用工具或暂停任务。
MCP 和技能默认按需加载：只注册能力检索、调用入口（启用子代理时另有只读入口），
检索只返回匹配项；选定的 MCP 才连接，选定的技能才读取正文，检索不会自动执行结果。
工具参数、结果和错误同时写入只读的 **Kicad Tools** 终端；调用工具不会自动打开或聚焦窗口。
通过命令 **Kicad: 查看工具终端输出** 可查看终端。纯聊天正常显示回复；停止或中断时，
尚未完成的工具标为“未完成”，不会显示为成功。历史记录采用相同的逐步输出。
Claude Code 读取大图后自动追加的说明（如 `[Image: original …] Multiply coordinates…`，实时为
`isSynthetic`、记录中为 `isMeta`）不是用户消息，不显示为用户气泡，也不会把一次请求拆成多段。

暂停立即停止接收旧通道的界面事件，并清理旧权限确认；后端结束旧 SDK 进程。
再次手动发送时恢复原会话及模型、推理强度、权限和目录。旧结果或流结束回调不会清空
新请求状态；单次会话启动失败也不会让后续消息分发停止。不自动重发已暂停的任务。
聊天中不再单独展示 Interrupted / Tool interrupted 提示，未完成状态保留在对应工具步骤里。
手动续发按当前权限继续调用工具，不附加只读限制或额外的“重新发送成功”回复。

模型菜单立即展示本地模型和自定义配置；本机 Claude/Codex 模型发现在宿主中共享一次进行中的
探测，此后直接返回上次结果并在超过 60 秒时后台刷新，打开菜单不再每次重启两个 CLI。
面板打开时模型发现在后台完成，不阻塞模型选择和首次发送。支持搜索、方向键和 Enter。
模型与推理强度切换先保存到会话，只在下一次手动发送前更新 SDK 进程，恢复原会话和权限；
选择本身不启动对话或发送消息。任务运行中也可以选择模型和推理强度：选择立即显示并保存，
当前任务继续使用原进程，下一次发送前生效；运行中锁定的只有权限模式和附件等辅助操作。
运行中聊天区只在读者停留在底部时跟随新输出，向上滚动阅读或选中文字时不会被拉回底部。
Claude Code 2.1.30x 每个 token 产生的 stream_event 与 system/thinking_tokens 不再转发到界面
（扩展也不再请求 partial messages），避免面板与日志被每秒上千条事件占满。
用户主动选择的模型会保存为 Kicad 扩展偏好，修改历史消息、新建对话、恢复旧会话和重开窗口
都沿用该选择。默认设置、Profile 切换、SDK 列表发现和后台状态更新不会覆盖它。
历史消息编辑框与主输入框共享模型、权限和推理强度。修改后重新发送在原位置替换该消息，
从该处更新回复，不新增第二个消息框；重新打开会话仍显示最新修改。此前的对话保留，
所编辑消息及其后的旧回复由本次续发替换显示，原始 SDK 执行记录保留，已经执行的工具和文件
操作不会回滚。普通新消息仍正常追加，即使文字相同。模型切换或保存失败会保留原选择
并显示错误，不自动换用其他模型。

子代理入口默认隐藏，不占用输入框工具栏。用自然语言发送需求后，模型实际安排或启动
子代理时，聊天区域下方、输入框上方才显示 **N 个子代理** 按钮，点击打开运行看板弹窗。
普通聊天、尚未发送的草稿和只有后台命令时均不显示入口；已结束的子代理保留供回看，
新对话重新隐藏。看板展示主代理、子代理与后台命令。点击任务卡片查看要求、最新活动、
结果和 SDK 提供的用量。
看板使用 `Task` / `Agent` 工具以及 SDK 的 `task_started`、`task_progress`、
`task_notification` 事件增量更新，同一工具和任务不会重复计数。历史未结束的任务、
连接中断后无法确认的任务显示“状态待确认”；缺失的模型和用量不会推测。
Esc 或点击外部关闭弹窗，关闭后恢复入口焦点；输入框 Tab 接受下一句建议的行为保留。

**自动调用工具（无需输入 /）**：直接用自然语言描述需求即可，例如“检查 KiCad 环境”“跑一下 DRC”
“给 U1 做 BGA 扇出”“生成制造文件”。系统提示词常驻加载 `tools/ai/composer/eda-agent-instructions.md`
（与终端共用），把需求映射到内置 KiCad 工具；`~/.claude/skills/kicad-*` 技能按描述自动触发，
原有 `/kicad-*` 命令只作为可选别名保留。只读且不联网的工具（能力搜索、health、actions、native_tools、
spec_validate、blocks、reference、audit）不再弹出确认；会修改设计、联网（web）或写出文件（gerber）的工具仍按当前权限模式确认。

自动调用以用户实际提交的任务为依据；打开面板、恢复历史、选择模型或权限、接受下一句草稿
都不会启动任务。只有数字、问候或空输入时先澄清，不会猜成“检查环境”或第一项。
寒暄与不充分输入由共享提示提供建议，不按关键词硬拦正常工具；子代理在所有权限模式下仍需要明确的当前人类请求。普通自然语言中目标或条件
缺失时，由模型先提问再执行。AskUserQuestion 显示真实问题、选项和自定义回答，默认不选中；
必须回答全部问题才能确认，通用 Yes 不能代替回答，取消后停止等待。

接近模型可用上下文上限时，由原运行时自动压缩。扩展默认设置
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85`（保留用户显式覆盖），CLI 仍会预留输出空间。
20% 用量不会触发压缩。压缩前保存完整会话记录、精确用户请求、工具输入/结果与任务清单；
压缩后补回原始目标、最近修正、工具状态、未完成事项及完整记录路径。工具返回不等于验证成功，
不自动重复已完成的修改。SDK 记录尚未落盘时，以实际收到的消息及工具钩子记录补齐检查点。
原始 CLI 记录保留，压缩副本和检查点位于 Claude 配置目录下 `kicad-task-state/<session-id>`，
本地记录使用 0600 权限。终端使用同一需求规则及本地运行时插件，在原有自动压缩基础上
保存历史、检查点并恢复任务上下文，默认启用原生旧工具结果修剪，完整存储不变；保留用户明确的压缩设置。

参考 [OpenAI 官方上下文压缩说明](https://developers.openai.com/api/docs/guides/compaction)
与 [长任务状态管理示例](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction)。
这里适配现有 Claude SDK / OpenCode 运行时，不调用 Codex 的私有桌面接口；摘要仍可能遗漏细节，
需要时可回查完整记录和项目文件，不保证模型的语义记忆绝对无损。

**KiCad 原生工具**：扩展直接在进程内加载共享 JavaScript，调用 KiCad 内部 IPC/CLI。终端使用同一份源码构建的原生工具插件。不再注册外部 EDA、Go daemon 或连接器。

新对话默认选择 **Agent**，模式菜单将 Agent 放在首位；仍可手动选择 Default 或 Plan。
点击模式菜单可选择 **最高权限**，自动允许文件读写、Bash 命令及 MCP 工具调用，
不必反复点击 Yes。可随时切回其他模式；设置中的默认权限模式也可选择最高权限。
切换会放行当前待确认的工具操作，但用户问题与计划决策仍由用户回答。

输入框中的脑图标是 **Reasoning effort** 菜单（英文界面），只列出当前模型实际声明的档位：
Auto（使用该模型的默认配置）、None、Minimal、Low、Medium、High、Extra High、Max、Ultra。
档位来自本机 CLI 的模型发现：Claude Code `initialize` 返回的 `supportedEffortLevels` /
`supportsThinkingOff`，Codex app-server `model/list` 返回的 `supportedReasoningEfforts`。
实测（Claude Code 2.1.305、Codex 0.163.0）：Opus 5.5 / Fable 5.1 / Sonnet 5.5 / Haiku 5.5
提供 Low–Max，自适应思考无法关闭，因此没有 None；GPT-6.1 Sol、6 Astra、6 Sol、5.6 Sol、
5.6 Terra 提供 Low–Ultra，6 Luna 与 5.6 Luna 到 Max 为止。Ultra 仅表示提供商声明的推理档位，
不会授予子代理权限。DeepSeek Flash / V4 Pro 提供 Auto、None、Low、High、Max。
发现失败时按模型族使用内置回退表；未知兼容模型只保留 Auto 和 None。
Auto 不覆盖 Claude Code 自身配置（`~/.claude/settings.json` 的 `modelSettings.<模型>.effortLevel`，
否则模型默认值）和 Codex 的 `model_reasoning_effort`；DeepSeek 的 Auto 明确不发送 effort。
选择只影响后续聊天请求，不自动发送；切换会恢复同一会话并保留权限模式。
同一对话中记住各模型所选档位，切换模型时会校验支持范围。失败会保留原档位并显示错误。
扩展继续使用 Claude Agent SDK；没有把 Codex 桌面端内部代码嵌入扩展。
强度通过真实的 `output_config.effort`（Claude）或 `turn/start.effort`（Codex）发送；
`test-reasoning-local.mjs` 用本机 CLI 加本地 HTTP 夹具逐个模型、逐个档位核对线上的 effort 值。
DeepSeek 的预算参数不控制推理强度，因此显式传递该提供商支持的 effort。

**工具编排设置**（设置 → 扩展 → Kicad；新对话或下一次重启会话时生效）：

| 设置 | 取值 | 说明 |
| --- | --- | --- |
| `kicadAgent.mcp.mode` | `onDemand`（默认）/ `direct` / `off` | 外部 MCP 服务器：任务需要时经 `capability_search` 连接；或会话开始时直接交给运行时（工具名 `mcp__<服务器>__<工具>`）；或不用 |
| `kicadAgent.mcp.disabledServers` | 名称列表 | 任何模式下都不连接 |
| `kicadAgent.skills.mode` | `onDemand`（默认）/ `native` / `off` | 技能：经目录按需搜索加载；或用运行时自带的 Skill 工具和技能列表；或不加载 |
| `kicadAgent.skills.disabled` / `skills.extraRoots` | 列表 | 禁用的技能名；额外的 SKILL.md 搜索目录 |
| `kicadAgent.subagents.enabled` | 默认开 | 注册只读子代理 `kicad-reviewer`、`kicad-verifier`，在所选模型上运行，只能用 `capability_inspect` 等只读工具 |
| `kicadAgent.prompt.disabledSections` | 段名列表 | 关闭可选的提示词组件；`identity`、`tool_calls`、`mode`、`boundaries` 始终保留 |

提示词由 `composer/prompt-sections.ts` 按运行时事实和上述设置组装，文字与所选模型无关
（Claude、DeepSeek、Codex 收到同一组组件）；工具结果预算只看运行时上报的上下文窗口。
KiCad 的三个入口工具带 `alwaysLoad` 和只读注解：支持延迟加载工具的运行时不会再先绕一轮
工具搜索。`mutates:false` 的内置 KiCad 动作免确认；外部 MCP 工具照常询问。
架构分析与验证记录见 `tools/ai/audit/claude-code-architecture-2026-10-22/REPORT.md`。

参数语义参考 [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、
[Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference)、
[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort) 和
[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)。
终端使用 `/effort`，档位由当前模型的原生 variants 决定，原有 `/variants` 继续可用。

下一句建议仅以输入框中的灰色文字出现；只用 **Tab** 接受到草稿，再手动发送。
对话框不再提供“工具参考”、勾选框或接受/忽略按钮。输入文字会清除建议，Esc 可以忽略。
输入框中的普通 Tab 专用于下一句建议；没有建议时保持焦点，不选择命令、文件或工具，
也不跳到工具栏。命令和文件补全仍可用方向键、Enter 或鼠标选择；Shift+Tab 保留原有模式切换快捷键。
魔杖仍使用当前模型直接优化输入框中的文字，支持撤销和取消，不自动发送。

# kicad

KiCad VS Code integration based on [Claudix](https://github.com/Haleclipse/Claudix),
with its Vue chat, history, settings and Claude Agent SDK services retained.
The pinned upstream is 0.3.9 at `c238b3e57c55e95220a8e2837cd4cbe6350a6b65`;
the downstream extension version is 0.4.32.

Version 0.4.10 presents next-message suggestions solely as muted placeholder
text in an empty input. Only Tab accepts the suggestion as an editable draft;
Enter and Right keep their ordinary behavior. Acceptance never sends a message.
Typing, model changes and session changes invalidate stale requests. There is
no tool reference row, suggestion checkbox, dialog or accept/dismiss button in
the composer. Esc dismisses ghost text. Prediction uses the selected model and
the last eight text messages (each bounded to 6,000 characters); reasoning,
images and tool results are omitted. The native terminal retains `/tools` for
explicit MCP catalog access through its command palette.

Version 0.4.8 optimizes the draft directly in the chat input with the selected
model and existing provider credentials. There is no preview dialog, no automatic
send, and no application word/character limit. The optimizer preserves the user's
goal, constraints and technical facts without inventing requirements or padding.
An inline status offers cancel and undo. Errors and concurrent edits preserve the
draft. Requests time out after 90 seconds and expose no tools, MCP servers, hooks,
plugins or chat history. They do not persist a conversation.

Version 0.4.6 also replaces the in-conversation waiting asterisk animation with
the native KiCad icon. Welcome and waiting states share `KiCadIcon.vue` so their
branding cannot drift independently. The waiting text animation is retained.

Version 0.4.5 replaces the chat welcome wordmark and removes the upstream
mascot. The welcome page and extension listing use KiCad's native app icon
from `resources/linux/icons/hicolor/128x128/apps/kicad.png` in this repository.

Version 0.4.4 gives KiCad its own view and command IDs, preventing old Claudix
views from being revived after the extension was renamed. Frontend mounting is
acknowledged in the extension log and exposed through `getWebviewReadiness()`
for real VS Code host tests. Open chat with **kicad: Show Chat** or
`vscode://kicad-agent.kicad/chat`.

## 0.4.23 工程规范与验收更新

聊天自动根据设计任务调用 `reference.plan` 与相关规则卡，无需斜杠命令。
规范库含 20 个主题、86 条规则、21 个资料来源以及 37 个 KiCad 示例索引。
`release.snapshot/template/check` 检查同一工程版本的投板与投产证据完整性；
软件关卡不能代替实物测试、工程审查与最终质量放行。

请同时更新后端：`npm install -g @-kicadai/kicad-code@latest`，并将
`kicadAgent.directPath` 可指定共享 JavaScript 模块，默认使用 VSIX 内置模块。KiCad 工具在扩展进程内执行，原生 CLI 与 IPC socket 可通过下方设置指定。

## OpenCode

Run **kicad: 打开终端** in the Command Palette, or use the terminal
button in the KiCad chat view title. This starts the installed `kicad-terminal`
executable directly inside a VS Code terminal with a real PTY. OpenCode keeps
its own providers, models, sessions, slash commands, agents, skills, plugins,
permissions and terminal controls. Its sessions are separate from Claude chat.
The Claudix chat still uses the Claude Agent SDK; it is not an OpenCode renderer.
The launcher and terminal tab use the software name `kicad`. The terminal sets
`OPENCODE_DISABLE_TERMINAL_TITLE=true` so runtime title updates cannot replace
that name. The full runtime is built from the pinned OpenCode source with a
`kicad` startup wordmark and application labels. Upstream attribution is retained.
See [the terminal build](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-terminal/README.md).

Requirements: build/install `kicad-terminal` and native `kicad-cli`. The command
reports a missing executable with the corresponding setting name. In a
multi-root workspace it asks which project to open. Workspace trust is required.

| VS Code setting | Default | Purpose |
|---|---|---|
| `kicadAgent.directPath` | bundled | Shared JavaScript runtime |
| `kicadAgent.nodePath` | `node` | Compatibility CLI Node runtime |
| `kicadAgent.kicadCli` | empty | Native KiCad CLI used by the shared handlers |
| `kicadAgent.socket` | empty | Optional `KICAD_API_SOCKET` |
| `kicadAgent.openCode.path` | `kicad-terminal` | Full runtime with kicad branding; accepts `opencode` for upstream |
| `kicadAgent.openCode.args` | `[]` | Raw argv, e.g. `["--continue"]` |
| `kicadAgent.openCode.injectMcp` | `true` | Load native tool plugin (legacy setting name) |

Executable lookup includes PATH, `~/.local/bin`, `~/.opencode/bin`, and common
Homebrew paths. Absolute paths and `~/` paths are supported. The launcher uses
executable + argv directly; arguments are never interpolated into shell text.
The primary build host is macOS arm64; Windows terminal behavior is unverified.

The launcher adds the shared native tool plugin through `OPENCODE_CONFIG_CONTENT`.
Existing KiCad DeepSeek credentials expose the Flash/V4 Pro provider without
rewriting user preferences. Other providers and custom external tools remain.
Old kicad/easyeda connectors are removed after config merging. The legacy
`openCode.injectMcp` setting now controls native plugin injection; it does not
start an MCP command. No user config file or permission policy is rewritten.

See [OpenCode CLI](https://opencode.ai/docs/cli/),
[configuration precedence](https://opencode.ai/docs/config/), and
[local MCP servers](https://opencode.ai/docs/mcp-servers/).

## Chat models (DeepSeek)

The chat's model dropdown lists **DeepSeek Flash** (`deepseek-flash`) and
**DeepSeek V4 Pro** (`deepseek-v4-pro`) alongside the Claude models. DeepSeek
serves an Anthropic-compatible Messages API, so selecting one sets these for
that chat session only:

```
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY=<your key>
ANTHROPIC_MODEL / ANTHROPIC_SMALL_FAST_MODEL / DEFAULT_*_MODEL=<selected model>
```

Claude models retain their Anthropic routing. Switching to or from DeepSeek, or changing
a DeepSeek model, restarts the SDK process with the selected endpoint and credentials
while resuming the same conversation and mode. Switch after the current response finishes.
Explicit endpoint settings override the user credential file; the file overrides the default.

The API key is resolved in this order, so no key is ever stored in the repo or
inside the VSIX:

1. VS Code SecretStorage — run **kicad: Set DeepSeek API Key**
2. `kicadAgent.deepseek.apiKey` setting
3. `DEEPSEEK_API_KEY` environment variable
4. `~/.kicad-agent/deepseek.json` (`{"apiKey": "...", "baseUrl": "..."}`, mode 600)

`tools/ai/install.sh` seeds option 4 from `模型.md` when that file exists and the
user file does not. **kicad: DeepSeek Status** reports the endpoint and which
source the key came from; **kicad: Clear DeepSeek API Key** removes the
SecretStorage entry.

## KiCad tool access

Both clients call the shared JavaScript tool handlers in process. The extension uses the SDK's in-process server interface; the terminal uses native plugin tools. Neither starts a Go daemon or connector process.

The automation catalog contains 333 available typed actions exposed through 20 internal tools,
including the Gerber domain and project discovery/switching. The 57 native CLI
leaf commands are represented in the generated CLI schemas.
Beyond that, the 971 native `TOOL_ACTION` definitions are discoverable through
the `kicad_native_tools` tool (list/search/show), and invokable by their
registered name via the `editor.run_action` action. Its optional `editor` selects
the PCB, schematic, symbol/footprint, Gerber, 3D, CvPcb, drawing sheet or manager
frame; common actions require an explicit editor when several windows are open. `editor.selection.*` and
`editor.commit.begin/end` provide selection management and transactions. This
is still not complete coverage of KiCad's native GUI tools: many need selections,
mouse input or dialogs. `RunAction` only acknowledges submission and is
unsuitable as completion proof.
See `ARCHITECTURE_REVIEW.txt` and `audit/native-tools.json` for scope and gaps.

Use `project.list` to inspect projects in a directory, `project.resolve` to
resolve one without opening it, and `project.switch` to choose a full project
path. Multiple projects return explicit candidates rather than opening the first
PCB. The native manager also has File → Open Project Folder. Reopening the
current project preserves open editors and the manager window.

For IPC actions, open a document through `project.open`, or start the API server
explicitly. Starting OpenCode alone does not open a KiCad design. Health checks
must inspect the nested IPC status as well as the outer `ok` field.

## Build and checks

```sh
git submodule update --init tools/ai/upstream/Kicad-extension
tools/ai/Kicad-extension/build.sh
```

Requires Node, pnpm and git. The script archives the pinned submodule into a
temporary directory, applies the overlay, installs dependencies, runs TypeScript
type checking and integration boundary checks, then builds and packages the
VSIX under `dist/`. Existing VSIX files are retained. The upstream checkout is
not edited. Patch-anchor drift fails the build instead of silently skipping MCP
or prompt injection. The downstream pnpm lockfile is committed and installation
uses --frozen-lockfile. Build manifests bind source hashes to packaged artifacts;
installation rejects stale source/artifact combinations and compares installed files.

```sh
code --install-extension tools/ai/Kicad-extension/dist/kicad-0.4.29.vsix --force
python3 tools/ai/Kicad-extension/audit-tools.py --output tools/ai/Kicad-extension/audit/native-tools.json
```

`test-overlay.mjs` checks native executable/argv launching, multi-root selection,
Native tool environment, JSONC config preservation, missing executable handling, workspace
trust and patched SDK syntax. It does not claim a real model session passed.

## Layout and licenses

- `../upstream/Kicad-extension`: pinned, unmodified upstream submodule (AGPL-3.0).
- `apply-overlay.mjs`: downstream metadata, SDK registration and entry hooks.
- `overlay/kicadRuntime.ts`: shared module loading, in-process SDK registration and config.
- `overlay/kicadIntegration.ts`: native OpenCode terminal and config preview.
- `overlay/kicadProviders.ts`: DeepSeek credentials, chat env routing and key commands.
- `overlay/kicad.svg`: activity-bar icon.
- `overlay/KiCadWordmark.vue`, `overlay/kicad-logo.png`: welcome wordmark and native KiCad app icon.
- `audit-tools.py`: offline inventory with source/line references.
- `ARCHITECTURE_REVIEW.txt`: Chinese project analysis and acceptance gaps.

The extension and overlay are AGPL-3.0; the shared native runtime is GPLv3+
module loaded in the extension host. The MIT-licensed OpenCode runtime is built
separately by `../Kicad-terminal` and is not bundled in the VSIX. Upstream bundled
Claude CLI retains its own license text.

## Backend audit, research and connection status

Version 0.4.26 loads the shared JavaScript handlers in both clients. `system.manifest`
reports its action/MCP counts and catalog hash. `audit.rules`, `audit.run` and
`audit.footprint` own engineering policy and checks on the backend; no rule engine
or manufacturing thresholds are embedded in the frontend. Native DRC runs all
severities including exclusions, all track errors, zone refill in memory and
schematic parity; ERC also runs all severities. Reports preserve input hashes,
native JSON and explicit missing manufacturing, datasheet and mechanical evidence.
A structural footprint check or zero DRC alone never certifies fabrication readiness.

`web.search` searches public web results and `web.fetch` reads public reference
pages or downloads PDFs as artifacts. Results retain source URLs and retrieval
metadata. Private-network URLs and embedded credentials are rejected. Fetched
content is reference data rather than tool instructions. Existing SDK web tools
and the complete terminal provider/tool capabilities remain available.

Use **Kicad: 检查连接状态** or the Kicad status item for backend inventory, native
CLI, IPC, loaded documents and optional tools. Background suggestions can be
toggled in Settings → 输入辅助, with errors displayed beside the input. The normal
composer remains free of a tool-reference row or suggestion checkbox.

## macOS 启动与测试隔离

正常使用时按标准方式安装 VSIX，保留真实 HOME 和 VS Code 加密凭据存储。
自动验收使用临时 HOME、独立扩展目录和 `--use-inmemory-secretstorage`，不访问系统钥匙串；
此参数仅用于无真实凭据的测试。`vscode-test-host.cjs` 直接启动编辑器并拥有其进程组，
超时或结束时关闭整组测试进程，避免 CLI 退出后遗留开发窗口。
`python3 tools/ai/Kicad-extension/test-startup.py` 验证成品包的聊天、设置及原生终端启动。

## 后端运行日志与问题分析

扩展与终端共用本地运行日志。SDK 工具钩子记录调用生命周期与错误，SDK 流捕获 AI
返回错误、异步迭代异常和 CLI 标准错误中的报错，连接检查记录 IPC 的实际结果。
聊天可以直接说“分析当前工作区的运行错误”，调用常驻只读工具 `runtime_diagnostics`；
也可在命令面板运行 **Kicad: 运行日志与问题分析**，选择工作区后查看两端的分类统计、
错误样例、会话/调用 ID 和排查建议。报告是本地 JSON，只读，不重放历史任务。

默认保存在 `~/.local/state/kicad/diagnostics/<工作区路径哈希>/`，支持
`XDG_STATE_HOME` 和 `KICAD_DIAGNOSTICS_DIR`。日志有脱敏、轮转与保留期限；具体数据范围、
读取上限和权限见 [终端日志说明](../Kicad-terminal/README.md#后端运行日志与诊断)。
这里覆盖主聊天 SDK、工具、连接检查，以及扩展的独立提示词优化/下一句预测请求。
宿主启动前的崩溃仍需结合原生日志排查。新增日志在加载新版扩展后生效，旧会话不会被补造记录。

### 本地会员与完整模型名称

模型菜单从本机 `claude` 的初始化模型目录、`codex app-server` 的 `account/read` 和分页 `model/list` 发现型号。Claude 优先使用本地 CLI（可通过 `KICAD_CLAUDE_PATH` 指定）；Codex 可通过 `KICAD_CODEX_PATH` 指定。菜单显示具体模型 ID 和本地登录状态，并去重 Claude 默认/Opus 等指向同一型号的别名。没有登录 ChatGPT 时不会把 API Key 登录当作会员。

Claude 会话复用本地 Claude 登录，DeepSeek 保持独立 API 配置。Codex 会话通过本地 app-server 运行；KiCad 动态工具调用共享进程内后端，写操作遵守会话权限，计划模式拒绝写操作。切换模型后，下次发送时重启对应会话；跨后端通过工作区隔离的本地历史传递上下文，原历史保留。Codex 的停止、错误、工具结果和用量会映射到现有聊天/诊断事件。优化提示词与下一句建议使用对应会员的独立纯文本请求。

本地 CLI 保管并刷新登录；应用不把令牌保存到设置或日志。Codex 终端/辅助请求读取 CLI 管理的 `$CODEX_HOME/auth.json`（默认 `~/.codex/auth.json`）；目前该路径需要文件凭据存储。模型目录不等于所有模型均可成功调用；额度耗尽、账户策略和网络错误以实际请求为准。Claude/Codex 会员不替代 DeepSeek API Key。

### Built-in documentation and local memory (0.4.34)

Both interfaces register `context7`, `session_history`, and `local_memory` directly in-process, including the extension's Codex backend. They are available without a slash command or an external MCP daemon. Context7 uses the official fixed-origin REST API (`https://context7.com/api/v2/libs/search` and `/context`); only the explicit documentation query is sent. Configure `CONTEXT7_API_KEY` or a private `~/.config/kicad/context7.json` (`{"apiKey":"..."}`, mode 0600; XDG_CONFIG_HOME supported). Keys are not bundled in the extension or terminal artifacts.

Chat archives remain local: extension events under `~/.local/share/kicad/history/extension/`, terminal conversations in `~/.local/share/opencode/opencode.db`, and native Claude history under `~/.claude/projects/`. The shared history reader scopes both sources to the canonical workspace. `KICAD_HISTORY_DIR` overrides the shared history root; `KICAD_HISTORY_DB` overrides the terminal database.

`local_memory` appends verified summaries or user-requested preferences to `<history-root>/memory/<workspace-hash>/memory.jsonl` with private file permissions. `read` recalls the latest 30 matching records; it does not automatically replay historical instructions. Credentials are redacted from memory summaries. Chat archives and memory summaries are distinct: retaining chats does not imply every message becomes an enduring preference. The model can list/read prior chats and append/recall memory through natural-language requests. Network documentation queries and memory writes respect the active tool permission mode.

The model selector shows short names only (for example `Opus 5.5`, `GPT-6.1 Sol`); the full model ID remains the request value and is available in the extension's hover hint. Local login status is in the selector heading's hover hint.

### 0.4.64：设置页面与发布更新

Skills、Slash Commands、Hooks、Plugins 页面现在展示本地清单；技能开关、MCP 来源同步开关和过期权限规则清理使用实际配置回读。
浏览设置不会启动 MCP 服务器、运行 hook 或调用模型；跨工具 MCP 来源标识和敏感字段隐藏保留。
本版本重新构建共享运行时，终端配套版本为 0.2.3。

### 0.4.63：本地斜杠菜单与共享策略设置

`/` 菜单由扩展维护，不依赖 Claude 的 `supportedCommands`、登录或所选模型。
Claude、DeepSeek、自定义兼容模型与 Codex 使用相同的 `/model`、`/effort`、`/permissions`、
`/tools`、`/skills`、`/mcp`、`/status`、`/doctor`、`/settings`、`/history`、`/new` 入口。
工具和技能目录每页最多 10 条；可输入 `/tool:名称` 或 `/skill:名称` 筛选，选择只插入草稿。
浏览不调用模型、执行工具、读取技能正文或连接 MCP。自然语言调用仍保留，不要求先输入 `/`。
`/mcp` 只显示配置状态；`/status`、`/doctor prompt-audit` 在编辑器内打开只读报告。
菜单中的能力属于本扩展，不会把其他产品的账户功能显示成已经实现的本地功能。

共享配置依次读取 `~/.config/kicad/settings.json`、工作区 `.kicad/settings.json`、
`.kicad/settings.local.json`、显式 VS Code 设置，以及最后的托管设置。
macOS 托管路径为 `/Library/Application Support/KicadAgent/managed-settings.json`；
`KICAD_MANAGED_SETTINGS` 可指定其他路径。扩展支持 JSONC；独立终端使用 JSON。
VS Code 中使用 `kicadAgent.` 前缀，例如 `kicadAgent.maxEffortLevel`。

```json
{
  "autoMode": true,
  "deniedModels": ["model-id-to-block"],
  "maxEffortLevel": "high",
  "modelSettings": {"deepseek-*": {"maxEffortLevel": "high"}},
  "maxProseWidth": 100,
  "commitAttribution": false,
  "mcpVerification": true,
  "autoModeSuggestions": false
}
```

- Agent 默认开启低风险自动操作；本地已知只读操作和工作区内普通文件编辑可直接执行。
  Shell、Git、未知工具及敏感路径仍按权限询问。这里使用保守的本地规则，不声称等同于 Claude 的风险分类模型。
- `deniedModels` 支持完整 ID 或 `*` 通配符，跨层合并；推理上限取各层更低值。
  配置禁用名单时必须选择可检查的具体模型 ID。主会话、辅助建议和优化请求均检查策略。
- `maxEffortLevel` 只保留模型实际支持的档位；Auto 也遵守上限。推理强度不会授权子代理。
- `maxProseWidth` 限制终端正文宽度，0 表示不限；工具输出保持原样。
- `commitAttribution:false` 对 Claude SDK 会话传入空署名配置，不修改用户现有 Claude 配置文件。
  本地终端与 Codex 没有本扩展额外添加署名的机制。
- `mcpVerification:false` 仅在 Agent 自动模式下免去共享按需 MCP 包装器的逐次调用确认。
  它不关闭 TLS、身份验证或服务器证书校验；原生 direct MCP 的权限仍由对应运行时负责。
- `autoModeSuggestions:false` 阻止下一句预测请求；手动提示词优化继续可用。
- WebFetch 下载默认总期限为 5 分钟，取消、SSRF 防护和大小限制继续生效。

“提示词审计”是静态只读检查：报告已注册组件、长度和工作区指令文件中的可疑模型约束，
不调用模型，也不宣称已经语义验证所有运行时动态提示词。
命令面板的 **Kicad: Evaluate Claude Plugin** 检查本机 Claude 是否支持 `plugin eval`，
再由标准任务终端运行实际评估；需要带 `.claude-plugin/plugin.json` 的 AI 插件。
这不是原生 KiCad 插件或电路正确性认证；旧 CLI 会明确要求升级。

Ultracode 是独立于 effort 的多代理工作流，不是 Ultra 档位的别名。
参考 [Claude 官方工作流说明](https://code.claude.com/docs/en/workflows) 和
[Serverworks 的版本评述](https://blog.serverworks.co.jp/2026/10/03/190000)。
当前捆绑 CLI 2.1.83 不支持该新功能，因此不显示不可用的 Ultracode 开关；
同时设置 `CLAUDE_CODE_DISABLE_WORKFLOWS=1`，子代理继续由独立设置和当前用户明确请求共同授权。


## Computer Control (0.4.65, macOS)

Open **Kicad Settings → Computer Control**. The independent switch manages the signed [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) app (tested with 0.38.0). Install the official signed app and grant it Accessibility and Screen Recording in macOS before enabling screen actions. The extension does not download a driver or optional perception models automatically.

```json
{
  "kicadAgent.computer.enabled": true,
  "kicadAgent.computer.driverPath": "",
  "kicadAgent.computer.anyApp": false,
  "kicadAgent.computer.allowedApps": [
    "org.kicad.kicad", "org.kicad.pcbnew", "org.kicad.eeschema"
  ]
}
```

These are application settings, so a repository cannot enable computer control. KiCad is allowed by default; Chrome, Excel and additional bundle IDs have separate access controls. Any App permits native application windows. Chrome's browser extension, Excel's add-in and locked-screen access are separate integrations and are not installed or emulated by this feature. Unlock the Mac before using screen control.

The private `org.kicad.agent.cua-driver` LaunchAgent starts the signed app in the background without a floating preview or cursor overlay, survives editor exit, and restarts at login. Off disconnects current MCP clients, stops only this extension's endpoint and removes its LaunchAgent. Restart, permission status and View Log are available in settings. The driver remains an external MIT-licensed dependency; optional AGPL perception components are not bundled.

Models discover `computer_tools`, then use `computer_read` and `computer_action` through the existing capability catalog as needed. Starting the service does not start an agent, capture the screen or run a workflow. App access is rechecked on each call; actions require an observed window and conversation-owned tokens. Read-only mode cannot dispatch input. Screenshots remain image blocks through the Claude-compatible SDK and Codex adapter; text-only providers can request accessibility trees with `include_screenshot:false`. The managed service currently supports macOS only.

For Cua 0.38.0's known `get_window_state` delta count validation error, the adapter refreshes the same window once without `since`. It preserves other errors and never repeats an input action.

Validation distinguishes deterministic host/UI tests from live model acceptance. `test-computer-use.mjs BUILD_DIR` tests policy and transport; `test-computer-ui.cjs BUILD_DIR` uses the production webview with a fixture host. `test-computer-models.mjs BUILD_DIR /tmp/kicad-cua-fixture PID WINDOW_ID OUTPUT_DIR` is an explicit live acceptance script that permits only one disposable KiCad window and restores its selection filter after each model. It requires both model-visible readback and independent state verification. It is never run by the build and never operates on user boards.


## Shared integrations and settings recovery (0.4.66)

MCP Servers → Sync from Other Tools reuses existing local configurations without copying them. The separate **Codex Plugins** and **Claude Plugins** switches are off by default. Opting in offers standalone MCP servers from locally installed, user-selected plugin packages through the same on-demand catalog used by Claude, DeepSeek, Codex and other providers. Each server has a plugin namespace, its source path and its own disable switch. Opening settings does not connect servers.

Supported package formats: portable `plugin.json` + `mcp.json`, Codex `.codex-plugin/plugin.json` + `.mcp.json`, and Claude `.claude-plugin/plugin.json` with default `.mcp.json`, declared local JSON files and inline server maps. `${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` resolve to the installed directory. Claude project installations, unselected packages, ambiguous Codex cache versions without `latest`, paths outside a package, remote MCP bundles, executable authentication helpers and host-specific tool policies are not imported. Authentication stores, lifecycle hooks and registered `.app.json` connections stay in the original app. A private Codex computer/browser connection is reported as unavailable rather than launched outside its host. Existing configured MCP servers retain precedence.

The Chrome and Excel switches under Computer Control grant Cua native app-window access. They do not claim to attach another product's browser extension or Excel add-in. Use an existing standalone MCP integration for those structured tools. Locked-screen use is shown as unavailable without a switch.

If an editor window still has the settings schema from an earlier installation, Computer Control reports that state before a write and offers **Reload Window**. Reload is user-triggered; activation never interrupts a running conversation. Computer-control configuration is read from the user layer explicitly, so workspace settings cannot broaden application access even during an upgrade. After installation, reload existing editor windows to register the new manifest.

References: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude plugin manifest](https://code.claude.com/docs/en/plugins-reference), [Claude Chrome integration](https://code.claude.com/docs/en/chrome).
