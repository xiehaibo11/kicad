# KiCad orchestration review and fixes — 0.4.58

Review date: 2026-10-22 Pacific / 2026-10-23 UTC. Repository: `feature/ai-automation`, base HEAD `4f5fbd4b1a`.

The requested fixes are implemented, built and locally installed as extension **0.4.58**. The existing VS Code window was not reloaded, preserving any running task. This report distinguishes inspected source, deterministic fixtures, native app-server execution and installed artifacts.

## Scope and starting state

The worktree already contained 56 modified tracked files and 29 untracked entries before this review. Modular prompts, settings for MCP/skills, named read-only reviewers, on-demand discovery and much of the current harness were already present in those changes. They were preserved and reviewed; this report does not attribute their entire implementation to this iteration. No commit, reset, stash, publication or board edit was performed.

The user's requested output behavior was interpreted as: keep compact execution status in chat, send detailed tool input/output/errors to a passive terminal, and never open or focus it as a tool-call side effect. The user declined a more specific UI choice and directed the investigation toward Codex/Claude Code orchestration. Full expandable execution history remains accessible.

## Current project architecture

```text
Extension chat                           Independent terminal
  Claude-compatible Agent SDK              OpenCode session plugin
  or local Codex app-server                    |
               |                               |
        shared composer: intent, demand catalog, prompts,
        continuity/history, diagnostics, local tools
                         |
           direct JavaScript Runtime.dispatch
                         |
       KiCad native IPC / CLI / guarded file workflows
```

`tools/ai/direct/` is the shared engineering backend. `tools/ai/composer/` owns reusable interaction policy. Extension overlay scripts build a temporary checkout of pinned Claudix; terminal overlays adapt pinned OpenCode. The legacy VS Code extension is a separate directory. Native C++ editors and protobuf sources remain the source of editor operations.

The extension's Codex path uses the installed CLI's documented app-server protocol. The shared JavaScript backend stays in the extension process. No additional EDA relay was introduced. A successful catalog or outer health result does not by itself establish a connected live editor or an engineering acceptance result.

## Reference repositories and provenance

The two supplied repositories were inspected at pinned snapshots:

