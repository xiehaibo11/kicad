# Kicad AI 工具

项目根目录：`Kicad`。主要产品入口：

- **Kicad**：`tools/ai/Kicad-extension`，VS Code 聊天、提示词优化与下一句建议。
- **Kicad 终端**：`tools/ai/Kicad-terminal`，保留完整 OpenCode 运行时，执行 `Kicad` 启动。
- 扩展开源基线：`tools/ai/upstream/Kicad-extension`，固定 Claudix 版本，保留原始许可证与来源。
- `vscode-extension` 是原有动作工具扩展；主聊天扩展请使用上面的 `Kicad-extension`。

下一句建议只在空输入框显示灰色文字，按 **Tab** 回填草稿，随后手动发送。

**自动调用工具，无需输入 `/`**：终端与扩展都常驻加载
[`composer/eda-agent-instructions.md`](composer/eda-agent-instructions.md)，把“检查 KiCad 环境”
“跑 DRC”“BGA 扇出”“生成制造文件”等自然语言请求直接映射到 MCP 工具；`.claude/skills/kicad-*`
技能按描述自动触发（Claude Code 与 OpenCode 都读取 `~/.claude/skills`），`/kicad-*` 命令仅保留为别名。

**EDA Agent Connector**：上游开源 [easyeda-agent](upstream/easyeda-agent) 的 stdio MCP 适配器由
[`composer/build-easyeda-mcp.sh`](composer/build-easyeda-mcp.sh) 打包为单文件 `easyeda-mcp.mjs`，
随终端安装到 `~/.local/share/kicad-terminal/`、随 VSIX 放在 `resources/kicad/`，并以 `easyeda`
MCP 服务器与 `kicad` 并列注册（终端、扩展聊天、仓库 `.mcp.json`）。嘉立创EDA专业版或 daemon
未运行时 `easyeda_health` 会明确报告未连接，KiCad 工具不受影响。
构建完成后运行 `bash tools/ai/install.sh` 安装扩展与终端。
仅安装已构建的终端：`bash tools/ai/Kicad-terminal/install.sh`；安装后执行
`Kicad`，查看帮助用 `Kicad --help`。旧命令 `kicad` 保持兼容。

macOS Apple Silicon / Node.js 22+ 可直接使用 npm 官方源的完整安装包：

```sh
npx --yes @-kicadai/kicad-code
# 或全局安装后使用软件名启动
npm install -g @-kicadai/kicad-code
Kicad
```

