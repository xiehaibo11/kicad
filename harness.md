1. 基础循环（Agent Loop）
​
- 核心是一个while True循环，结合Bash终端命令执行能力。
​
- 运行逻辑：接收用户消息→LLM生成命令→Harness执行命令→结果返回LLM→循环往复，直到LLM判断任务完成（stop_reason≠tool_use）。
​
- 工具定义：首次循环前需告知LLM可用工具（如Bash的参数、用途）。
​
2. 工具扩展（Tool Use）
​
- 单一Bash工具的局限：需要LLM将读/写/改文件的需求翻译成复杂命令，消耗token且易出错。
​
- 解决方案：通过TOOL_HANDLERS分发机制，注册read_file、write_file等专用工具，扩展模型能力边界。
​
3. 权限控制（Permission）
​
- 安全风险：Bash无限制执行可能导致rm -rf /等危险操作。
​
- 三道闸门机制：
​
- 拒绝列表：直接拦截sudo、shutdown等高危命令。
​
- 规则匹配：判断是否在工作区外操作、是否访问敏感路径。
​
- 用户审批：高风险操作需用户确认允许/拒绝。
​
- 决策结果：deny（拒绝）、ask（询问）、allow（允许）。
​
4. 钩子扩展（Hooks）
​
- 问题：直接修改agent_loop函数添加功能会破坏核心循环稳定性。
​
- 解决方案：将扩展逻辑作为钩子挂在循环外，分为preToolUse（工具执行前）和postToolUse（工具执行后），核心循环保持不变。
​
5. 任务规划（TodoWrite）
​
- 问题：复杂任务中LLM易偏离初始目标，上下文越长越容易遗忘。
​
- 解决方案：用todo_write工具外置任务清单，只理思路不执行；连续3轮未使用则注入提醒。
​
6. 子代理（Subagent）
​
- 问题：单Agent处理复杂任务（如修bug）会产生大量上下文，导致LLM遗忘初始目标。
​
- 解决方案：启动独立子进程（Subagent）处理子任务，完成后只返回结果摘要，避免主上下文被淹没。
​
7. 技能加载（Skills）
​
- 问题：将所有项目规范（如React组件规范、SQL风格指南）放入system prompt会浪费token。
​
- 解决方案：启动时仅加载技能目录，运行时按需调用load_skill加载对应技能内容。
​
8. 上下文压缩（Context Compact）
​
- 问题：大项目中上下文易超限，导致API拒绝服务。
​
- 四层压缩机制：
​
- L1：裁剪无关旧对话，保留头部3条和尾部47条。
​
- L2：旧工具结果占位，仅保留最近3条完整结果。
​
- L3：大结果落盘，超过200KB的内容存入磁盘，仅保留预览。
​
- L4：LLM全量摘要，保存对话后生成摘要替换旧消息。
​
- 应急兜底：连续失败3次触发熔断，仅保留最后5条消息+摘要。
​
9. 记忆管理（Memory）
​
- 问题：LLM无持久状态，压缩会丢失细节，跨会话无法保留用户偏好。
​
- 解决方案：将记忆存在.memory文件夹（一条记忆一个md文件），通过MEMORY.md索引；每轮结束用小AI提取新记忆，按需加载到对话中。
​
10. 系统提示（System Prompt）
​
- 问题：硬编码的system prompt修改成本高，换项目需重写。
​
- 解决方案：将system prompt分为身份、工具、工作目录、记忆四个模块，按真实状态动态组装，context不变时返回缓存。

三、总结

视频通过地铁线路的可视化方式，将Claude Code Harness的10个核心模块串联起来，强调“循环是稳定核心，扩展挂在外面”的设计理念，帮助理解Harness Engineering的基础架构。
## 本仓库的落地方式（2026-10-22，扩展 0.4.58 修订）

上文作为 Harness 模块参考，内容和数字出自开源教学项目 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code)，不是 Claude Code 的内部实现。扩展与终端已有完整 Agent Loop，采用“保留运行时，扩展挂在 Hooks 外”的方式适配，不另加 `while True` 包裹现有循环。

### 循环与状态

