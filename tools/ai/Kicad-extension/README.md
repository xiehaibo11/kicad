# Kicad

当前版本：0.4.30。项目根目录为 `Kicad`，扩展源码为 `tools/ai/Kicad-extension`，
终端源码为 `tools/ai/Kicad-terminal`。扩展显示为 **Kicad**，终端显示为 **Kicad 终端**。
扩展安装 ID 仍为 `kicad-agent.kicad`，可直接升级并保留用户配置。

0.4.30 增加当前工作区的共享会话历史：聊天面板历史列表可读取终端会话，标题标记为 `[终端]`，以只读方式展示；标题栏的历史按钮或 `Kicad: 共享会话历史` 命令可查看原始记录，并在终端继续原生会话。终端使用 `/kicad-history` 或 `session_history` 工具读取两端历史。跨运行时不混用会话 ID。

扩展用户消息与助手回复逐条保存到 `${KICAD_HISTORY_DIR:-${XDG_DATA_HOME:-~/.local/share}/kicad/history}/extension/` 的 0600 JSONL 备份，原生 Claude 会话仍保留在 `CLAUDE_CONFIG_DIR/projects`。历史读取合并未刷新的备份并按 UUID 去重；终端 SQLite 数据库以只读方式读取（macOS 使用系统 `/usr/bin/sqlite3`）。记录包含对话内容，应按用户数据保管；不会自动上传。Harness 的任务提醒、重复失败保护与大结果归档也随本版本集成。

0.4.29 起 KiCad 工具按需加载：新对话只带一个很小的 `kicad_load` 工具和简短说明，不再每次都把
20 个 KiCad 工具定义和完整 KiCad 指南放进上下文。发送的消息涉及 KiCad、PCB、原理图、封装、DRC/ERC、
布线、制造文件等工作时，扩展在发送前以同一会话（resume）重启 SDK 进程并挂上全部工具和指南；之后该对话
一直保持加载。模型在未加载时调用 `kicad_load`，工具会随用户的下一条消息挂上。恢复的历史对话若用过 KiCad
工具或提过 KiCad 需求，打开时直接加载。判断规则与终端共用 `composer/kicad-tools.ts`。

0.4.28 更新共享工具模块与终端插件：`board.export.*` 等命令行导出接受 `document` 作为输入文件；
SVG/DXF/PDF/PS 导出缺少 `layers` 时在调用前报错；阻抗计算找不到层时列出实际铜层；
未指定类型的 `document.list` 同时列出打开的 PCB 与原理图。从扩展打开的 Kicad 终端（0.2.0）
随附 `/kicad-drc`、`/kicad-fab`、`/kicad-route`、`/kicad-step`、`/kicad-schematic` 快捷任务命令。

已公开的稳定安装包见 [GitHub Release 0.4.22](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.22)。
下载 `kicad-0.4.22.vsix`，在 VS Code 扩展菜单中选择 **从 VSIX 安装…**，或者执行：

```sh
code --install-extension ./kicad-0.4.22.vsix --force
```

需要 VS Code 1.98 或以上版本，当前验证平台为 macOS Apple Silicon。
VSIX 包含聊天界面、Claude Agent SDK/CLI、会话插件和共享原生工具；
KiCad 软件、原生 CLI 及完整终端运行时单独安装，共享 JavaScript 工具随 VSIX 提供，参见
[AI 工具集安装说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/README.md)和
[终端安装说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-terminal/npm/README.md)。
发行页同时提供 SHA-256 校验文件与本次构建验证报告；该发布渠道为 GitHub Release。

执行过程按每次请求合并，默认只显示一行运行状态和工具调用次数，点击展开或收起详情。
工具参数、原始输出、子代理说明、思考和中间进度都在执行记录中；重要问题、需用户
决定的事项、错误摘要和最终回复单独显示。权限确认不折叠。纯聊天仍正常显示回复，
完成、失败、停止或连接中断按实际事件区分，不会把停止当作完成。历史记录同样可展开。
0.4.24 在展开的执行详情底部增加“收起执行详情”，可直接收起并返回顶部状态入口，
支持鼠标和键盘；收起不暂停任务，重新展开保留完整记录。

