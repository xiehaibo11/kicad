# Kicad 终端

完整 OpenCode 运行时的 Kicad 品牌版本。源码目录：`tools/ai/Kicad-terminal`；
对应扩展目录：`tools/ai/Kicad-extension`。安装后在任意项目目录执行 `Kicad` 启动，
旧命令 `kicad` 和内部运行时 `kicad-terminal` 保持兼容。原有配置、协议、模型与插件标识保持兼容。

## 0.2.1 KiCad 工具按需加载

会话开始时模型只看到一个很小的 `kicad_load` 工具和简短说明（`composer/eda-agent-instructions.md`），
不再每次请求都带上 20 个 KiCad 工具定义和完整指南。用户消息涉及 KiCad、PCB、原理图、封装、DRC/ERC、
布线、制造文件等，或模型调用了 `kicad_load`，从下一步起（同一轮内）才列出 20 个 KiCad 工具，并在系统提示中
加入完整指南（`composer/kicad-tools-guide.md`）；之后该会话一直保持加载（压缩后也保持）。
判断规则在 `composer/kicad-tools.ts`，与 VS Code 扩展共用；实现见 `overlay/packages/opencode/src/kicad/lazy.ts`。

## 0.2.0 工作台界面与更新

0.2.0 起终端版本号独立于运行时：`Kicad --version` 输出 Kicad 版本（与 npm 包一致），
底层运行时仍为 OpenCode 1.19.3，可在 `/status` 查看。界面文字保持英文。

- **首页工作台**：KiCad 卡片显示 IPC 连接、`kicad-cli` 版本、KiCad 中打开的 PCB/原理图
  （未连接时列出当前目录的 `.kicad_pro`），以及快捷任务。点击快捷任务只把命令填入输入框，不自动发送。
- **快捷任务斜杠命令**：`/kicad-health`（不经模型，直接检查连接）、`/kicad-drc`、`/kicad-fab`、
  `/kicad-route`、`/kicad-step`、`/kicad-schematic`，由会话运行时插件注册；用户自定义的同名命令优先。
  原有斜杠命令、模型、服务商、会话、权限和快捷键全部保留。
- **KiCad 状态**：服务端 `/kicad/status` 通过同一组进程内工具只读调用 `system.version`、`system.ping`、
  `document.list`，单飞请求、15 秒刷新，KiCad 工具调用完成后自动刷新。输入框右侧和首页底栏显示状态。
- **工具结果卡片**：会话中的 `kicad_*` 调用显示为“动作 + 文档 + 结果摘要”一行，点击展开原始 JSON。
  DRC/ERC 有违规显示为 `!`（不是通过），工具出错为 `✗`，连通性未证明等设计结论按问题而非故障显示；
  被截断保存到文件的大结果会读取文件后再摘要。
- **侧栏**：会话侧栏顶部增加 KiCad 面板：连接状态、打开的文档、本会话最近一次 DRC/ERC/连通性等检查结论、产出文件。
- **主题**：默认 `kicad` 主题（KiCad 蓝与橙），`/themes` 仍可切换全部原有主题。
- **更新**：`/update` 与 `Kicad upgrade` 只检查 npm 包 `@-kicadai/kicad-code`（遵循 npm registry 配置，
  镜像没有该包时回退 npmjs），不再提示或安装 OpenCode 1.x/2.0。npm/pnpm/bun 全局安装用对应包管理器升级；
  独立安装（本脚本）下载 npm 包、校验 sha512 后原地替换运行时、资源与启动器；npx 与开发构建只显示操作说明。
  `Kicad upgrade --check` 只检查不安装。`OPENCODE_DISABLE_AUTOUPDATE=1` 或 `KICAD_DISABLE_UPDATE_CHECK=1` 关闭检查。
- **卸载**：`Kicad uninstall` 只删除 Kicad 自己的程序文件或 npm 包；与 OpenCode 共用的配置和会话默认保留，
  需要时加 `--remove-config`、`--remove-data`。崩溃报告指向本项目仓库。

构建脚本每次先把 `cache/Kicad` 恢复为固定上游提交的干净状态，再依次应用品牌、输入框、等待动画、
推理强度和工作台覆盖层（`apply-workbench.mjs`）。`overlay/` 中每个源文件都放在它在 OpenCode
检出中的同一相对路径（如 `overlay/packages/tui/src/kicad/status.tsx`），并带有引用 `cache/Kicad`
的 TypeScript 工程，编辑器可直接类型检查；首次需运行 `build.sh` 或 `link-overlay.sh`，见 `overlay/README.md`。
界面实测：`test-workbench-live.py`（真实 PTY、隔离 KiCad API 服务、本地模型与 registry 夹具），
截图与文本快照保存在 `audit/workbench/`。工具封装实测：`test-tools-native.py`（打包的运行时 + 本地模型夹具：
模型拿到的 schema 与共享定义一致、参数错误简短、相对路径按会话目录解析、写操作按动作询问且只读操作不询问、
拒绝写操作后本轮停止）。

