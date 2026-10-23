# Claude Code 运行机制、子代理与编排深度分析（第二轮）

日期：2026-10-22 · 对象：`pengchengneo/Claude-Code`、`renepardon/claude-code`
落地版本：Kicad 扩展 0.4.56（`tools/ai/Kicad-extension`）、共享层 `tools/ai/composer`

## 0. 来源与边界

- 两个仓库内容基本相同：都是从 `@anthropic-ai/claude-code` npm 包的 source map 还原出的
  TypeScript 源码（约 1,900 个文件）。`pengchengneo` 另加约 100 个 shim/stub，可以本地运行；
  `renepardon` 是平铺的备份。两者都没有开源许可证，版权归原作者。
- 本轮只把它们当作架构参考：阅读机制，在本仓库里独立实现。没有复制任何源码或提示词原文；
  克隆在 `/tmp/cc-research`，未执行其中的代码。
- 结论都已用本机 Claude Code 2.1.305 / Codex 0.163.0 加本地 HTTP 夹具实测（见第 9 节）。

## 1. 主循环（`query.ts` / `QueryEngine.ts`）

每一轮按固定顺序执行：

1. 上下文治理：snip（裁剪历史）→ microcompact（把较早、可压缩工具的结果替换成
   “已清除”占位，只保留最近 N 个）→ autocompact（距上下文上限 13k token 时整段摘要；
   20k 时警告）→ 可选的 context collapse。
2. 调用模型（流式）。超出输出上限时最多自动续写 3 次；提示过长时走 reactive compact
   再重试；主模型过载时切到 fallback 模型并剥离不兼容的思考块。
3. 工具执行：`StreamingToolExecutor` 边流式边启动工具；`runTools` 把同一条回复里的
   tool_use 切成连续批次——`isConcurrencySafe()` 为真的（只读）批次并发执行（默认上限 10），
   其余串行；工具可以返回 context modifier，批次结束后按顺序生效。
4. 结束判定：stop hooks、`maxTurns`、token budget（可自动续跑）。

要点：**并发、延迟加载、压缩都由运行时决定，不靠提示词告诉模型“一次只调一个工具”**。

## 2. 工具系统与 MCP

- `Tool` 接口包含 `isReadOnly`、`isConcurrencySafe`、`isDestructive`、`checkPermissions`、
  `maxResultSizeChars`、`shouldDefer`/`alwaysLoad`、`searchHint`。工具池按名称稳定排序，
  保证提示缓存命中。
- MCP 工具映射（`services/mcp/client.ts`）：
  - `annotations.readOnlyHint` → 只读且可并发；`destructiveHint`、`openWorldHint` 原样映射。
  - `_meta['anthropic/alwaysLoad']` → 永不延迟加载；`_meta['anthropic/searchHint']` → 搜索提示。
  - 工具描述和服务器 instructions 截断到 2048 字符；超大结果落盘并返回读取指引。
  - 本地服务器每批连接 3 个、远程另有批量上限；支持 `tools/list_changed` 刷新、OAuth、
    elicitation；配置分 local/project/user/enterprise/managed/dynamic 多级，项目级
    `.mcp.json` 需要批准。
- 延迟加载（ToolSearch，`utils/toolSearch.ts`）：默认所有 MCP 工具只发名字，模型必须先调
  ToolSearch 取 schema；`ANTHROPIC_BASE_URL` 不是官方地址时（例如 DeepSeek）默认关闭；
  部分小模型不支持 `tool_reference` 时也关闭。

**对我们的影响（已实测）**：Claude 官方模型下，KiCad 的 `capability_search` /
`capability_call` 原本也被延迟——首个请求里根本没有这两个工具，模型要先 ToolSearch
才能开始搜索 KiCad 能力，白白多一轮。DeepSeek 不受影响。见 9.1。

## 3. 子代理结构

- 入口是 Agent（旧名 Task）工具。内置代理：general-purpose；Explore（只读搜索，禁用
  Edit/Write/NotebookEdit/Agent，外部用户默认用小模型，不加载 CLAUDE.md）；Plan；
  verification（后台运行、继承主模型、只能写临时目录、必须以 `VERDICT: PASS/FAIL/PARTIAL`
  结尾、提示里明确“去找问题而不是确认成功”）；statusline-setup；guide。
