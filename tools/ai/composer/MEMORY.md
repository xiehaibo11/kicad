# Local personalization memory

`memory.ts` is shared by the terminal and VS Code extension. It uses local structured
records, not model training. The design follows the separation of writing, recall,
updates and forgetting described in the [personalization and memory reference](https://matt33.com/2026/07/11/llm-personalization-memory/).

## User controls

The extension's **Settings → Memory** page has three independent switches:

- **Global Memory**: cross-project preferences and explicitly saved global notes.
- **Project Memory**: facts and workflows isolated by canonical workspace path.
- **Learn from Usage**: automatic extraction from newly submitted human messages.

All three default to enabled. Turning off a scope stops both recall and model/automatic
writes to that scope. Existing entries remain available in the management page.
Turning off learning leaves manual tools and recall available. Every entry can be
viewed, edited, exported to an editor document, or deleted. Clearing a store also
clears pending usage signals. Chat history is stored separately.

VS Code registers `kicadAgent.memory.globalEnabled`, `kicadAgent.memory.projectEnabled`
and `kicadAgent.memory.autoLearn` as application settings. Explicit changes are also
written to the shared local policy, so running terminal sessions see the next-turn
change. Shared settings files can supply a `memory` object:

```json
{"memory":{"globalEnabled":true,"projectEnabled":true,"autoLearn":false}}
```

The existing managed-settings layer still takes precedence. Explicit editor settings
take precedence over shared file values for that editor.

## Writing and provenance

Only host-submitted root human messages can teach automatic preferences. Claude SDK
and Codex use `SessionContinuity.recordInput`; the terminal uses `chat.message` after
checking that the session has no parent. System transforms retrieve memories but do
not import old conversations. Quoted documents, prior-conversation blocks, code
blocks, tool results, synthetic messages and child-agent prompts are excluded.

The deterministic extractor recognizes Chinese/English reply language and concise/
detailed reply style. An explicit durable request takes effect immediately. Implicit
corrections require three distinct sessions; many messages in one session count as
one signal. Explicit preferences outrank inferred ones. For equal provenance,
project preferences take precedence over global preferences. Other facts require an
explicit “请记住 / remember that” request and default to project scope; “全局 / 跨项目 /
globally / all projects” opts a fact into global scope. Automatic extraction rejects
credential/sensitive topics and never learns execution authority.

`local_memory` retains list/search/read/append/replace/delete and adds `scope`, `kind`
and an optional optimistic `version`. Tool-generated notes are labeled `model` with
lower confidence; they are not labeled verified merely because a model saved them.
Automatic records carry client, source, timestamps, confidence, version and session/
message evidence references. Raw transcripts and tool output are not automatically
stored. Credentials in manual notes are redacted.

## Recall and lifecycle

Recall matches English tokens and Chinese character pairs, prioritizes explicit
preferences and project scope, and injects at most eight records within a 6,000
character record budget. It uses no embedding service, extra model call or network.
It is lexical retrieval, not general semantic search. The injected JSON is escaped
and labeled untrusted historical reference data. Current instructions and evidence
take precedence. The original human request remains the sole delegation boundary.
Selected records enter the current model context and travel with that request to
the configured provider.

Storage lives under `<history-root>/memory/global/memory-v2.json` and
`<history-root>/memory/<workspace-sha256-prefix>/memory-v2.json`. The history root
defaults to `~/.local/share/kicad/history`; XDG_DATA_HOME and KICAD_HISTORY_DIR work as
before. Legacy workspace `memory.jsonl` notes remain readable and migrate on the
first mutation; v2 wins thereafter, including after deletion. No third-party memory
folders or existing chat logs are imported.

Each store has a 256 KiB cap, private directories/files (0700/0600 on creation),
exclusive process locking and atomic replacement. Records are local JSON protected
by OS file permissions, not application-level encryption. Replacements check the
version when supplied. Duplicate notes are merged. Episodic notes expire after 30
days, procedural and inferred preferences after 180 days. Expired entries are
excluded immediately and physically pruned on the next mutation.

Deletion removes the body, clears pending signals and keeps bounded content hashes
and message fingerprints to prevent recent history/model replay from recreating it.
Clear also changes the store generation to invalidate pending observations. The
user can explicitly restore an entry through the management page. There is no
retrieval cache to invalidate. Memory failures are diagnostic events and do not
prevent an otherwise authorized task or recall of readable existing entries.

## Validation

```sh
node --test tools/ai/composer/test/*.test.mjs
bash tools/ai/Kicad-terminal/build-session-runtime.sh
node tools/ai/Kicad-terminal/test-memory.mjs
node tools/ai/Kicad-terminal/test-session-runtime.mjs
node tools/ai/Kicad-extension/test-memory.mjs /path/to/overlaid-build
PLAYWRIGHT_MODULE=/path/to/playwright node tools/ai/Kicad-extension/test-memory-ui.cjs /path/to/overlaid-build
```

Host tests cover provider profiles through the actual shared hooks and both adapter
registrations. The production webview test exercises real temporary storage through
a simulated VS Code message bridge. Neither is a live model-API acceptance test.