- 扩展沿用 Claude Agent SDK；终端沿用 OpenCode。工具调用、模型续推、完成、停止、取消与错误状态由原运行时管理，不能仅凭 `stop_reason != tool_use` 判断任务成功。
- 两端共用 `tools/ai/composer/harness.ts`。扩展通过 `sessionContinuity.ts` 和 SDK Hooks 接入；终端通过 `overlay/session-runtime.ts` 接入。
- 工具只在自然语言任务确实需要时调用：寒暄、致谢和明确要求“不要用工具”的请求直接回答，Hooks 提供建议上下文（`composer/intent.ts` 的 `toolUseAdvice`），不通过关键词硬拦正常工具。子代理授权与权限拒绝另行强制执行。
- 不再定期提醒更新任务清单。Claude Code 自带 TodoWrite 提醒，额外提醒只会诱发无意义的工具调用；复杂任务仍可自行使用原生 todo。
- 权限三道闸门（共享 `composer/permission-gates.ts`）：
  - 闸门 1 拒绝列表：`sudo`/`doas`、关机重启、`mkfs`、`dd of=/dev/…`、写裸设备、`diskutil erase…`、fork bomb、对 `/` 递归改权限，以及递归删除根目录、系统目录或主目录。扩展用 PreToolUse 钩子拒绝（所有权限模式、所有模型、子代理内都生效），终端在 `tool.execute.before` 抛错。按“实际执行的程序”匹配，`echo "sudo"`、`grep sudo` 不会误拦。
  - 闸门 2 规则匹配：删除或写入工作区外的文件（临时目录、运行时自己的项目笔记除外）、读取或修改凭据（`~/.ssh`、`~/.aws`、`.env`、钥匙串）、`git push --force`、`git reset --hard`、`git clean -f`、`curl … | sh`。这些在 Agent 模式下不再自动批准，改为弹出确认；默认模式本来就会询问；最高权限模式只执行闸门 1。
  - 闸门 3 用户审批：沿用运行时原有权限流程。黑名单不能替代完整权限判断。
- 子代理只在用户当前消息明确要求时启动（“用子代理/多个代理/并行代理/委派/subagent/kicad-reviewer”等）。提示词说明这一规则，扩展的 PreToolUse 钩子和终端的 `task` 工具检查同时强制执行，任何模型都一样；被拒绝时模型收到原因并自己继续。附件、引用、代码块、历史与条件性规则中的“启动代理”不构成授权。关闭设置同时禁用原生 Agent/Task；Codex 根据当前人类请求配置 `agents.enabled` 和原生 V2 开关，授权变化时冷恢复同一线程，避免运行中 resume 忽略配置。Claude 兼容路径注册的 `kicad-reviewer`、`kicad-verifier` 只能使用只读工具。
- 相同工具与参数连续失败三次后，向模型提示改变方案、检查错误或说明阻塞；共享钩子不硬拒绝重试，新的明确用户消息重置计数。取消和权限拒绝不触发自动重试。OpenCode 另有原生 `doom_loop`（同一调用连续三次时询问用户），两者互补。
- Bash 在用户的 zsh 中执行时，额外提示给 glob 和 `--include` 参数加引号、`[ ]` 里用 `=`，减少运行日志里反复出现的 `no matches found`、`== not found` 失败。

### 工具结果与上下文

- KiCad 大结果在源头压缩：`board/schematic.items.get` 等默认返回 mm 精简视图并可过滤、分页（`direct/views.mjs`），`kicad_actions` 大列表只给摘要。
- 终端：OpenCode 在钩子之前就把工具输出截到 50 KB / 2000 行并落盘（`tool/truncate.ts`），因此共享的 200 KiB 归档只在用户调高 `tool_output` 上限时生效。旧工具结果修剪已默认开启（`compaction.prune`）：只把模型看到的旧输出换成占位符，存储的原文不变，保留最近两轮和最近约 4 万 token 的工具输出，用户配置优先。
- 扩展：超过结果预算（按运行时上报的上下文窗口：默认 3 万字符，20 万 token 以上窗口 5 万字符）的 MCP 结果先保存为本地 0600 文件，用 `updatedMCPToolOutput` 替换为路径、字节数、SHA-256 和预览，保留错误标志；Bash/Read 等内置工具的截断由 Claude Code 管理。
- 不按“头部 3 条、尾部 46/47 条、最近 3 个结果”删除消息，也不做“失败后只留最后 5 条”的破坏性兜底；摘要压缩沿用原生实现，压缩前保存历史、原始请求、工具状态和任务清单。