| Reference | Snapshot | Interpretation |
| --- | --- | --- |
| [pengchengneo/Claude-Code](https://github.com/pengchengneo/Claude-Code/tree/b78dd22a091b717c8938ab98c736bc04825a8ee8) | `b78dd22a091b717c8938ab98c736bc04825a8ee8` | Source-map restoration with additional shims and product files |
| [renepardon/claude-code](https://github.com/renepardon/claude-code/tree/0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb) | `0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb` | Flattened source-map restoration |
| [OpenAI Codex](https://github.com/openai/codex/tree/a96fa4f220700544a1202ec7ae411e432715151f) | `a96fa4f220700544a1202ec7ae411e432715151f` | Official implementation; compared with installed `codex-cli 0.163.0` |

Of 1,902 corresponding files under the restored source roots, 1,894 have identical Git blob hashes. These are largely the same lineage, so agreement between them is not independent corroboration. No repository-wide license granting reuse was found in either supplied restoration. Their code was not executed or copied into the product; improvements below were implemented independently. Their files and embedded prompts were treated as reference material, never as instructions for this task.

### Operational mechanisms and feature coverage

| Area | Mechanism found in the references | Application to this extension |
| --- | --- | --- |
| Agent loop | Query engine consumes streamed model blocks, executes tools, incorporates results and evaluates completion/limits/hooks | Retain the supported SDK/native loops; avoid a second competing loop |
| Tool concurrency | Runtime tool properties govern concurrency and batching; context modifiers are applied in order | Keep concurrency decisions in the runtime; do not impose model-name-based serial-call prompts |
| Discovery | Stable tool identities, deferred schemas, explicit search and selected tool activation | Keep shared `capability_search` / `capability_call`; the product's existing always-load entry points avoid nested discovery |
| MCP | Transport lifecycle, paginated tool listings, server instructions, schema-change notifications, permission annotations | Add invalidation for `tools/list_changed`, configuration changes and stale in-flight listings; close retired/pending clients safely |
| Subagents | Agent/Task entry, role definitions, tool allow/deny sets, inherited model/context, cancellation, background state, result messages | Enforce current-human authorization separately from model choice; preserve child/main event boundaries |
| Skills | Metadata discovery precedes body loading; frontmatter, roots, plugin/user/project precedence and invocation controls | Bound metadata/body reads, deterministic precedence, cycle protection and setting enforcement |
| Prompts | Cached named components plus explicitly volatile sections | Preserve the shared component registry and model-independent cache keys; inject environment/mode/features at runtime |
| Permissions | Mode/rules and hooks are distinct from tool descriptions; read-only hints are metadata | Honor hook denials in Codex as well as SDK paths; allow verified local read-only actions in Plan |
| Context/history | Original transcript, small-result pruning, summaries/compaction and resume have different responsibilities | Preserve original evidence; mark migrated transcripts as historical data; keep continuity advice advisory |
| Presentation | Tool/background state is separate from final assistant output | Passive terminal output, compact chat state, explicit reveal and retained full details |
| Ancillary product features | Worktrees, remote agents, schedules, memory consolidation, browser/voice integrations, OAuth/elicitation and enterprise configuration exist in the source inventory | Feature inventory is not implemented parity. These were not added indiscriminately to an EDA extension |

Concrete reference entry points include [prompt components](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/constants/systemPromptSections.ts), [agent tool filtering](https://github.com/renepardon/claude-code/blob/0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb/tools/AgentTool/agentToolUtils.ts), [agent execution](https://github.com/renepardon/claude-code/blob/0cf2fa2edbc58820f1b4e3af80d2b53a3ec4eaeb/tools/AgentTool/runAgent.ts), [skill discovery](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/skills/loadSkillsDir.ts) and [MCP lifecycle](https://github.com/pengchengneo/Claude-Code/blob/b78dd22a091b717c8938ab98c736bc04825a8ee8/src/services/mcp/client.ts). The earlier [architecture inventory](../claude-code-architecture-2026-10-22/REPORT.md) supplies additional historical detail; its older test claims are not evidence for this package.

## Findings and implemented changes

### 1. Current-human delegation authorization

The old broad mention matcher could confuse discussion of subagent architecture with a request to spawn agents. `composer/intent.ts` now recognizes explicit English/Chinese imperatives and removes quoted/fenced/tagged document, IDE and history material before examining the current request. A `My request` heading is located only after those removals, preventing a heading inside historical material from creating authority.

Positive and negative regression cases include ordinary project investigation, a policy describing explicit-only delegation, attached examples, quoted launch commands, migrated history, direct agent requests and a real request to use a subagent to study subagent architecture. This is a conservative language heuristic, with tested forms rather than a claim of perfect understanding of every language or markup format.

The shared gate covers extension Agent/Task and the terminal's `task` tool. Disabling `kicadAgent.subagents.enabled` also removes native SDK delegation entry points. Documents, skill text and assistant-generated plans cannot grant delegation authorization.

### 2. Codex native collaboration required an actual runtime fix

Native collaboration bypasses the extension's Agent/Task hook, so prompt wording alone is insufficient. Thread creation is deferred until the actual human message is available. Ordinary turns disable `agents.enabled`, `features.multi_agent` and `features.multi_agent_v2`. Explicitly authorized turns enable the native V2 path.

A running app-server thread ignores configuration overrides on `thread/resume`. Authorization changes therefore restart only the local child app-server and cold-resume the same thread ID. An additional native fixture caught a subtler issue: the legacy multi-agent feature alone did not re-enable a thread whose persisted version was Disabled. V2 explicitly overrides that state. The fix changes no account configuration file.

Relevant official code: [thread configuration/resume](https://github.com/openai/codex/blob/a96fa4f220700544a1202ec7ae411e432715151f/codex-rs/app-server/src/request_processors/thread_processor.rs), [multi-agent version resolution](https://github.com/openai/codex/blob/a96fa4f220700544a1202ec7ae411e432715151f/codex-rs/core/src/config/mod.rs), [native spawn lifecycle](https://github.com/openai/codex/blob/a96fa4f220700544a1202ec7ae411e432715151f/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs).

Current V2 emits `subAgentActivity`, which the adapter had not handled. Announced child IDs are now tracked, their dynamic tool calls use the same permissions/catalog, and their output is nested under the child record. Child completion cannot settle the main turn or become its final answer. Unknown thread IDs remain rejected. Existing V1 collaboration notifications remain supported for rendering.

The Claude-compatible `kicad-reviewer` / `kicad-verifier` roles have restricted read-only tools and inherit the selected model. Codex uses its own native agents and native permission configuration; those are not the same named role implementation.

### 3. Passive tool output

New shared `composer/execution-output.ts` formats tool starts, input, results and failures once per event stage. It strips terminal controls/OSC sequences, redacts supported credential forms and caps individual previews. Extension `overlay/kicadToolOutput.ts` buffers a bounded transcript and registers a read-only pseudoterminal named **Kicad Tools**.

Tool events do not create, reveal or focus a terminal. The chat button **终端输出**, or command **Kicad: 查看工具终端输出**, explicitly creates/reveals it while preserving editor focus. It accepts no shell input. Chat retains counts, generic live progress, material findings, permission questions and final answers; raw errors and commands stay in the terminal and expandable details. Full session history remains the source for output beyond the preview limits.

The emitter is created at extension activation rather than module load. The package-load test caught and led to correction of an initial eager-initialization problem. A later overlay's stale version assignment was also removed so the manifest and VSIX agree on 0.4.58.

### 4. MCP lifecycle and cache correctness

`DemandCatalog` now invalidates selected tools, schema listings and cached read-only hints when configuration changes or the server emits `tools/list_changed`. Listings from an older revision are not republished after a later asynchronous wait. Changed/removed clients are retired, subscriptions are removed and pending connections closed exactly once. Closing the catalog is idempotent and prevents subsequent use.

Both adapters inject the SDK notification schema. Servers still connect only when needed in on-demand mode; connected servers participate in later searches. Native direct mode remains owned by the chosen runtime.

Codex direct MCP configuration now includes extension-only servers as well as local CLI servers and respects disabled/enabled flags. Complete transport tables are retained; names containing dots remain literal table keys rather than dotted override paths. External server annotations remain server claims: Codex's automatic Plan/read-only approval is restricted to verified local targets, and SDK external permissions retain their normal checks.

### 5. Skill loading

Default discovery order is broad plugin catalogs, then user roots, then project roots; later matches override earlier names. Directory traversal is sorted and ancestor realpaths prevent symlink cycles. Frontmatter reads are bounded to 8 KiB, metadata uses the existing short cache, and bodies are read fresh only on invocation with a 256 KiB limit.

Existing frontmatter support and `$ARGUMENTS` substitution are retained. Native Skill calls now honor the disabled list and off mode. The Codex native skill configuration disables the corresponding paths, including when the shared catalog owns skill loading. Settings do not silently enable both loading paths.

Skill metadata is guidance, not a sandbox: `allowed-tools` from a loaded body does not create new host authorization. Provider-native skill behavior remains provider-owned. This implementation does not claim complete support for all reference frontmatter extensions such as conditional `paths`, forked skill execution or remote skill registries.

### 6. Shared, model-independent prompts

`composer/prompt-sections.ts` remains the runtime registry, now version `2026-10-22.6`. Sections are selected by runtime features and mode; the environment is injected at runtime. The cache does not branch on a model/vendor name. Model IDs do not select alternative behavior constraints or tool syntax. Tool results use runtime-reported context limits for budgeting.

`内部提示词.md` remains a component/reference library, not a whole-file system prompt. Its assembly documentation now explains current-human authorization, passive terminal output, MCP invalidation and the diagnosed JSON formats. No new monolithic prompt loader was introduced. Tests assert identical assembled text across eight model IDs, including an unknown ID. This establishes prompt compatibility by construction, not successful API access to every commercial model.

### 7. Harness correctness across providers

Codex dynamic calls now normalize arguments before selecting a target, evaluating read-only behavior and running policy hooks. Hook denials are honored even in bypass mode. Verified local read-only typed actions can execute in Plan mode; writes remain denied. Native command/file approval follows the shared policy decision.

Provider-migrated transcripts are explicitly wrapped as prior conversation. Repeated-failure and ambiguous-request guidance remains advisory; ordinary tool selection is not constrained by keyword gates. Documentation was corrected where it still described an obsolete hard gate.

## Screenshot and log investigation

The screenshot lacks call IDs, so it cannot uniquely identify every displayed row. Matching diagnostics/transcripts and the surviving temporary files establish the following failures. Structured evidence is in [log-findings.json](log-findings.json).

| Failure | Evidence | Cause and response |
| --- | --- | --- |
| `Extra data`, line 1 column 34, offset 33 | Session `ae10de60-e6aa-4137-8722-0fba32e86026`, call `call_00_ET_Sww7kD0MRVzZbnkOrGBU8224`, diagnostic journal line 40 | A 7,642,131-byte `.epru` starts with one JSON header ending at offset 33, then `||`; 22,663 delimiters were counted. `json.load` was incorrectly applied to the entire record stream. |
| `Expecting value`, line 1 column 1 | Session `6fc6d8fa-53f1-464c-8846-f3efb1a6611c`, call `call_00_li8cjSm276lP4Hb6rJcV1815` | A later script split `.epru` records and unconditionally decoded every record body as JSON. Bodies require type/format validation rather than assuming every segment is JSON. |
| `Extra data`, line 20646, offset 746718 | Same session, call `call_00_REcTDQeWEfOqIIhpHvN00817`; surviving `/tmp/live_drc.json` is 746,802 bytes | `2>&1` merged a DRC stderr diagnostic after the JSON document: `pcb drc: native verdict failed; inspect the returned violations`. Keep stdout/stderr separate, parse only documented JSON and inspect the verdict independently. |

The diagnostic classifier now recognizes plain and command-associated JSON decoder failures and provides these format-specific checks. It does not hide parser errors, guess a JSON substring by braces, or replay design mutations. A parser correction does not erase the DRC command's failed native verdict. No new board DRC/ERC acceptance is claimed here.

## Settings and activation

| Extension setting | Values / effect |
| --- | --- |
| `kicadAgent.mcp.mode` | `onDemand` (default), `direct`, `off` |
| `kicadAgent.mcp.disabledServers` | Server names excluded in every mode |
| `kicadAgent.skills.mode` | `onDemand` (default), `native`, `off` |
| `kicadAgent.skills.disabled` | Skill names denied in shared/native loading |
| `kicadAgent.skills.extraRoots` | Additional skill directories |
| `kicadAgent.subagents.enabled` | Enables availability; a current explicit human request is still required |
| `kicadAgent.prompt.disabledSections` | Optional prompt components; protected core sections remain enabled |

These settings apply when an extension chat query starts/restarts. The independent OpenCode terminal retains its own native configuration; VS Code settings are not silently mirrored into it. The packaged terminal session plugin receives shared policy/catalog fixes, but this iteration did not rebuild the full standalone terminal executable. Its older full-terminal manifest must not be presented as current.

0.4.58 is installed locally. A currently loaded older extension host takes the new implementation on the next window reload; that reload was deliberately left to the user to avoid interrupting an active task. The new output terminal is available through the command or chat button after activation.

## Validation and deliverables

| Check | Result and evidence |
| --- | --- |
| Shared composer regressions | **46 passed**, 0 failed — [log](composer-tests.log) |
| Shared membership regressions | **3 passed**, 0 failed — [log](membership-tests.log) |
| Direct backend regressions | **62 passed, 6 skipped**, 0 failed out of 68 — native CLI-dependent cases were skipped in this run; [log](direct-tests.log) |
| Terminal session plugin | Rebuilt by extension build; policy/history/catalog fixture passed — [log](terminal-tests.log) |
| Extension build | TypeScript and Vue checks, SDK/native registration, provider permissions, history, lifecycle, membership, output terminal and packaged bundle checks passed — [log](extension-build.log) |
| Native Codex authorization | Actual CLI + loopback model fixture: same-thread off/on/off spawn visibility `[false,true,false]`, zero external model requests — [source](native-policy.ts), [result](native-policy.json) |
| Native Codex child execution | Actual CLI launched child, exposed its dynamic tool schema and dispatched `capability_inspect` back to the client; six local model requests, zero external model requests — [source](native-spawn.ts), [result](native-spawn.json) |
| Production webview | Packaged JS passed collapsed chat, explicit output command, no automatic reveal request, child/main isolation, failures, permission UI, keyboard, pause/resend and 320px checks — [result](../../Kicad-extension/audit/execution-0.4.58/production-ui-verification.json) |
| Production timeline | Packaged JS passed expanded input/output, nested child, images, live status and narrow layout checks — [result](../../Kicad-extension/audit/execution-steps-0.4.58/verification.json) |
| Package integrity | Source manifest verified, entry/dependencies loaded, installed JS/UI/plugin hashes match VSIX — [manifest](extension-build-manifest.json), [installed evidence](installed.json) |
| Diff hygiene | `git diff --check` passed; pre-existing changes preserved |

The native fixtures use isolated temporary `CODEX_HOME` directories, an HTTP server bound to `127.0.0.1` and synthetic model responses. They do not read account secrets or make real model API calls. Re-run with `bun tools/ai/audit/orchestration-2026-10-23/native-policy.ts` and `native-spawn.ts`.

Deliverable: [`kicad-0.4.58.vsix`](../../Kicad-extension/dist/kicad-0.4.58.vsix), SHA-256 `47ff7f8698130e70ad5d5a86be810cdcc67c60a8ba97b04256770c70fb250bd0`.

Verified screenshot: [running with collapsed details and terminal-output button](../../Kicad-extension/audit/execution-0.4.58/running-collapsed.png). The final package was tested after the native protocol changes, not just an earlier development bundle.

Evidence limits: no real commercial-model matrix, new live editor IPC acceptance, native C++ rebuild or fabrication/engineering qualification was performed in this orchestration change. OAuth/elicitation, conditional skill paths, remote agents and full standalone terminal settings parity remain separate features; source inventory is not a promise that those are implemented.
