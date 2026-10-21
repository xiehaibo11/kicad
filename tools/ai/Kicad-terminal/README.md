# Kicad 终端

完整 OpenCode 运行时的 Kicad 品牌版本。源码目录：`tools/ai/Kicad-terminal`；
对应扩展目录：`tools/ai/Kicad-extension`。安装后在任意项目目录执行 `Kicad` 启动，
旧命令 `kicad` 和内部运行时 `kicad-terminal` 保持兼容。原有配置、协议、模型与插件标识保持兼容。

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
独立终端安装会校验构建清单并安装完整运行时和 MCP 适配资源；它不重新编译 KiCad 后端。
原生命令行仍使用 `kicad-cli`，图形软件使用 `kicad-eda`。

入口格式参考 [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) 和
[Claude Code](https://code.claude.com/docs/en/setup)：安装脚本执行一次，之后用软件名启动。
另提供保留完整原生运行时与 NNG 后端的 npm 分发，入口命令仍为 `Kicad`。
支持平台、安装命令和源码构建方式见 [npm 分发说明](npm/README.md)。
npm 包名使用账号作用域，避免与现有 KiCad 原生命令包混淆。

输入 `/effort` 打开推理强度选择，按当前模型实际声明的 variants 展示档位。
选择后在下一次手动发送时生效，不会自动发送或新建会话；原有 `/variants` 保留。
自动档恢复模型默认参数。模型选择、各模型的档位记忆和服务商参数传递继续使用原生实现。
注入的 DeepSeek 提供关闭思考、轻度、高、最高；支持 OpenAI 的模型按原有能力声明提供档位。
对应扩展 0.4.14 用输入框 UI 选择。参考
[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)。

下一句建议只显示在空输入框内，按 Tab 接受到草稿，不自动发送。

直接用自然语言提问即可自动调用工具，不需要输入 `/`：`Kicad` 启动器把
`~/.local/share/kicad-terminal/eda-agent-instructions.md` 注入 OpenCode `instructions`，
同时注册 `kicad` 与 `easyeda`（EDA Agent Connector，上游 easyeda-agent MCP 适配器）两个 MCP 服务器；
OpenCode 也会读取 `~/.claude/skills` 中的 `kicad-*` 技能。显式继承的同名配置优先；
缺少 easyeda CLI、node 或连接器包时只注册 KiCad。

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
`Kicad` command starts this AI terminal with KiCad MCP enabled. The lowercase
`kicad` entry remains compatible. Native EDA
automation remains available through `kicad-cli`.

Providers, model IDs, authentication, saved sessions, skills, plugins, tools,
permission handling, server APIs, CLI subcommands, embedded Web UI, configuration
directories and environment variable names are retained from upstream. External
service names such as OpenCode Zen/Go and documentation links identify their
actual services and are retained. Application update messages say runtime;
the upstream update implementation is retained.

Build on macOS arm64 with Bun 1.3.14 and Node:

```sh
tools/ai/Kicad-terminal/build.sh
# Optional: use an existing checkout pinned to the same upstream commit.
tools/ai/Kicad-terminal/build.sh /path/to/Kicad-terminal
tools/ai/install.sh
```

Start from VS Code using **Kicad: 打开终端** (extension 0.4.3 or later), or open
`start.command` in macOS Terminal to inspect it in this repository. The latter
adds KiCad MCP to inherited JSON/JSONC configuration while preserving explicit
entries, other providers, and normal user/project runtime configuration.

Original branding delivery checks passed: 201 TUI tests, one skip, all 22 original CLI entries,
KiCad MCP connection, server health, and embedded Web UI plus its JavaScript
asset. The actual TUI `/status` dialog reported `kicad Connected`. No model
request or PCB mutation was used to validate the branding.

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
- In the command palette choose **优化提示词（当前模型，不发送）** to replace
  the current draft in place. The palette also offers **撤销提示词优化** and
  **取消提示词优化**. Errors and concurrent edits preserve the draft.
- `/tools` opens a searchable catalog from the server's actual MCP definitions.
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

`/kicad-health` checks the real MCP connection and separates native CLI, IPC,
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
