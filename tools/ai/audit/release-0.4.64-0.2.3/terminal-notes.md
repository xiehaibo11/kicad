Kicad Code 0.2.3 与扩展 0.4.64 同步共享工具和策略代码，包含完整 macOS Apple Silicon 终端、内嵌 Web UI、进程内 KiCad JavaScript 后端和 8 个技能。

- 使用 capability_search 查找相关元数据，再由 capability_call 加载所选技能或执行工具；启动时不预加载全部技能、不连接全部 MCP 服务器。
- 共享模型禁用、推理上限、Auto 策略和静态提示词审计。子代理继续要求用户明确请求。
- `Kicad doctor prompt-audit` 直接输出本地 JSON；保留既有模型、权限和会话配置。

要求 macOS arm64、Node.js 22+。从本页完整归档直接启动：

```sh
npx --yes --package=https://github.com/xiehaibo11/kicad/releases/download/kicad-code-v0.2.3/-kicadai-kicad-code-0.2.3.tgz Kicad
```

或全局安装归档，再运行 Kicad：

```sh
npm install -g https://github.com/xiehaibo11/kicad/releases/download/kicad-code-v0.2.3/-kicadai-kicad-code-0.2.3.tgz
Kicad
```

本次构建与安装验证通过；终端类型检查通过，TUI 212 项通过、1 项跳过，KiCad 运行时测试 11 项通过，npm 启动器 4 项通过。完整包经过空缓存启动、隔离全局安装、重复安装、配置保留、技能按需读取和内嵌 Web 检查。模型凭证、KiCad 软件和原生 CLI 需另行配置。

0.2.3 发布到 GitHub Releases；本机 npm 发布未登录，因此没有同步 npm registry 的 latest。请使用上方 GitHub 归档获取本版本。

包版本为 0.2.3，底层 OpenCode 运行时基线为 1.19.3；见 build-manifest.json、verification.json、local-acceptance.json 与 SHA256SUMS。软件测试不代表真实电路板验收。