暂停立即停止接收旧通道的界面事件，并清理旧权限确认；后端结束旧 SDK 进程。
再次手动发送时恢复原会话及模型、推理强度、权限和目录。旧结果或流结束回调不会清空
新请求状态；单次会话启动失败也不会让后续消息分发停止。不自动重发已暂停的任务。
聊天中不再单独展示 Interrupted / Tool interrupted 提示，停止状态保留在可展开的执行记录里。
手动续发按当前权限继续调用工具，不附加只读限制或额外的“重新发送成功”回复。

模型菜单立即展示本地模型和自定义配置，SDK 模型发现只在首次打开时异步执行，
不阻塞选择。支持搜索、方向键和 Enter。模型与推理强度切换先保存到会话，
只在下一次手动发送前更新 SDK 进程，恢复原会话和权限；选择本身不启动对话或发送消息。
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
原有 `/kicad-*` 命令只作为可选别名保留。只读且不联网的工具（`kicad_load`、health、actions、native_tools、
spec_validate、blocks、reference、audit）不再弹出确认；会修改设计、联网（web）或写出文件（gerber）的工具仍按当前权限模式确认。

自动调用以用户实际提交的任务为依据；打开面板、恢复历史、选择模型或权限、接受下一句草稿
都不会启动任务。只有数字、问候或空输入时先澄清，不会猜成“检查环境”或第一项。
后端在最高权限下同样拦截这些输入触发的业务工具和子代理。普通自然语言中目标或条件
缺失时，由模型先提问再执行。AskUserQuestion 显示真实问题、选项和自定义回答，默认不选中；
必须回答全部问题才能确认，通用 Yes 不能代替回答，取消后停止等待。

接近模型可用上下文上限时，由原运行时自动压缩。扩展默认设置
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85`（保留用户显式覆盖），CLI 仍会预留输出空间。
20% 用量不会触发压缩。压缩前保存完整会话记录、精确用户请求、工具输入/结果与任务清单；
压缩后补回原始目标、最近修正、工具状态、未完成事项及完整记录路径。工具返回不等于验证成功，
不自动重复已完成的修改。SDK 记录尚未落盘时，以实际收到的消息及工具钩子记录补齐检查点。
原始 CLI 记录保留，压缩副本和检查点位于 Claude 配置目录下 `kicad-task-state/<session-id>`，
本地记录使用 0600 权限。终端使用同一需求规则及本地运行时插件，在原有自动压缩基础上
保存历史、检查点并恢复任务上下文，默认不清理工具结果；保留用户明确的压缩设置。

参考 [OpenAI 官方上下文压缩说明](https://developers.openai.com/api/docs/guides/compaction)
与 [长任务状态管理示例](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction)。
这里适配现有 Claude SDK / OpenCode 运行时，不调用 Codex 的私有桌面接口；摘要仍可能遗漏细节，
需要时可回查完整记录和项目文件，不保证模型的语义记忆绝对无损。

**KiCad 原生工具**：扩展直接在进程内加载共享 JavaScript，调用 KiCad 内部 IPC/CLI。终端使用同一份源码构建的原生工具插件。不再注册外部 EDA、Go daemon 或连接器。

新对话默认选择 **Agent**，模式菜单将 Agent 放在首位；仍可手动选择 Default 或 Plan。
点击模式菜单可选择 **最高权限**，自动允许文件读写、Bash 命令及 MCP 工具调用，
不必反复点击 Yes。可随时切回其他模式；设置中的默认权限模式也可选择最高权限。
切换会放行当前待确认的工具操作，但用户问题与计划决策仍由用户回答。

输入框中的脑图标现在是 **推理强度** 菜单，按当前模型和运行时支持的档位选择。
DeepSeek Flash / V4 Pro 提供自动、关闭思考、轻度、高、最高；Claude Sonnet 提供
自动、关闭、轻度、中等、高，Opus 额外提供最高。其他兼容模型保留自动和思考开关。
选择只影响后续聊天请求，不自动发送；切换会恢复同一会话并保留权限模式。
同一对话中记住各模型所选档位，切换模型时会校验支持范围。失败会保留原档位并显示错误。
扩展继续使用 Claude Agent SDK；没有把 Codex 桌面端内部代码嵌入扩展。
CLI 固定为 2.1.83，SDK API 保持 0.1.77；强度通过真实的 `output_config.effort` 发送。
DeepSeek 的预算参数不控制推理强度，因此显式传递该提供商支持的 effort。

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
the downstream extension version is 0.4.30.

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
