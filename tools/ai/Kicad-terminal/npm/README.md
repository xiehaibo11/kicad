# Kicad

完整 Kicad AI 终端：保留 OpenCode 1.19.3 的模型、认证、插件、会话、工具、
服务端 API、内置 Web 界面与全部原生子命令，加入进程内共享的 KiCad 原生 IPC/CLI 工具、
PCB 审查工具、技能、提示词优化、下一句建议与任务上下文保留。

支持 **macOS Apple Silicon（arm64）和 Node.js 22+**。标准命令为 **`Kicad`**；macOS 默认的大小写不敏感文件系统也支持其他大小写组合，例如 **`Kicad`**、**`kicad`**、**`KICAD`** 和 **`KiCad`**。

## 安装与启动

直接从 npm 官方源启动（npm 会下载并缓存完整包，无需 npm 登录）：

```sh
npx --yes @-kicadai/kicad-code@latest
```

安装到全局，以后直接运行软件名：

```sh
npm install -g @-kicadai/kicad-code@latest
Kicad
# 以下写法启动相同的完整终端
kicad
KICAD
```

也可以在不全局安装的情况下传入参数：

```sh
npx --yes @-kicadai/kicad-code@latest --help
npx --yes @-kicadai/kicad-code@latest --continue
```

npm 官方包为 [`@-kicadai/kicad-code`](https://www.npmjs.com/package/@-kicadai/kicad-code)，
`latest` 可能落后于 GitHub 发行版；可用 `npm view @-kicadai/kicad-code version` 查询。
本次 0.2.3 可从 GitHub Release 的完整 tarball 启动：

```sh
npx --yes --package=https://github.com/xiehaibo11/kicad/releases/download/kicad-code-v0.2.3/-kicadai-kicad-code-0.2.3.tgz Kicad
```

校验报告与发行包见 [Release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-code-v0.2.3)。

`npx` 是下载、缓存并运行 npm 包的入口；全局安装后才会在 PATH 中长期提供
这些命令。包内携带原生运行时和完整后端，不要求 Bun、Python 或 Go。
安装时只运行包内的命令链接兼容脚本，提前建立规范命令链接，避免 npm 在
不区分大小写的文件系统上并行创建别名时冲突；不联网下载组件，也不覆盖其他软件的命令。
首次使用模型需要原有服务商认证；已有配置、模型选择、会话和环境变量继续沿用。

操作 PCB/原理图需要另外安装并运行 KiCad；包不会假装已连接 EDA 软件。
自动寻找 PATH 的 `kicad-cli` 和标准 macOS 安装位置，也可指定：

```sh
KICAD_CLI=/path/to/kicad-cli Kicad
```

工具由内置插件在进程内执行，不再启动 MCP 中转程序。已有配置、模型和本机 DeepSeek 凭证保留；安装包不含 API 密钥、聊天记录或 KiCad 工程。
定制 KiCad API 由相应源码构建的 KiCad 提供；标准 KiCad 不支持的动作会明确报错。

源码与许可证：https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-terminal
各开源组件保留原许可证，详见 THIRD_PARTY_NOTICES.md 与 licenses/。

## 0.2.3 共享策略与按需发现

工具、MCP 和技能使用 `capability_search` 查找相关元数据，再通过 `capability_call` 读取所选技能或执行所选工具。
启动时不预加载技能正文、不连接所有 MCP 服务器。`Kicad doctor prompt-audit` 直接输出本地审计 JSON。
设置与扩展 0.4.64 共用；子代理仍需要用户明确请求。内嵌 Web UI 与原有子命令保留。

## 0.2.1 KiCad 工具按需加载（历史版本）

会话开始时只带一个 `kicad_load` 工具和简短说明；消息涉及 KiCad/PCB/原理图等工作，或模型调用 `kicad_load` 后，
同一轮内即加载 20 个 KiCad 工具和完整指南，并在该会话中保持。普通对话不再每次携带 KiCad 工具定义。

## 0.2.0 工作台界面与自有更新

- 首页改为 KiCad 工作台：KiCad 连接状态（IPC、`kicad-cli`、打开的 PCB/原理图）与快捷任务；
  会话中的 KiCad 工具调用显示为结果卡片，侧栏显示 KiCad 面板、检查结论与产出文件；默认 KiCad 蓝橙主题。
  界面文字保持英文；原有模型、服务商、会话、权限和全部斜杠命令保留。
- 新增快捷任务斜杠命令 `/kicad-drc`、`/kicad-fab`、`/kicad-route`、`/kicad-step`、`/kicad-schematic`，
  以及不经模型的 `/kicad-health`。
- `Kicad --version` 输出 Kicad 版本（本包版本），运行时版本在 `/status` 中显示。
- 更新只走本包：终端内 `/update`，或命令行 `Kicad upgrade`（`--check` 仅检查）。全局 npm/pnpm/bun 安装
  由对应包管理器升级；通过 `npx` 启动时显示命令说明（重新执行 `npx --yes @-kicadai/kicad-code@latest`）。
  不再提示或安装 OpenCode 2.0。使用 npm 镜像时遵循 registry 配置，镜像缺少本包时回退 npmjs。
- `Kicad uninstall` 只移除本包，与 OpenCode 共用的配置和会话默认保留。

## 0.1.1 工程规范与验收更新

内置 20 个工程主题、86 条可追溯规则、21 个资料来源与全部 37 个 KiCad 示例索引。
终端根据普通自然语言设计任务自动调用 `reference.plan/get/examples`，无需输入斜杠。
新增 `release.snapshot/template/check`，按当前工程文件与证据的 SHA-256 检查投板、投产资料完整性。
任务进度不能替代审查证据；软件检查也不能代替实物验证和责任工程师的最终放行。

当前后端目录：333 个类型化动作、20 组进程内工具、971 个原生 GUI 工具索引。
这些数量表示可发现入口，不表示每个动作都已在实板上逐项验证。
包内含共享 JavaScript 工具、8 个技能及 `kicad-engineering` 的完整辅助参考文件。

更新已有安装：

```sh
npm install -g @-kicadai/kicad-code@latest
```

配合 VS Code 扩展 0.4.29 使用时，两端均携带共享的 JavaScript 工具模块。
扩展无需配置 Go 可执行文件；`kicadAgent.kicadCli` 可指定原生 `kicad-cli`，
`kicadAgent.socket` 可指定 KiCad 内部 API 的 Unix socket。

## 从源码构建

在主仓库执行原生终端构建，并构建共享 JavaScript 原生封装：

```sh
git submodule update --init --recursive
bash tools/ai/Kicad-terminal/build.sh
node tools/ai/direct/build.mjs
KICAD_TERMINAL_SOURCE="$PWD/tools/ai/Kicad-terminal/cache/Kicad" \
  npm --prefix tools/ai/Kicad-terminal/npm run build
cd tools/ai/Kicad-terminal/npm
npm ci
npm test
npm pack
```

工具模块使用 Node.js 22+ 与 Bun 构建，不依赖 Go 或独立 NNG 库。
KiCad 内部 API 的 NNG 协议由 JavaScript 直接与原生 C++ 进程通信。
打包时逐文件验证 SHA-256；本地构建与 npm 已发布包的状态分别记录在验收报告中。

KiCad 工具在终端进程内调用共享 JavaScript，通过原生 IPC/CLI 工作，不启动外部 EDA 或 Go daemon。