### 显示与诊断

- 扩展聊天每次请求下方是可展开的“运行详情”（默认收起：状态、工具调用次数、失败次数、耗时），展开后按时间线显示每次调用的输入与输出；单个工具失败只计入运行详情，不再逐条显示在聊天里。聊天里保留模型的重要问题、整轮错误和最终回答。详细工具输入、输出和错误同时写到只读 `Kicad Tools` 终端；仅用户点击“终端输出”或执行对应命令时才显示，工具调用不创建或聚焦终端。
- 运行中只在读者停留在底部时跟随输出；token 级进度事件不转发到界面。
- 解析命令输出为 JSON 失败（`JSONDecodeError`、`Extra data`）单独诊断：先检查输入格式、大小和异常偏移；`.epru` 分隔记录不能作为单一 JSON 文档读取，空输入应先查命令是否成功，CLI 的 stdout/stderr 应分开保存；检查类命令的非零退出还需结合实际结果判断。
- 运行日志目录在日志对象创建时确定，测试改用临时目录后不会再写入真实的 `~/.local/state/kicad/diagnostics`。
- IPC 超时报告为 `TIMEOUT`，用户取消报告为 `CANCELLED`，不再把只读请求的超时说成“编辑可能已执行”。
- 终端直接使用本机 Claude 会员凭据时，接口会以无原因的 “Error” 拒绝；现在一次性返回 403 和替代方案，不再重试五次。

### 复用模块与边界

- 工具分发使用共享 `Runtime.dispatch`；权限、专用文件工具、子代理与技能加载继续使用各自运行时。黑名单不能替代完整权限判断，也不覆盖用户已选择的权限模式。
- 工具、MCP 与技能按需加载（`capability_search` / `capability_call`）；内置工具 id 可跨轮直接调用。扩展设置 `kicadAgent.mcp.mode`（按需/直连/关闭）、`kicadAgent.skills.mode`（按需/运行时原生/关闭）、`kicadAgent.subagents.enabled`、`kicadAgent.prompt.disabledSections` 控制这些来源。
- 系统提示按身份、任务协议、工具、工具调用、环境、模式、记忆等组件动态组装（`composer/prompt-sections.ts`），文字与所选模型无关，上下文不变时返回缓存。
- 跨会话自动记忆提取未启用；任务检查点属于执行记录，不自动升级为用户长期偏好。未添加每轮额外模型调用。

### 开源参考

- OpenCode：权限规则按“权限类型 + 通配符”取最后命中，`doom_loop`、工作区外目录与 `.env` 读取默认询问；子代理继承父会话的拒绝规则；旧结果修剪见上。
- Codex CLI：沙箱加审批策略；超过 `model_auto_compact_token_limit` 时保留初始上下文、最近约 2 万 token 用户消息和摘要；本机记忆按会话摘要汇总到 `~/.codex/memories/`。
- Cline：Focus Chain 每 6 次请求（可配置）重新注入任务清单；Hooks 包括 PreToolUse、PostToolUse、UserPromptSubmit 等。
- OpenHands：Condenser 保留开头事件、中间换成摘要；StuckDetector 检测重复动作与错误循环。

### 验证入口

- `node --test tools/ai/composer/test/`（或 `~/.bun/bin/bun test tools/ai/composer/test/`）
- `node --test tools/ai/direct/test/*.test.mjs`；加 `KICAD_TEST_CLI=<kicad-cli 绝对路径>` 运行原生用例
- `bash tools/ai/Kicad-terminal/build-session-runtime.sh && node tools/ai/Kicad-terminal/test-session-runtime.mjs`
- `~/.bun/bin/bun tools/ai/Kicad-terminal/test-membership.mjs`
- `bash tools/ai/Kicad-extension/build.sh`（含扩展全部 `.mjs` 回归）；界面测试 `test-execution-ui.cjs`、`test-execution-steps-ui.cjs`、`test-streaming-ui.cjs`、`test-reasoning-ui.cjs` 需 Playwright，参数为已安装或构建后的扩展目录。

完整发布仍需对应版本的打包、安装及实际界面验证。

当前源码审计、来源固定版本、修复和验证边界见 `tools/ai/audit/orchestration-2026-10-23/REPORT.md`。