- 自定义代理：`.claude/agents/*.md` 的 frontmatter 支持 `tools`、`disallowedTools`、`model`
  （含 inherit）、`effort`、`permissionMode`、`mcpServers`、`hooks`、`maxTurns`、`skills`、
  `initialPrompt`、`memory`（user/project/local 持久记忆）、`background`、`isolation: worktree`。
  SDK 的 `agents` 选项可以程序化注册同样的定义。
- 工具过滤：所有子代理都不能用 AskUserQuestion、进出计划模式、停止任务；外部用户的子代理
  不能再派生子代理；MCP 工具对所有子代理开放；后台（异步）代理只有一个白名单。权限请求
  冒泡给主会话。
- fork 子代理（实验开关）：省略 `subagent_type` 时继承父会话的完整上下文和同一工具池
  （为了提示缓存逐字节一致），统一后台运行并以 `<task-notification>` 回报。
- coordinator 模式：主代理只做编排，worker 用受限工具集，共享 scratchpad。
- 任务系统：LocalAgentTask、LocalShellTask（命令超 15 秒可转后台）、RemoteAgentTask、
  Monitor、Dream（记忆整合），支持 resume。

## 4. 技能（Skills）

- 目录：用户级、项目级、插件、托管、内置（bundled）与 MCP 提供的技能。
- frontmatter：`name`、`description`、`when_to_use`、`allowed-tools`、`argument-hint`、
  `arguments`、`model`/`effort`、`context: fork`（在 fork 子代理里执行）、`agent`、`paths`
  （条件技能：触碰到匹配文件才激活）、`user-invocable`、`disable-model-invocation`、`hooks`、`shell`。
- 列表预算：技能清单占上下文的 1%（默认 8,000 字符），每条描述最多 250 字符，内置技能不截断。
- 调用时才读正文；`$ARGUMENTS` 替换；返回技能目录，正文里的相对路径据此解析。

## 5. 提示词组装

- 分段注册：`systemPromptSection(name, compute)` 计算一次并缓存到 /clear 或 /compact；
  `DANGEROUS_uncachedSystemPromptSection` 每轮重算，必须写明为什么破坏缓存。
- 优先级：override → coordinator → agent → custom → default，最后 append。
- 参考实现里仍有模型相关部分：模型名与 ID、按模型查表的知识截止日期、“最新前沿模型”
  常量、按模型发布调整的写注释指引。**这正是本项目要去掉的东西**（第 7 节）。

## 6. 压缩、权限与钩子（摘要）

- 压缩：autocompact 缓冲 13k token；microcompact 只清理可压缩工具（读文件、搜索、shell
  等）的旧结果，保留最近若干个；另有基于时间的清理、snip、会话记忆压缩。
- 权限：模式（default/acceptEdits/plan/bypass/auto）、规则解析、危险命令模式、可选分类器；
  只读工具在多数模式下不打断用户。
- 钩子：PreToolUse/PostToolUse/PostToolUseFailure/UserPromptSubmit/SessionStart/
  PreCompact/Stop/SubagentStop 等，可以阻断、改写输入或追加上下文。

## 7. 与本项目的对照

| 方面 | 参考实现 | 本项目（改前） | 0.4.56 |
| --- | --- | --- | --- |
| 提示词与模型 | 带模型名/截止日期 | 按厂商正则分族，分族改写提示（如“一次只调一个工具”） | 文本与模型无关，所有模型同一组件；预算只看上报的上下文窗口 |
| 工具调用格式 | 原生接口 | 组件库里残留厂商 XML 调用格式、引用标签、固定日期 | 改为“只用运行时原生工具接口”，占位符注入日期/截止 |
| 并发 | 运行时按只读批量并发 | 提示词按模型限制 | 交给运行时；`capability_search`/`capability_inspect` 标为只读 |
| MCP 延迟加载 | alwaysLoad 豁免 | KiCad 入口被延迟，Claude 模型多一轮 | 三个入口 alwaysLoad，首个请求即可用（实测） |
| 外部 MCP | 启动时批量连接 | 只能按需（capability_search） | 设置：按需 / 直连运行时 / 关闭 + 禁用名单 |
| 技能 | Skill 工具 + 1% 清单预算 | 只能按需；每次搜索遍历全部目录 | 设置：按需 / 原生 Skill / 关闭；索引缓存 30 秒；`when_to_use` 参与排序；描述 250 字；`$ARGUMENTS`；`allowed-tools` |
| 已连接服务器 | 工具常驻 | 每次搜索都重新 tools/list，且必须带 server= | 每连接只 list 一次；不带 server= 也能搜到已连接服务器 |
| 只读权限 | isReadOnly 不打断 | 只有固定 9 个工具免确认 | 内置类型化动作中 `mutates:false` 的也免确认（访问网络的除外）；外部 MCP 的 readOnlyHint 是服务器自述，仍照常询问 |
| 子代理 | 内置 Explore/verification 等 | 只有通用委派提示 | 注册 `kicad-reviewer`、`kicad-verifier`，继承所选模型；只给 `capability_inspect` 等只读工具，写操作在权限层直接拒绝、不弹确认 |
| Codex 路径 | — | 只有一段按需提示 | 与 Claude/DeepSeek 路径共用同一组模型无关组件 |

