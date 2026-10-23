# Progressive execution display — 0.4.59

The extension now follows the step stream shown in the user's second screenshot. There is no turn-level disclosure, tool-call counter, failure counter or per-turn terminal shortcut. A tool step appears when its invocation arrives; its result updates the same step. The existing model/runtime loop decides the next invocation from the task and previous results.

## Changes

- [ExecutionTurn.vue](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/ExecutionTurn.vue:1) renders the received steps directly. The overall collapse control and summary counters were removed. There is one live status for thinking or a pending permission request.
- [ExecutionTimeline.vue](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/ExecutionTimeline.vue:1) covers the wait before the first event; the separate branded loading spinner was removed from the chat page.
- [executionTimeline.ts](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/executionTimeline.ts:78) keeps progress, important findings and questions in their source order, including mixed blocks in one message. Previously the UI moved notices above earlier tool steps. The final answer follows the steps.
- [ExecutionSteps.vue](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/ExecutionSteps.vue:1) keeps individual thought disclosures, IN/OUT previews, copy controls, diffs and nested agent output. There are no nested tool-call totals. Interactive tools retain their dedicated renderers; failed results remain visible as ERR on the affected step. Unfinished calls are not shown as successful after a stop.
- [apply-execution.mjs](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/apply-execution.mjs:43) replaces the old instruction to hide progress in an expandable execution record. It now describes the progressive stream and task-driven tool choice without requiring special notice prefixes.
- [AgentDashboard.vue](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/overlay/AgentDashboard.vue:1) no longer displays tool-call totals in its optional details. Agent/task state and token information remain available.
- [README.md](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/README.md:49) and [内部提示词.md](/Users/mosc/Downloads/Kicad/内部提示词.md:45) describe the current behavior. Existing unrelated workspace changes were preserved. [current-request.patch](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/current-request.patch) isolates this request's changes from the already dirty worktree.

## Orchestration

The default capability catalog already loads sources on demand. This change does not introduce a new queue or force a fixed sequence of health checks, skill loads or tool discovery. Basic shell/file tools remain available; the catalog exposes discovery and invocation entry points, with an additional read-only entry point when subagents are enabled. Discovery returns matching schemas and does not execute its results. Only an explicitly selected external MCP server connects. Skill search reads metadata; the selected body is read when called. A known built-in id can be reused without another search. Independent reads can still run concurrently when the runtime permits it.

The model sees each tool result before choosing a dependent next call. The UI only observes events: rendering, expanding an output, copying text or reading history cannot launch tools or create another user request. The passive **Kicad Tools** terminal still records commands, results and failures, with no automatic reveal or focus. The command **Kicad: 查看工具终端输出** opens it explicitly.

Reference source inspected: [StreamingToolExecutor.ts at pengchengneo b78dd22](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/services/tools/StreamingToolExecutor.ts) adds tools as they stream in, emits progress promptly, and preserves received order for results. Tool search defers capabilities rather than executing a catalog. The prior two-repository comparison is retained in [the source review](/Users/mosc/Downloads/Kicad/tools/ai/audit/claude-code-source-review-2026-10-22/REPORT.md). No reference implementation was copied or executed.

## Verification

| Check | Result |
| --- | --- |
| Full extension build, TypeScript, Vue and packaged bundle tests | Passed |
| Packaged CLI with a localhost model fixture | Passed: 6 requested invocations across 7 model requests; stable catalog registration throughout |
| MCP timing | Selected server start state per model request: `false, false, false, false, false, true, true`; unused server never started |
| Skill timing | Body absent before invocation and present after invocation |
| Invocation stream | Search/call steps emitted in the model's requested order |
| Shared composer tests | 46 passed, 0 failed |
| Shared terminal session plugin | Rebuilt and tests passed |
| Production UI with deterministic host events | Passed: initial wait, no aggregate controls, ordered findings, visible ERR, thoughts, permission request, nested output, final reply |
| Step-by-step arrival | Passed: one running step before its result, result updates the same DOM row, future steps absent before their invocation |
| Interactions and lifecycle | Passed: mouse/keyboard output expansion, copy, image preview, pause/resend, stale channel isolation and new-chat reset |
| Narrow layout | Passed at 320 px without horizontal overflow |
| Streaming | 983 events/second; maximum measured timer lag 8 ms; scroll position and selected text retained; model selection queued until the next request |
| Browser exceptions | None in all three production UI tests |
| Manifest and unpacked bundle | Passed |
| Local installation | 0.4.59 installed; 1,217 installed payload files match the VSIX, ignoring only VS Code's package metadata |

Commands and results are retained in [verification.json](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/verification.json), [build.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/build.log), [production-ui.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/production-ui.log), [execution-steps.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/execution-steps.log) and [streaming.log](/Users/mosc/Downloads/Kicad/tools/ai/audit/progressive-execution-0.4.59/streaming.log).

Production-asset screenshots with synthetic host events: [progressive stream](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/audit/execution-0.4.59/running-progressive.png), [step details](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/audit/execution-steps-0.4.59/running-expanded.png), [completed stream](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/audit/execution-0.4.59/completed-progressive.png), [320 px layout](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/audit/execution-steps-0.4.59/narrow-320.png). The DRC values and design paths in these fixtures are synthetic, not live engineering results.

## Artifact and activation

- VSIX: [kicad-0.4.59.vsix](/Users/mosc/Downloads/Kicad/tools/ai/Kicad-extension/dist/kicad-0.4.59.vsix)
- SHA-256: `51b84273ec0e73a673cb2be32dd1978a4c4f93406343619bb6a2dd93e4d97db3`
- Source SHA-256: `0331bbe61eb8cfe7716779fbbac2643a70dfc1180e5792903ec36c16d9691f7e`
- Installed: `/Users/mosc/.vscode/extensions/kicad-agent.kicad-0.4.59`

The current VS Code window was not forcibly reloaded. Already loaded webviews require a window reload after their current task finishes. This is a local build and installation; no commit, push or public release was made. No external model calls or live KiCad design operations were used for this verification. The standalone terminal executable was not rebuilt; its shared session plugin was rebuilt and tested.
