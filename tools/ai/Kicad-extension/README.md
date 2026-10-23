# Kicad for VS Code

在编辑器中通过自然语言使用 AI，检查 KiCad 工程、分析原理图与 PCB，并执行设计任务。

- **多模型支持**：使用 Claude、Codex、DeepSeek 或自定义兼容模型。
- **KiCad 工具**：检查工程、读取设计、运行 DRC / ERC、编辑设计和导出制造文件。
- **编辑器集成**：结合当前文件与选择内容处理任务；点击图片、工具输入和输出，在编辑器中查看完整内容。
- **按需调用**：根据任务逐步调用工具，按需加载 MCP 与技能，也可复用已安装的 Codex、Claude 插件中的独立 MCP 配置。
- **电脑操控**：通过独立开关启用 Cua Driver 后台服务，在授权的应用中操作窗口、鼠标和键盘。
- **权限控制**：支持自动与只读模式；子代理仅在用户明确要求且设置允许时启动。

## 开始使用

1. 从 [GitHub Releases](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.67) 下载 VSIX，在 VS Code 中选择 **从 VSIX 安装…**。
2. 打开工程和 **Kicad** 面板，在设置中配置模型。
3. 直接描述任务，例如“检查这个工程”或“运行 PCB DRC”。斜杠命令可选。

## 使用终端

安装 Kicad 终端后，运行命令 **Kicad: 打开终端**，即可在 VS Code 集成终端中使用。

## 环境要求

- VS Code 1.98 或更高版本，以及 Node.js 22 或更高版本。
- 已安装 KiCad；操作当前设计时需启用 KiCad IPC。
- 可用的模型账户或 API 配置。
- 当前验证平台为 macOS Apple Silicon。电脑操控需另装 Cua Driver，并授予辅助功能和屏幕录制权限。

## 文档

- [安装与配置](https://github.com/xiehaibo11/kicad/blob/kicad-extension-v0.4.67/tools/ai/README.md)
- [终端使用](https://github.com/xiehaibo11/kicad/blob/kicad-extension-v0.4.67/tools/ai/Kicad-terminal/npm/README.md)
- [问题反馈](https://github.com/xiehaibo11/kicad/issues)
