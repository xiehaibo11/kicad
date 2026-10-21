# Kicad

完整 Kicad AI 终端：保留 OpenCode 1.19.3 的模型、认证、插件、会话、工具、
服务端 API、内置 Web 界面与全部原生子命令，加入完整 NNG IPC KiCad MCP 后端、
PCB 审查工具、技能、提示词优化、下一句建议与任务上下文保留。

支持 **macOS Apple Silicon（arm64）和 Node.js 22+**。软件命令是 **`Kicad`**。

## 安装与启动

直接从 npm 官方源启动（npm 会下载并缓存完整包，无需 npm 登录）：

```sh
npx --yes @haiboxie11/kicad@0.1.0
```

安装到全局，以后直接运行软件名：

```sh
npm install -g @haiboxie11/kicad@0.1.0
Kicad
```

也可以在不全局安装的情况下传入参数：

```sh
npx --yes @haiboxie11/kicad@0.1.0 --help
npx --yes @haiboxie11/kicad@0.1.0 --continue
```

npm 官方源已公开发布 [`@haiboxie11/kicad`](https://www.npmjs.com/package/@haiboxie11/kicad)，
当前版本为 `0.1.0`，可省略版本号获取 `latest`。
也可以使用内容相同的 GitHub npm tarball：

```sh
npx --yes --package=https://github.com/xiehaibo11/kicad/releases/download/kicad-terminal-v0.1.0/haiboxie11-kicad-0.1.0.tgz Kicad
```

校验报告与发行包见 [Release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-terminal-v0.1.0)。

`npx` 是下载、缓存并运行 npm 包的入口；全局安装后才会在 PATH 中长期提供
`Kicad`。包内携带原生运行时和完整后端，没有安装脚本，不要求 Bun、Python 或 Go。
首次使用模型需要原有服务商认证；已有配置、模型选择、会话和环境变量继续沿用。

操作 PCB/原理图需要另外安装并运行 KiCad；包不会假装已连接 EDA 软件。
自动寻找 PATH 的 `kicad-cli` 和标准 macOS 安装位置，也可指定：

```sh
KICAD_CLI=/path/to/kicad-cli Kicad
```

`KICAD_AGENT` 可覆盖内置 MCP 后端。已有 `OPENCODE_CONFIG_CONTENT` JSON/JSONC
配置合并保留，显式同名 MCP/提供商优先；本机 DeepSeek 凭证和可选 easyeda
连接器继续使用。安装包不含 API 密钥、用户配置、聊天记录或 KiCad 工程。
定制 KiCad API 由相应源码构建的 KiCad 提供；标准 KiCad 不支持的动作会明确报错。

源码与许可证：https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-terminal
各开源组件保留原许可证，详见 THIRD_PARTY_NOTICES.md 与 licenses/。

## 从源码构建

在主仓库执行原生终端构建，并构建含 NNG 的后端：

```sh
git submodule update --init --recursive
bash tools/ai/Kicad-terminal/build.sh
make -C tools/ai/kicad-agent build-ipc
KICAD_AGENT_BINARY="$PWD/tools/ai/kicad-agent/bin/kicad-agent" \
  KICAD_TERMINAL_SOURCE="$PWD/tools/ai/Kicad-terminal/cache/Kicad" \
  npm --prefix tools/ai/Kicad-terminal/npm run build
cd tools/ai/Kicad-terminal/npm
npm ci
npm test
npm pack
```

后端构建需 Go 1.26.3 和 NNG 1.12.4（默认 `$HOME/kicad-deps/nng-install`，
可设 `NNG_PREFIX`）；许可证来源默认 `$HOME/kicad-deps/nng-1.12.4`，可设
`NNG_SOURCE`。打包时逐文件验证 SHA-256 和完整 NNG 构建标签。
