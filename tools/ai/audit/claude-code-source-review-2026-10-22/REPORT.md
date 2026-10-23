# Claude Code source review and extension tool optimizations

Date: 2026-10-22

## Sources and provenance

- `pengchengneo/Claude-Code`: an unofficial TypeScript tree restored from the
  published npm package's source map.
- `renepardon/claude-code`: a backup of the leaked Claude Code source.
- Both are unlicensed third-party restorations. This review used them only to
  understand architecture and behavior. No source text or implementation was
  copied into this repository; the changes below are independent implementations
  in the existing shared JavaScript/TypeScript code.

## Modules inspected

- `src/constants/systemPromptSections.ts`: memoized prompt sections; volatile
  sections have an explicit cache-break reason.
- `src/utils/systemPrompt.ts`: effective prompt priority (override, coordinator,
  agent, custom, default, append).
- `src/constants/prompts.ts`: environment, model info, output style, language,
  MCP instructions, function-result clearing and tool-result summarization.
- `src/utils/toolSearch.ts` and `src/tools/ToolSearchTool/prompt.ts`: deferred
  tools, exact `select:` queries, token thresholds and model-support patterns.
- `src/utils/toolPool.ts`: built-in/MCP pool merging and stable ordering for
  prompt-cache stability.
- `src/utils/toolResultStorage.ts`, `src/constants/toolLimits.ts`: 50k-character
  default result cap, 200k per-message budget, persisted-output previews.
- `src/constants/prompts.ts` (`SUMMARIZE_TOOL_RESULTS_SECTION`): summarize large
  results instead of replaying raw output.
- `src/memdir/*`: bounded memory entrypoints, frontmatter, relevance retrieval.
- `src/tools/AgentTool/*`, `src/coordinator/*`: bounded read-only exploration,
  coordinator tool filtering.
- `src/query/*`, `src/services/compact/*`: compaction, token budget and stop
  hooks.

## Adopted mechanisms

1. Componentized, cached prompt assembly with runtime facts and capability flags.
2. A conservative model-capability profile that never writes vendor/model names
   into prompt text.
3. Per-model tool-result budgets: 50k characters for larger-context models,
   30k for 100k+ context and 12k for smaller contexts; 2 KiB preview.
4. Tool discovery improvements: bounded result pages, exact `select:` queries,
   case-insensitive `kind`, string offsets and bare built-in ids.
5. Argument compatibility for weaker models: `capability_call` accepts an object,
   a JSON string or no arguments.
6. MCP server usage instructions are returned with the discovery result.
7. Workspace memory supports `list`, `search`, `read`, `append`, `replace` and
   `delete`, with ids, a 256 KiB cap and secret redaction.
8. Prompt-cache invalidation on compaction in the terminal; dynamic prompt
   sections in both the extension and terminal.

## Changes in this round

- `tools/ai/composer/model-profile.ts`
  - Capability profiles for common model families and conservative defaults.
  - `resultLimitForModel()` and `searchResultLimitForModel()`.
- `tools/ai/composer/prompt-sections.ts`
  - 14 named sections, stable order, section cache, `PROMPT_VERSION`.
  - Environment, mode, memory, delegation, verification and continuity sections.
- `tools/ai/composer/demand.ts`
  - `maxResults`, `setMaxResults`, exact `select:` selection.
  - Case-insensitive kind, numeric offset normalization.
  - `normalizeCapabilityCall()` and bare-id execution.
  - MCP `getInstructions()` passed through discovery results.
- `tools/ai/composer/local-tools.ts`
  - Memory list/search/read/append/replace/delete.
  - Atomic rewrites, ids, 256 KiB cap and secret redaction.
- `tools/ai/composer/harness.ts`
  - 50k default result cap, 2 KiB preview, per-call limit parameter.
- Extension:
  - `ClaudeSdkService` appends dynamic prompt sections before static instructions.
  - `getKiCadSdkServers` receives the selected model so search pages and result
    budgets are model-aware.
  - `SessionContinuity` tracks the model and applies the model result budget.
- Terminal:
  - `session-runtime.ts` injects the same prompt sections, tracks the model,
    updates search page size and applies the result budget.
  - Compaction clears the prompt-section cache.

## Verification

- `node --test tools/ai/composer/test/*.test.mjs`: 31 passed.
- `node tools/ai/Kicad-terminal/test-session-runtime.mjs`: passed.
- `bash tools/ai/Kicad-extension/build.sh`: full overlay, native-tool, lazy-tool,
  permission, continuity, execution and packaging checks passed.
- Installed extension: `kicad-agent.kicad@0.4.49` in VS Code and Cursor.

## Not adopted

- BUDDY, KAIROS, ULTRAPLAN, undercover mode and other product-only features.
- Full coordinator mode, auto-dream memory consolidation, cost tracking and
  token-budget routing.
- Full microcompaction service. The extension already relies on SDK autocompact;
  this round adds prompt-cache clearing, checkpoints and a result budget.
- Any direct copy of leaked source. The reference remains research material.

## Follow-up: expected guard failures

The IDE execution panel no longer reports two expected conditions as task
failures:

- The SDK Read tool refuses whole-file reads above 256 KiB. The panel filters
  that guard failure, and the `large_files` prompt section tells the model to
  use offset/limit or search. `allow_large` is reserved for an explicit request.
- A diagnostic command ending in `which tool` (or `command -v`/`type`) can
  return exit 1 when an optional tool is absent, even though the substantive
  output succeeded. The panel filters this when the command contains such a
  probe; PostToolUse appends probe guidance. The shell guidance now recommends
  `command -v tool >/dev/null 2>&1 || true`.

Extension `0.4.50` was built and cleanly reinstalled into VS Code and Cursor.

