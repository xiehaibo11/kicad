Kicad 扩展 0.4.64 纳入最新设置页面，并恢复各模型通用的 `/` 菜单。原来 Claude SDK 返回空命令清单时会显示 “No matches”；现在本地核心命令与服务商发现结果独立。

- Skills、Slash Commands、Hooks、Plugins 展示实际本地清单；技能开关、MCP 来源同步和过期权限清理使用配置回读。
- 工具与技能按需发现；浏览菜单和设置不会调用模型、加载技能正文或启动 MCP 服务器。
- 保留渐进式执行记录、原生编辑器图片预览、可点击 IN/OUT 和复制操作。
- 共享设置支持模型禁用、推理上限、Auto 策略与静态提示词审计。子代理仍需要当前用户明确请求。

下载本页 `kicad-0.4.64.vsix`，在 VS Code 或 Cursor 中选择“从 VSIX 安装”，或运行：

```sh
code --install-extension ./kicad-0.4.64.vsix --force
```

完成当前任务后再重新加载编辑器窗口。要求 VS Code 1.98+；本次验证平台为 macOS Apple Silicon。完整终端另见 [Kicad Code 0.2.3](https://github.com/xiehaibo11/kicad/releases/tag/kicad-code-v0.2.3)。模型凭证与 KiCad 软件另行配置。

验证包括 TypeScript/Vue 检查、构建回归、真实 VS Code 扩展宿主、设置页面、Claude/DeepSeek/Codex/自定义兼容模型的斜杠菜单，以及执行记录和图片 UI。共享 composer 55 项通过，后端 64 项通过、6 项实时 IPC 跳过；本地模型响应夹具不代表所有提供商的真实推理验收。见 verification.json 与 SHA256SUMS。

此发布渠道为 GitHub Releases；没有发布到 VS Code Marketplace。
