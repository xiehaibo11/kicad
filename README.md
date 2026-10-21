# Kicad：AI 终端、VS Code 扩展与 KiCad 自动化

本项目在 KiCad 开源 EDA 软件基础上，增加 **Kicad AI 终端、Kicad VS Code 扩展和
`kicad-agent` 自动化后端**。可以用自然语言描述工程、原理图和 PCB 任务，由 AI 按需求调用
KiCad 工具，并查看执行记录、检查结果和需要用户决定的问题。

AI 工具的完整源码和构建文档位于
[`codex/kicad-npm` 分支](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm)。
默认分支首页同步展示本说明；下面的 AI 工具链接均指向该开发分支。

## 我们的工具

| 工具 | 用途 | 源码与文档 |
|---|---|---|
| **Kicad 终端** | 基于完整 OpenCode 运行时的 CLI/TUI，保留模型、认证、插件、会话、工具、服务端 API、Web 界面和原有子命令，接入 KiCad MCP 后端。 | [终端](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-terminal) · [npm 安装说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-terminal/npm/README.md) |
| **Kicad（VS Code）** | 基于 Claudix 的聊天扩展，提供模型与推理强度选择、权限模式、提示词优化、下一句建议、子代理运行看板和可展开的执行记录。 | [扩展](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-extension) |
| **`kicad-agent`** | Go 自动化后端，整合 KiCad IPC/NNG、`kicad-cli` 和 stdio MCP，供终端、扩展及其他 MCP 客户端调用。 | [后端](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/kicad-agent) · [工具集说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/README.md) |

## 安装 Kicad 终端

直接下载并启动完整终端：

```sh
npx --yes @-kicadai/kicad-code
```

或者全局安装，以后使用软件名称启动：

```sh
npm install -g @-kicadai/kicad-code
Kicad
```

启动名称支持全部大小写组合，包括 `Kicad`、`kicad`、`KICAD` 和 `KiCad`。
继续已有会话使用 `Kicad --continue`，查看命令使用 `Kicad --help`。

当前 npm 包支持 **macOS Apple Silicon（arm64）、Node.js 22 及以上版本**，随包分发完整
原生终端运行时、NNG MCP 后端、技能和插件。首次使用模型需要对应服务商认证；已有模型配置
和会话继续沿用。操作实际设计需要另行安装 KiCad；定制 API 功能需要本仓库相应源码构建的
KiCad 支持。