完整原生运行时、NNG IPC 后端、技能和插件一起分发；操作 PCB 时需要本机 KiCad。
npm 官方包为 [`@-kicadai/kicad-code`](https://www.npmjs.com/package/@-kicadai/kicad-code)，
启动命令支持 `Kicad`、`kicad`、`KICAD` 等大小写组合；内容相同的 GitHub tarball 和校验报告见
[Release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-code-v0.1.1)。
打包、测试与开源组件说明见 [npm 分发](Kicad-terminal/npm/README.md)。

KiCad API 服务默认开启，外部 EDA 工具在 `kicad-agent ai` 中默认允许调用；
可用 `--allow-external=false` 显式关闭。当前接入包括 254 个类型化动作、
20 组 KiCad MCP 工具和 971 个原生工具索引。原生动作提交后的返回值包含
`completionVerified=false`，实际完成情况应通过文档回读、DRC/ERC 或界面验证。

工程管理器支持 **File → Open Project Folder...**，可从总目录列出并选择子目录中的工程。
终端和扩展也可直接说“列出这个目录里的 KiCad 工程”“切换到某个完整工程路径”；
底层对应 `project.list`、`project.resolve`、`project.switch`。重新选择当前工程会保留已打开的编辑器。
本轮具体进度及验收证据见根目录 `KiCad接入进度与验收报告.txt`。

# KiCad AI automation (`tools/ai`)

This directory integrates the open-source
[`easyeda-agent`](https://github.com/zhoushoujianwork/easyeda-agent) (MIT) into
KiCad as an AI-callable automation layer.  The upstream is pinned as a git
submodule:

```bash
git submodule update --init tools/ai/upstream/easyeda-agent
```

## What is reused, what is replaced

The upstream consists of a Go CLI, a local daemon, a WebSocket connector that
runs inside EasyEDA Pro, and an MCP adapter.  Its transport and roughly 160
action call sites are EasyEDA-specific, so they cannot drive KiCad.

| Upstream component | In KiCad |
|---|---|
| EasyEDA daemon + connector | **Replaced** by KiCad protobuf API over NNG and `kicad-cli` |
| Typed action catalog / audit / `apply` pattern | **Kept** as the design pattern |
| `internal/spec` (S0 spec schema + validation) | **Reused directly** |
| `internal/blocks` (37 circuit blocks) | **Reused directly** |
| `internal/connectivity`, `internal/schguard`, PCB check/autoplace algorithms | **Reusable reference**; not yet wired into KiCad |
| EasyEDA workflow state | **Replaced** by a KiCad-native stage machine |

The Go module is intentionally nested under the upstream module path
(`github.com/zhoushoujianwork/easyeda-agent/kicad-agent`) with a `replace`
directive, so it can import upstream `internal/` packages without copying them.

## Build

```bash
# CLI only (no IPC dependency)
cd tools/ai/kicad-agent && make build

# With KiCad IPC (NNG 1.x)
make build-ipc NNG_PREFIX=$HOME/kicad-deps/nng-install
```

Or integrate into the KiCad build:

```bash
cmake -S . -B build -DKICAD_BUILD_AI_AGENT=ON
# optional IPC:
#   -DKICAD_BUILD_AI_AGENT=ON -DKICAD_BUILD_AI_AGENT_IPC=ON
ninja -C build kicad-agent
```

## Terminal usage

```bash
kicad-agent health
kicad-agent actions --domain board
kicad-agent call board.drc.run --payload '{"input":"board.kicad_pcb","output":"drc.json","format":"json","timeoutMs":60000}'
kicad-agent pipeline run --spec design.spec.json --project ./my-project
```

Every command emits exactly one JSON envelope on stdout; logs go to stderr.
Exit codes: `0` success, `1` action failure, `5` rule violations, `8` timeout,
`9` cancelled.

The same tool surface is reachable through KiCad's own CLI:

```bash
kicad-cli agent health
kicad-cli agent actions --domain board
kicad-cli agent sch generate --spec circuit.json --project ./my-project --new
```

For a build-tree run, point the wrapper at the Go binary:
`export KICAD_AGENT=/path/to/build/bin/kicad-agent`.  An installed build places
`kicad-agent` next to `kicad-cli`, so no variable is needed.

## Automatic schematic generation

```bash
kicad-agent sch search --library Device --query resistor --limit 10
kicad-agent sch generate --spec circuit.json --project ./my-project --new
```

`circuit.json`:

```json
{
  "components": [
    {"reference":"R1","libId":"Device:R","value":"10k","position":{"xMm":50,"yMm":50}},
    {"reference":"R2","libId":"Device:R","value":"10k","position":{"xMm":70,"yMm":50}}
  ],
  "nets": [
    {"name":"NET_A","pins":["R1.1","R2.1"]},
    {"name":"NET_B","pins":["R1.2","R2.2"]}
  ],
  "annotate": true
}
```

The generator snaps positions to the 1.27 mm grid, places symbols from the
library, reads absolute pin positions, places a local label with the net name at
each pin, annotates, saves, and runs ERC.  The last verified run produced
`/NET_A` and `/NET_B` nets with zero ERC violations.

## LLM integration (`settings.json`)

Copy [settings.example.json](kicad-agent/settings.example.json) to
`~/.config/kicad-agent/settings.json` and export the provider's key:

```bash
export DEEPSEEK_API_KEY=...
kicad-agent ai --settings ~/.config/kicad-agent/settings.json \
  --prompt "Generate the schematic in ./my-project from circuit.json and report ERC"
```

Providers: OpenAI, Anthropic, DeepSeek, Qwen (DashScope compatible mode), and
Ollama.  Keys are read from the environment variable named by `apiKeyEnv`; they
are never stored in the file.  The agent uses a provider-agnostic JSON tool
loop: one action per turn, results fed back, bounded by `--max-steps`.

## MCP registration

`kicad-agent mcp` runs a stdio MCP server.  Register it in Claude Code,
Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "kicad": {
      "command": "/absolute/path/to/kicad-agent",
      "args": ["mcp"],
      "env": {
        "KICAD_CLI": "/absolute/path/to/kicad-cli",
        "KICAD_API_SOCKET": "/tmp/kicad/api.sock"
      }
    }
  }
}
```

Tools exposed: `kicad_health`, `kicad_actions`, `kicad_call`,
`kicad_spec_validate`, `kicad_blocks`, `kicad_workflow`, `kicad_pipeline`, and
one domain tool per safe domain (`kicad_board`, `kicad_schematic`,
`kicad_project`, `kicad_document`, `kicad_library`, `kicad_external`,
`kicad_system`).

## Routing quality

```bash
# Multi-layer obstacle-aware A* router.  Default layers are F.Cu and B.Cu;
# pass --layers F.Cu,In1.Cu,B.Cu to allow inner layers.  Pads, tracks, vias,
# board edges, footprint Edge.Cuts cutouts, and rule areas are obstacles.
kicad-agent route autoroute --document board.kicad_pcb --planner grid \
    --layers F.Cu,B.Cu --grid-mm 0.25 --clearance-mm 0.2 \
    --via-drill-mm 0.3 --via-diameter-mm 0.6 --apply

