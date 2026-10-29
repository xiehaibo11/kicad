# 原生附件接收区 0.4.70

用户选择在 Kicad 面板内增加原生附件接收区，直接拖入文件，不要求 Shift。

## 实现

- 使用 VS Code 稳定公开 API `TreeView.dragAndDropController`，在 Kicad 面板新增「附件」区。
- 接收完整 Explorer 文件选择和公开 URI 列表，交给当前侧栏输入框；不自动发送、不创建模型请求。
- 图片与 PDF 读取为附件，其他文件与文件夹转换为路径引用，保留现有草稿。
- 路径队列等待输入框就绪，按批次确认，重挂载重试并抑制重复；只读历史保留队列并提示切换可编辑对话。
- 单文件 20 MiB、单批读取 40 MiB、最多 100 个待处理路径；不递归读取文件夹。

## 已验证

- `bash tools/ai/Kicad-extension/build.sh`：退出码 0，后端与前端类型检查、现有回归、新拖放回归和 VSIX 打包通过（见 build.log）。
- `test-composer-drop.mjs`：完整四图选择、VS Code 私有/公开 URI、CodeEditors、ResourceURLs、CodeFiles、中文与空格路径、普通文字和链接保留、图片字节、大小限制、部分失败、草稿与图片单独发送、无自动发送。
- `test-native-attachment-drop.mjs`：原生 TreeView 适配、完整选择、取消、就绪队列、重挂载、重复抑制、按序确认、只读历史、当前输入框作用域。
- 构建清单验证和打包后入口/依赖加载通过。
- VS Code 1.136.1 的真实扩展测试宿主记录了两次原生接收入口及图片字节读取，均无错误（见 host-result.json）；该入口也供点击文件选择器使用，日志不足以单独证明鼠标拖放来源。隔离窗口关闭后启动进程退出码为 1，日志记录扩展宿主退出码为 0；结果未包含 finished 标记，因此本轮仅作为入口和字节读取证据，不算完整宿主测试成功。
- 已安装实例中可见原生「附件」区、图片附件和保留的草稿（见 attachment-area.png）；测试使用本地生成的纯色图片，没有发送聊天消息。
- VS Code、Cursor 安装命令退出码均为 0；安装文件与 VSIX 全量比对一致（package.json 仅排除安装器附加 __metadata）。
- 用户原 VS Code 窗口已通过「开发人员: 重新加载窗口」重载；重载后无重启提示，AX 可见「附件」「将文件拖到这里添加到对话」及空草稿输入框。

## 验收限制

Cua 鼠标拖动多次未能稳定触发实际拖放，不能将自动鼠标端到端验收标记为通过。原生入口、附件读取和可见 UI 已验证，但仍需用户在原窗口直接拖入确认。Cursor 仅完成安装与文件校验，没有做窗口 UI 验收。此改动未公开发布或提交 Git。

## 安装包

- dist/kicad-0.4.70.vsix
- SHA-256: 37f2bb1aebeae323887b7101d131480ec4dc8e6ec07a4461da766129b75547cd

## 参考源码

- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/chat/browser/chatDragAndDrop.ts
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/dnd/browser/dnd.ts
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/api/browser/mainThreadWebviews.ts

原生聊天由 workbench 接收拖放；Webview 不能直接取得同等接收入口。本实现使用原生 TreeView 接收路径，再投递至聊天输入框，未修改 VS Code 或 Cursor 程序文件。