[npm 公开包](https://www.npmjs.com/package/@-kicadai/kicad-code) ·
[发行包与验收报告](https://github.com/xiehaibo11/kicad/releases/tag/kicad-code-v0.1.0)

## 在 VS Code 中使用

扩展面板显示名称为 **Kicad**，终端入口显示为 **Kicad 终端**，扩展 ID 为 `kicad-agent.kicad`。
从 [GitHub Release 下载扩展 0.4.22](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.22)
中的 `kicad-0.4.22.vsix`，在 VS Code 扩展菜单选择 **从 VSIX 安装…**，或者在下载目录执行：

```sh
code --install-extension ./kicad-0.4.22.vsix --force
```

需要 VS Code 1.98 或以上版本；当前验证平台为 macOS Apple Silicon。VSIX 包含聊天界面和
SDK/CLI，KiCad 软件、`kicad-agent` 后端及完整终端运行时需要单独安装。依赖、构建和安装步骤见
[扩展文档](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-extension/README.md)
和 [AI 工具集说明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/README.md)。

- 直接发送自然语言任务，按需求调用工具；新对话默认展示 Agent，用户选择的模型持续沿用。
- 推理强度通过输入框 UI 选择；终端通过 `/effort` 选择当前模型支持的档位。
- 魔杖使用当前选择的模型优化输入框文字，可撤销，不自动发送；下一句建议按 Tab 接受到草稿。
- 模型实际启动子代理后显示运行看板入口；工具执行过程默认折叠，点击查看详情。
- 支持暂停、编辑原消息后重新发送，继续沿用会话中的模型、推理强度和权限选择。

## KiCad 工具调用与设计检查

终端和扩展共用后端工具及任务规则，覆盖以下操作入口：

- 工程发现与切换、文档打开、原理图和 PCB 信息读取。
- 元件与封装库查询、原理图生成、放置、扇出、布线与制造文件导出。
- DRC/ERC、连通性、DFM 和结构检查；具体设计检查在后端执行。
- 公开网页资料搜索与读取，通过 `kicad_web` 等后端工具按任务调用。
- 可选 EDA Agent Connector，通过独立 MCP 适配器连接嘉立创EDA；需要相应 CLI、daemon 和连接器。

当前发布包的能力目录包含 **19 组 KiCad MCP 工具、247 个类型化动作**，详细清单由
`kicad-agent manifest` 输出。MCP 工具目录、原生动作索引和实际执行验证是不同层次；
IPC 动作是否可用取决于当前 KiCad 版本、编辑器和已注册的接口处理器。当前仍有部分 PCB
接口适配问题，某些会话会返回 `UNHANDLED`；工程和板级接口需要逐项验证。
设计结果以文档回读、DRC/ERC 及相应检查报告为准。

## 获取源码与构建

```sh
git clone --branch codex/kicad-npm https://github.com/xiehaibo11/kicad.git Kicad
cd Kicad
git submodule update --init --recursive
```

| 路径 | 内容 |
|---|---|
| [`tools/ai/Kicad-terminal`](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-terminal) | 终端品牌适配、构建与安装脚本 |
| [`tools/ai/Kicad-terminal/npm`](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-terminal/npm) | npm 包入口、打包与安装验收 |
| [`tools/ai/Kicad-extension`](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/Kicad-extension) | VS Code 聊天扩展适配与构建 |
| [`tools/ai/kicad-agent`](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/kicad-agent) | KiCad 自动化、MCP、IPC、CLI 和后端检查 |
| [`tools/ai/composer`](https://github.com/xiehaibo11/kicad/tree/codex/kicad-npm/tools/ai/composer) | 终端与扩展共用的交互逻辑和任务规则 |

完整依赖和构建命令见
[AI 工具集文档](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/README.md)。

## 开源来源与许可证

本项目为独立维护的 KiCad 二次开发，集成和适配了
[KiCad](https://gitlab.com/kicad/code/kicad)、
[OpenCode](https://github.com/anomalyco/opencode)、
[Claudix](https://github.com/Haleclipse/Claudix) 和
[easyeda-agent](https://github.com/zhoushoujianwork/easyeda-agent)。各组件保留原有版权、许可证和
来源记录，具体见仓库 [LICENSE](LICENSE)、各组件目录及 npm 包的
[第三方声明](https://github.com/xiehaibo11/kicad/blob/codex/kicad-npm/tools/ai/Kicad-terminal/npm/THIRD_PARTY_NOTICES.md)。

---

## KiCad 上游开发文档

For specific documentation about [building KiCad](https://dev-docs.kicad.org/en/build/), policies
and guidelines, and source code documentation see the
[Developer Documentation](https://dev-docs.kicad.org) website.

You may also take a look into the [Wiki](https://gitlab.com/kicad/code/kicad/-/wikis/home),
the [contribution guide](https://dev-docs.kicad.org/en/contribute/).

For general information about KiCad and information about contributing to the documentation and
libraries, see our [Website](https://kicad.org/) and our [Forum](https://forum.kicad.info/).

## Build state

KiCad uses a host of CI resources.

GitLab CI pipeline status can be viewed for Linux and Windows builds of the latest commits.

## Release status
[![latest released version(s)](https://repology.org/badge/latest-versions/kicad.svg)](https://repology.org/project/kicad/versions)
[![Release status](https://repology.org/badge/tiny-repos/kicad.svg)](https://repology.org/metapackage/kicad/versions)

## Files
* [AUTHORS.txt](AUTHORS.txt) - The authors, contributors, document writers and translators list
* [CMakeLists.txt](CMakeLists.txt) - Main CMAKE build tool script
* [copyright.h](copyright.h) - A very short copy of the GNU General Public License to be included in new source files
* [Doxyfile](Doxyfile) - Doxygen config file for KiCad
* [INSTALL.txt](INSTALL.txt) - The release (binary) installation instructions
* [uncrustify.cfg](uncrustify.cfg) - Uncrustify config file for uncrustify sources formatting tool
* [_clang-format](_clang-format) - clang config file for clang-format sources formatting tool

## Subdirectories

* [3d-viewer](3d-viewer)         - Sourcecode of the 3D viewer
* [bitmap2component](bitmap2component)  - Sourcecode of the bitmap to PCB artwork converter
* [cmake](cmake)      - Modules for the CMAKE build tool
* [common](common)            - Sourcecode of the common library
* [cvpcb](cvpcb)             - Sourcecode of the CvPCB tool
* [demos](demos)             - Some demo examples
* [doxygen](doxygen)     - Configuration for generating pretty doxygen manual of the codebase
* [eeschema](eeschema)          - Sourcecode of the schematic editor
* [gerbview](gerbview)          - Sourcecode of the gerber viewer
* [include](include)           - Interfaces to the common library
* [kicad](kicad)             - Sourcecode of the project manager
* [libs](libs)           - Sourcecode of KiCad utilities (geometry and others)
* [pagelayout_editor](pagelayout_editor) - Sourcecode of the pagelayout editor
* [patches](patches)           - Collection of patches for external dependencies
* [pcbnew](pcbnew)           - Sourcecode of the printed circuit board editor
* [plugins](plugins)           - Sourcecode for the 3D viewer plugins
* [qa](qa)                - Unit testing framework for KiCad
* [resources](resources)         - Packaging resources such as bitmaps and operating system specific files
    - [bitmaps_png](resources/bitmaps_png)       - Menu and program icons
    - [project_template](resources/project_template)          - Project template
* [thirdparty](thirdparty)           - Sourcecode of external libraries used in KiCad but not written by the KiCad team
* [tools](tools)             - Helpers for developing, testing and building
* [translation](translation) - Translation data files (managed through [Weblate](https://hosted.weblate.org/projects/kicad/master-source/) for most languages)
* [utils](utils)             - Small utils for KiCad, e.g. IDF, STEP, and OGL tools and converters