# Coupled differential pair.  The router checks every planned segment against
# other-net tracks and pad boxes; a pair that would short is refused with a
# reason instead of creating copper.
kicad-agent route diff-pair --document board.kicad_pcb \
    --pairs '[{"p_start":"R1.1","p_end":"R2.1","n_start":"R1.2","n_end":"R2.2"}]' \
    --width-mm 0.2 --gap-mm 0.2 --apply

# Serpentine length tuning.  The planned length is verified before any copper is
# created, and the original straight segment is deleted only after all new
# segments were created; the final length is re-measured.
kicad-agent route tune --document board.kicad_pcb --net DDR_DQ0 --target-mm 42.5 --apply
```

The L-router baseline also checks both L directions against other-net tracks
and pad boxes and picks the unblocked one.  Already-connected nets are skipped.

All routing commands are dry-run by default.  These are deterministic routers,
not a commercial autorouter; run `board.drc.run` and
`board.connectivity.prove` after applying.

## Exact STEP collision check

`kicad-stepcheck` (built next to `kicad-agent` when OpenCASCADE is available)
reads a STEP file and computes pairwise boolean intersections between its
solids.  Unlike AABB checks, it reports the actual overlap volume, so touching
faces (board and component bodies) are not false positives.

```bash
kicad-stepcheck board.step
# exit 0 = clean, 5 = collisions, 1 = evaluation error, 2 = bad input

kicad-agent structural check --document board.kicad_pcb --exact-step
kicad-agent call external.step.meshcheck --payload '{"input":"board.step"}'
```

The report includes component names from the STEP XCAF labels when present.
Set `KICAD_STEPCHECK` if the checker is installed elsewhere.

## Headless server and job control

```bash
# Attach to the current server, or start a detached kicad-cli api-server.
kicad-agent call project.open --payload '{"document":"/abs/board.kicad_pcb"}'
# -> {"socket": "...", "pid": 1234, "spawned": true}

# API export jobs return a job id.
kicad-agent call board.jobs.svg --payload '{"document":{...},"output":"out.svg"}'
kicad-agent call job.status --payload '{"jobId":"..."}'
kicad-agent call job.cancel --payload '{"jobId":"..."}'

