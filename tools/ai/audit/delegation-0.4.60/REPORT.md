# Unrequested sub-agent launch investigation and local fix

## Confirmed incident

The live session did launch sub-agents without a user request for delegation. The root human request was `请把项目进行深度了解`. In session `1f752b32-0b64-45da-8f22-a83b970f9071`, the primary DeepSeek Flash response emitted five distinct `Agent` tool calls at 06:34:23–06:34:32 UTC on 2026-10-23. All five received successful asynchronous-launch results, and five child transcripts exist. Duplicate transcript entries were deduplicated by tool-use ID.

[Incident evidence](incident-evidence.json) records the transcript path, original line numbers, launch timestamps, result lines, child count and affected bundle hash. It stores no child prompt bodies or credentials.

The extension-host log for that session identifies the executing bundle as **0.4.56**. Its `beforeTool` implementation records the proposed call and returns `{continue:true}`; it contains no explicit-delegation denial. The launch used `acceptEdits` mode. Consequently, the primary model chose delegation, and the old host allowed the calls. An ordinary request to understand a project was never user authorization for sub-agents.

The explicit-request gate was present in the installed 0.4.58/0.4.59 bundles, but installation did not replace the already loaded 0.4.56 services in the affected window. Installed-version checks alone were insufficient acceptance evidence.

## Screenshot provenance correction

The attached `execution-0.4.59/running-progressive.png` is a separate, deterministic UI fixture. The test supplies `启动子代理检查 U1，不要修改文件或布线。` and directly emits Task/child events. Its DeepSeek label is mock bootstrap state; no model chooses those events. It cannot demonstrate live model behavior or authorization enforcement.

The UI test now labels every screenshot `UI TEST · simulated events · no model`. It covers ordinary project inspection separately from explicit delegation:

- [Ordinary project inspection](../../Kicad-extension/audit/execution-0.4.60/running-progressive.png): no child or delegation step.
- [Explicit-delegation fixture](../../Kicad-extension/audit/execution-0.4.60/running-explicit-delegation.png): a deliberately authorized synthetic child.
- [UI verification](../../Kicad-extension/audit/execution-0.4.60/production-ui-verification.json): production webview bundle, synthetic host events, no model requests.

The live transcript evidence above establishes the incident independently of either screenshot.

## Reference repository findings

Both requested repositories were inspected locally at these commits:

| Repository | Commit | Relevant implementation |
| --- | --- | --- |
| pengchengneo/Claude-Code | `b78dd22a091b717c8938ab98c736bc04825a8ee8` | [Agent prompt, line 270](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/tools/AgentTool/prompt.ts#L270), [Agent execution](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/tools/AgentTool/AgentTool.tsx#L239) |
| renepardon/claude-code | `0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb` | [Agent prompt, line 270](https://github.com/renepardon/claude-code/blob/0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb/tools/AgentTool/prompt.ts#L270), [Agent execution](https://github.com/renepardon/claude-code/blob/0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb/tools/AgentTool/AgentTool.tsx#L239) |

Their Agent prompts explicitly encourage proactive use for agent descriptions that call for it. The prompt files at these two pins have the same SHA-256, `ac61c37854a6dde6201351095154504cfbf4a932be24dd340b80df40604de8e3`. Their call handlers pass model-selected tasks into `runAgent`, including foreground/background paths. They are useful references for execution and streaming, but their delegation policy does not implement this project's explicit-user-request requirement. No reference implementation was copied or executed for this change.

The broader prior review remains available in [the orchestration report](../orchestration-2026-10-23/REPORT.md), [the architecture review](../claude-code-architecture-2026-10-22/REPORT.md) and [the source review](../claude-code-source-review-2026-10-22/REPORT.md).

## Changes in 0.4.60

- [SessionContinuity](../../Kicad-extension/overlay/sessionContinuity.ts) binds delegation authorization to the current root human input recorded by the host. SDK prompt hooks, child inputs, synthetic messages and assistant plans cannot grant it. The next ordinary human turn revokes it. Attached and quoted content still passes through the shared conservative intent parser.
- [Codex integration](../../Kicad-extension/overlay/kicadCodex.ts) uses that same authorization decision when enabling native collaboration. The sub-agent setting remains an independent gate.
- [Runtime regression](../../Kicad-extension/test-delegation.mjs) forces Agent/Task attempts through the real packaged SDK/CLI and checks actual execution denial, child-model traffic and successful explicitly requested delegation. The build now requires this test.
- [Continuity regressions](../../Kicad-extension/test-continuity.mjs) verify that rewritten hook prompts, assistant plans and synthetic/child inputs cannot alter root authorization.
- [UI regression](../../Kicad-extension/test-execution-ui.cjs) separates ordinary and explicit-delegation examples and labels their simulated provenance.

[The isolated patch](current-request.patch) contains only this request's changes against the prior working tree. Existing unrelated changes were preserved. No commercial-model API request was made during verification.

## Validation and activation

| Check | Result |
| --- | --- |
| Real SDK/CLI enforcement | 8 queries, 11 turns, zero unauthorized child queries. Default, acceptEdits, plan and bypassPermissions all deny ordinary project inspection. Model IDs: DeepSeek Flash, Claude Sonnet and an unknown compatible model. |
| Explicit delegation and revocation | One authorized fixture child; the next ordinary turn and a quoted-document request deny delegation. The disabled setting also denies an explicit request. |
| Shared composer tests | 46 passed, zero failed. |
| Native Codex loopback fixtures | Native spawn availability off/on/off; child execution and read-only dynamic tool forwarding pass. Isolated CODEX_HOME, zero external model requests. |
| Complete extension build | TypeScript, Vue, runtime/policy tests, webview/host bundles and VSIX packaging pass. See [build log](build.log). |
| Packaged production UI | Progressive flow, ordinary inspection, explicit fixture, child/main isolation, permission UI, keyboard, pause/resend and 320px layout pass; zero page errors. |
| Package integrity | Build manifest verified; bundled entry and dependencies load; all 1,217 installed files match, allowing VS Code's package metadata addition. |

The loopback tests prove enforcement for the shipped runtime under controlled model responses. They do not prove that each commercial provider will choose the correct tools spontaneously.

The local artifact is [kicad-0.4.60.vsix](../../Kicad-extension/dist/kicad-0.4.60.vsix), installed at `/Users/mosc/.vscode/extensions/kicad-agent.kicad-0.4.60`. SHA-256: `211e3421db42318581d3b25269919345158eb1bfc1dc7698998f3facfeb7dda9`. Source SHA-256: `5cc09fc08802e471bfe398212ef620b67c1ab571ec185f52d0eb060bf5ad416a`.

**Existing VS Code windows have not been reloaded.** A running hardware-project task was observed, so it was preserved. Use **Developer: Reload Window** after the current task finishes to replace the loaded extension code. Installation is verified; activation in existing windows remains pending. This is a local build/install, not a public release.

Machine-readable results: [verification](verification.json), [runtime enforcement](runtime-enforcement.json), [installed payload](installed.json).