## 安装与启动

在本仓库根目录安装已构建的 macOS Apple Silicon 终端：

```sh
bash tools/ai/Kicad-terminal/install.sh
Kicad --version
Kicad
```

安装、更新都使用同一个脚本，不需要 `sudo`。默认命令是 `~/.local/bin/Kicad`，
帮助、子命令示例、会话恢复提示统一使用 `Kicad`。脚本会提示缺少的 PATH 配置，
不会改写 shell 配置、模型选择、凭证或会话。支持自定义安装位置：

```sh
bash tools/ai/Kicad-terminal/install.sh --prefix "$HOME/.local"
Kicad --help
Kicad --continue
Kicad /path/to/project
```

同时安装 KiCad 后端、技能和已构建的 VS Code 扩展，使用 `bash tools/ai/install.sh`。
独立终端安装会校验构建清单并安装完整运行时和内部工具资源；它不重新编译 KiCad 后端。
原生命令行仍使用 `kicad-cli`，图形软件使用 `kicad-eda`。

入口格式参考 [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) 和
[Claude Code](https://code.claude.com/docs/en/setup)：安装脚本执行一次，之后用软件名启动。
另提供保留完整原生运行时与共享 JavaScript 工具的 npm 分发，入口命令仍为 `Kicad`。
支持平台、安装命令和源码构建方式见 [npm 分发说明](npm/README.md)。
npm 包名使用账号作用域，避免与现有 KiCad 原生命令包混淆。

输入 `/effort` 打开推理强度选择，按当前模型实际声明的 variants 展示档位。
选择后在下一次手动发送时生效，不会自动发送或新建会话；原有 `/variants` 保留。
自动档恢复模型默认参数。模型选择、各模型的档位记忆和服务商参数传递继续使用原生实现。
注入的 DeepSeek 提供 Thinking off、Low、High、Max；支持 OpenAI 的模型按原有能力声明提供档位。
对应扩展 0.4.14 用输入框 UI 选择。参考
[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)。

下一句建议只显示在空输入框内，按 Tab 接受到草稿，不自动发送。

直接用自然语言提问即可自动调用工具，不需要输入 `/`：`Kicad` 启动器把
`~/.local/share/kicad-terminal/eda-agent-instructions.md` 注入 OpenCode `instructions`，
KiCad 工具由终端插件在进程内直接调用共享 JavaScript，再调用原生 IPC/CLI；无需 Go daemon、外部 EDA 客户端或连接器。

发送消息后，蓝色 Ki 标识和与扩展一致的动态等待文字显示在消息区域，
替代原来的 `Build · 模型名` 状态行；底部操作栏不再重复显示等待动画。
终端使用字符徽标适配普通终端显示；关闭动画时显示静态 `Ki Thinking...`。
Esc 中断、模型重试及错误详情继续使用原有功能。

## Full runtime

The full OpenCode 1.19.3 terminal with `Kicad` branding and an additive composer
overlay. Upstream is pinned in `upstream.json`. This is a downstream KiCad
integration, independently maintained and not affiliated with the OpenCode team.

The startup wordmark, home version label, session sidebar, terminal title,
notification title and application permission/crash messages display `Kicad`.
The internal runtime executable is `kicad-terminal`. After either installer, the
`Kicad` command starts this AI terminal with in-process KiCad tools enabled. The lowercase
`kicad` entry remains compatible. Native EDA
automation remains available through `kicad-cli`.

Providers, model IDs, authentication, saved sessions, skills, plugins, tools,
permission handling, server APIs, CLI subcommands, embedded Web UI, configuration
directories and environment variable names are retained from upstream. External
service names such as OpenCode Zen/Go and documentation links identify their
actual services and are retained. Updates use Kicad's own release channel
(`@-kicadai/kicad-code`), never upstream OpenCode releases; see the 0.2.0 section above.

Build on macOS arm64 with Bun 1.3.14 and Node:

```sh
tools/ai/Kicad-terminal/build.sh
# Optional: use an existing checkout pinned to the same upstream commit.
tools/ai/Kicad-terminal/build.sh /path/to/Kicad-terminal
tools/ai/install.sh
```

Start from VS Code using **Kicad: 打开终端** (extension 0.4.3 or later), or open
`start.command` in macOS Terminal to inspect it in this repository. The latter
registers the native tool plugin while preserving other providers and user/project
settings. Old kicad/easyeda connector entries are removed after config merging.

Original branding delivery checks passed: 201 TUI tests, one skip, all 22 original CLI entries,
server health and embedded Web UI plus its JavaScript asset. Those were historical
branding checks; current builds use the native tool plugin and no KiCad MCP process.

The build uses upstream's lockfile and full native build (including embedded Web
UI), and retains its ad-hoc macOS code signing. The original `opencode` binary
is preserved. Updating the upstream runtime directly can restore upstream
branding; use this overlay to rebuild a branded update.