## 8. 本轮改动

- `composer/prompt-sections.ts`（PROMPT_VERSION 2026-10-22.4）
  - 删除按模型分族的 `runtime_capabilities`，新增 `tool_calls`（只用原生接口、严格按 schema、
    出错按错误信息修正）；`skills`、`mcp`、`delegation`、`memory` 按设置选择；`environment`
    带当前日期；缓存键不含模型；`disabledSections` 可关闭非保护段。
  - 测试断言 8 种模型 ID（含未知）渲染出的文本完全相同。
- `composer/model-profile.ts`：删除厂商正则，改为 `runtimeLimits(contextWindow)`；扩展从
  SDK 结果的 `modelUsage[*].contextWindow`、终端从 OpenCode 的 `model.limit.context` 获取窗口。
- `composer/demand.ts`：技能索引缓存、`when_to_use`/`argument-hint`/`allowed-tools`、
  `$ARGUMENTS`、描述与服务器文本截断、每连接一次 tools/list、已连接服务器参与无 server 搜索、
  禁用服务器、设置关闭来源时给出可操作的报错、`isReadOnly`/`inspect`、`demandGuidance(features)`。
- `内部提示词.md`：去掉厂商命名空间标签（语音块、引用、函数调用 XML 共 20 处）、固定知识截止
  与日期、产品界面描述；改用 `{{CURRENT_DATE}}` 等占位符；文件头写明模型无关规则和运行时组装表。
- 扩展：新设置 `kicadAgent.mcp.mode`、`mcp.disabledServers`、`skills.mode`、`skills.disabled`、
  `skills.extraRoots`、`subagents.enabled`、`prompt.disabledSections`；`apply-orchestration.mjs`
  把同一份设置同时用于提示词、工具、子代理和权限；Codex 路径同样遵循。

## 9. 验证

1. alwaysLoad（本机 CLI 2.1.305，`ENABLE_TOOL_SEARCH=true`，本地夹具）：不加时首个请求只有
   ToolSearch，没有 KiCad 工具；加上后 `capability_search`/`capability_call` 在首个请求中完整发送。
2. 子代理：同一 CLI 接受 `agents`；`kicad-reviewer` 运行时工具恰好是
   `capability_search`、`capability_inspect`、Read、Grep、Glob；模型继承主会话
   （分别用 `claude-opus-5-5` 和 `deepseek-v4-pro` 测试）。
3. `bash tools/ai/Kicad-extension/build.sh`：tsc、vue-tsc 与全部内置检查通过（含真实打包 CLI
   的懒加载测试：3 个入口、只读注解、alwaysLoad、inspect 拒绝写操作、设置开关）。
4. `node --test tools/ai/composer/test tools/ai/membership/test`：37 通过。
5. 终端 `test-session-runtime.mjs` 通过。
6. 扩展界面测试（streaming、execution、execution-steps、composer、reasoning）在 0.4.56 通过。

## 10. 未采纳与后续

- 未采纳：BUDDY、KAIROS/Dream、coordinator 全模式、fork 子代理、远程代理、语音、
  分类器式自动权限——与 KiCad 场景无关或依赖产品后端。
- 后续候选：
  - 条件技能（`paths`）：打开 `.kicad_pcb`/`.kicad_sch` 时优先 KiCad 技能。
  - 外部 MCP 的 `tools/list_changed` 刷新与 OAuth。
  - 终端（OpenCode）同样接入 mcp/skills 设置（目前只有扩展有设置项）。
  - `kicad-verifier` 在一次修改后由主代理自动派发（现在由模型自行决定）。