# Every non-interactive kicad-cli command is available through one action.
kicad-agent cli pcb export step board.kicad_pcb -o board.step
kicad-agent call kicad.cli.run --payload '{"args":["pcb","export","step","board.kicad_pcb"]}'
```

`GetCapabilities` now filters the advertised list against the handlers that
are actually registered in the current API session.

## Install everything

```bash
tools/ai/install.sh
```

This writes `kicad-agent` / `kicad-cli` wrappers to `~/.local/bin`, installs the
Claude skill and slash commands under `~/.claude/`, and installs the VS Code
extension when `code` and a packaged VSIX are present.

## Install the VS Code extension

```bash
cd tools/ai/vscode-extension
npm install && npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension kicad-agent-vscode-0.1.0.vsix
```

The extension contributes a KiCad activity-bar view, DRC/ERC diagnostics, and
commands for schematic generation, routing, fanout, DFM, impedance, and exact
STEP checks.  It also provides **KiCad: Start API Server for Active Document**
and **KiCad: Stop API Server**, so IPC-backed actions work without a separate
terminal.  Set `kicadAgent.path`, `kicadAgent.kicadCli`, and optionally
`kicadAgent.symbolDir` / `kicadAgent.footprintDir` in settings.

## Agent integrations

- **MCP**: `kicad-agent mcp` (stdio JSON-RPC); `.mcp.json` at the repository
  root registers it for Claude Code.
- **Skill**: `.claude/skills/kicad-agent/SKILL.md` (source under
  `tools/ai/skills/kicad/`).
- **Slash commands**: `.claude/commands/kicad-check.md`, `kicad-drc.md`,
  `kicad-schematic.md`, `kicad-route.md`, `kicad-fab.md`, `kicad-step.md`.
- **Context compression**: `kicad-agent ai --max-context-bytes N` bounds the
  conversation before each model call.  When the budget is exceeded, the oldest
  turns are summarized into a compact note — falling back to lossy trimming if
  summarization fails — while the system prompt and original task are preserved.

## Design pipeline

`kicad-agent pipeline run` executes these stages and writes
`.kicad-agent/pipeline-report.json`:

| Stage | Action | Status |
|---|---|---|
| spec | `spec.validate` | implemented |
| health | `system.health` | implemented |
| schematic | `schematic.erc.run` (existing `.kicad_sch`) | implemented; generate a schematic first with `kicad-agent sch generate` |
| netlist | `schematic.export.netlist` | implemented |
| board | `board.netlist.import` | implemented (IPC) |
| place | `board.place.autoplace` | implemented (AR_AUTOPLACER) |
| planes | `board.plane.create` / `board.plane.verify` | implemented (net-bound zones on inner layers, driven by `stackup.innerLayers`) |
| fanout | `board.fanout.run` | implemented (via-in-pad / dog-bone; pass `--fanout-reference`) |
| route | `board.route.autoroute` | implemented (deterministic L-router; DRC validates; dry-run by default) |
| save | `document.save` | implemented (persists API edits before CLI jobs) |
| drc | `board.drc.run` | implemented, with timeout |
| connectivity | `board.connectivity.prove` | implemented (IPC) |
| manufacturing | Gerber/drill/position/STEP | implemented |
| verify | summary | implemented |

Stages that cannot run are reported as `unimplemented` with remediation; they
are never silently skipped.

## Additional PCB capabilities

```bash
kicad-agent fanout run --document board.kicad_pcb --reference U1 --style via-in-pad
kicad-agent dfm analyze --document board.kicad_pcb --min-width-mm 0.15
kicad-agent dfm fix --document board.kicad_pcb --min-width-mm 0.15
kicad-agent impedance calculate --document board.kicad_pcb --layer F.Cu --target 50
kicad-agent impedance check --document board.kicad_pcb --layer F.Cu --target 50
kicad-agent route autoroute --document board.kicad_pcb --nets DDR_DQ0 --apply
kicad-agent route diff-pair --document board.kicad_pcb --pairs '[{"p_start":"U1.1","p_end":"U2.1","n_start":"U1.2","n_end":"U2.2"}]' --apply
kicad-agent route length --document board.kicad_pcb --net DDR_DQ0 --target-mm 25
kicad-agent structural check --document board.kicad_pcb --heights heights.json --export-step
```

Limitations (intentional and reported, not hidden):

- **Fanout**: first-pass via-in-pad / dog-bone only. No escape search, layer
  assignment, or current-capacity planning.
- **Autoroute**: deterministic L-router; it does not shove, rip up, or search
  around obstacles. Always follow with `board.drc.run` and
  `board.connectivity.prove`.
- **Differential pair**: two parallel L paths with the requested gap; no coupled
  length tuning.
- **Length**: report-only; no meander insertion yet.
- **DFM fix**: track width and 0/45/90/135/180-degree angle snapping only; no
  pad/footprint moves.
- **Impedance**: IPC-2141 closed-form guidance; final values need the
  fabricator's field solver.
- **Structural**: 2.5D footprint bounding boxes + optional heights, plus STEP
  export. Exact mesh collision still requires an external tool
  (`external.step.check`).

## KiCad API prerequisites

For IPC actions, start a headless API server:

```bash
kicad-cli api-server /path/to/project --socket /tmp/kicad/api.sock
```

The server is also started by the GUI when **Enable API server** is on.

## Generated protobuf bindings

`proto/gen.sh` copies `api/proto`, injects `go_package` options, and generates
one Go package `internal/kicadproto` for `common/**` + `board/**`, plus
`internal/kicadproto/schematic` (`kschematic`).

The split is required because KiCad's proto packages contain a cycle
(`common/types` ↔ `board` ↔ `common/commands`) that Go forbids.  The checked-in
proto files are not modified.

After changing `api/proto`, run:

```bash
tools/ai/kicad-agent/proto/gen.sh
```

## External tools

`kicad-agent external tools` reports availability.  Supported integrations:

- **Freerouting** (`external.freerouting.run`) — DSN/SES autorouting.
- **ngspice** (`external.ngspice.run`) — batch SPICE simulation.
- **FreeCAD / OpenSCAD / scripts** (`external.step.check`) — mechanical checks.
- **Generic allowlisted commands** (`external.command.run`).

## AI agent security

`kicad-agent ai` enforces an action policy outside the model prompt:

- mutating actions are allowed unless `--read-only` is passed;
- external EDA tools are allowed by default; `--allow-external=false` disables
  execution while keeping `external.tools.list` available;
- `--allowed-actions a,b,c` restricts the model to an explicit allowlist;
- tool results are wrapped as untrusted data and secret-looking values are
  redacted before they reach the model;
- external child processes receive a filtered environment, so API keys in the
  parent process cannot be read by a project file.

## Licensing

The `easyeda-agent` submodule is MIT and NNG (used by the IPC build) is MIT.
Those components are linked with KiCad's GPLv3 protobuf API and libraries, so
the combined `kicad-agent` binary and the `kicad-cli agent` subcommand are
distributed under the GNU General Public License, version 3 or later.  See
`LICENSE` and `NOTICE` in this directory.  The KiCad application itself
remains GPLv3.

### Engineering reference service and evidence gates

For relevant design/review/manufacturing tasks, the terminal, extension and native
AI loop automatically use `reference.plan` and load relevant `reference.get` cards.
No slash command is required. `reference.search` supports Chinese/English topics;
`reference.examples` indexes every local `demos/**/*.kicad_pro`, with optional
indexed file hashes. `PCB板设计规范.md` is the human-readable Chinese handbook.
The backend embeds 20 topic cards, 86 engineering policy rules, 21 source records
and 37 original project references (version 2026-10-20.1). `system.manifest` exposes
actual installed counts and a content digest; counts are not proof that examples
have been electrically reviewed. Refresh the example index after updating demos
with `python3 tools/ai/kicad-agent/scripts/update-engineering-examples.py`.

MCP exposes `kicad_reference`; `kicad_audit` also serves `release.snapshot`,
`release.template` and `release.check`. The check performs a fresh native audit,
hashes the local design graph and validates revision-bound artifact completeness.
See `.claude/skills/kicad-engineering/references/release-evidence.md` for its schema.
Manufacturing profiles require ordered-process provenance, not generic defaults.
Fabrication and production evidence are separate. Report authenticity, signatories,
physical qualification and actual release remain the accountable external process:
`readyForFabrication`/`readyForProduction` are intentionally false. Workflow flags
are task tracking only; pending stages cannot be skipped and `verified` cannot be
set by a confirmation boolean. Do not use templates or zero DRC as release approval.

`tools/ai/install.sh` installs the engineering skill and its references to both
`~/.claude/skills/kicad-engineering` and `~/.codex/skills/kicad-engineering` with
implicit invocation enabled. Rebuild the extension/terminal after changing their
shared instructions, then run the installer and `tools/ai/verify-install.py`.