OpenCode is MIT licensed. Its original license is shipped with the build in
`dist/LICENSE-OpenCode.txt`; this overlay does not remove upstream attribution.

## Composer assistance

The additive composer controls are available in the native TUI. The embedded
Web UI retains its upstream interface and full functionality.

- After a completed turn the current model can propose the next user message,
  displayed as muted placeholder text only while the editor is empty. Only Tab accepts it as an editable draft without sending; Esc dismisses.
  Ordinary upstream bindings return after accepting or dismissing the suggestion.
- `/suggestions` toggles background generation; `/suggest` requests a suggestion.
  Each uses bounded recent text context, omitting tools, images and reasoning.
  Ambiguous next steps may produce no suggestion.
- In the command palette choose **Optimize prompt (current model, not sent)** to replace
  the current draft in place. The palette also offers **Undo prompt optimization** and
  **Cancel prompt optimization**. Errors and concurrent edits preserve the draft.
- `/tools` opens a searchable catalog from the server's actual native and external tool definitions.
  Selecting inserts the name, description and schema without executing the tool.
  Unknown/parameter-dependent access modes are labeled explicitly.

The `/kicad/composer` and `/kicad/tool-references` endpoints use normal server
authorization and workspace routing. Generation reuses OpenCode LLM routing,
provider credentials, request headers and model options, with no tools, agent
loop or saved-session writes. Timeout is 60 seconds. Prediction can abstain with
`<NONE>`. Ordinary chat, permissions, providers and CLI commands remain upstream.

The launcher and VS Code terminal integration also expose **DeepSeek Flash** and
**DeepSeek V4 Pro** when existing KiCad DeepSeek credentials are available. No
key is written to the repository or extension package. An inherited inline
provider definition takes precedence. Use `/models` to choose the current model;
`Kicad --model kicad-deepseek/deepseek-flash` starts directly with the tested model.
OpenCode's hosted free tier may reject auxiliary generation requests; these
failures are shown inline and never replace or send the draft.

## Backend and reliability checks (2026-10-20)

`/kicad-health` invokes the internal health tool directly and separates native CLI, IPC,
loaded documents and missing optional tools. Both clients share the backend
`audit.rules`, `audit.run`, `audit.footprint`, `web.search` and `web.fetch` actions.
Engineering rules remain on the backend. Reports retain DRC/ERC JSON, input hashes
and missing manufacturing/datasheet/mechanical evidence rather than declaring
fabrication readiness from zero DRC.

Optimization preserves attachments and rejects stale output after edits, model
changes or attachment changes. A truncated or incomplete model response fails
without replacing the original draft. The full TUI suite runs during every build;
build manifests verify artifact/source consistency before installation.

## 需求确认与任务连续性

`session-runtime.mjs` 是随安装启动的本地服务插件，不发起启动任务或额外模型请求。
只有实际提交的明确任务才可调用业务工具；数字、问候、空输入先澄清，真实问题回答后继续。
自然语言中缺少目标时仍由模型判断并询问，不猜选项。工具集、选定模型和权限模式保留。

沿用 OpenCode 的自动上下文压缩，默认 `compaction.auto=true`、`prune=false`；
用户显式设置优先。压缩前从原会话数据库保存完整消息、工具输入输出和任务检查点，
压缩后恢复目标、最近修正、工具状态和记录路径。完整历史保留在数据库与
`${XDG_STATE_HOME:-~/.local/state}/opencode/kicad-task-state/<session-id>/`；
检查点副本为本地 0600 文件，缺失细节可以回查，不以摘要代替执行证据。
打开历史不等于继续任务；停止后等待用户明确续发，压缩不改变原来的修改范围或限制。

## 共享会话历史

输入 `/kicad-history` 可读取当前工作区的扩展和终端会话。内置 `session_history` 工具提供 `list` / `read`、`offset` / `limit` 分页；不依赖 KiCad 工具预先加载。扩展使用本地 JSONL，终端读取原生 OpenCode SQLite，按工作目录隔离。历史内容是引用数据，不自动恢复其中的任务；终端原生会话仍使用 `/sessions` 或 `--session <id>` 继续。
