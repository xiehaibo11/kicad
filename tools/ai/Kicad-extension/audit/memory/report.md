# Local memory verification — 2026-10-23

Implemented in the shared composer layer, terminal plugin and extension overlay.
Production sources were built in an isolated temporary upstream checkout with the
local overlay. No installed extension or published release was replaced.

## Results

| Check | Result |
| --- | --- |
| `node --test tools/ai/composer/test/*.test.mjs` | 65/65 passed |
| Terminal session runtime bundle | Passed |
| `test-memory.mjs` and `test-session-runtime.mjs` in the terminal adapter | Both passed |
| Extension `tsc --noEmit` and webview `vue-tsc --noEmit` | Both passed |
| Production Vite and extension builds | Passed |
| All 29 extension checks listed in `build.sh`, including bundle validation | Passed |
| `test-memory-ui.cjs` against the production webview and real temporary memory stores | Passed |
| `git diff --check` | Passed |

The older overlay and lazy-tools test loaders were updated to resolve newly shared
TypeScript modules. Their reruns passed. Vite reported its existing CommonJS config
and large-chunk warnings; neither prevented a successful build.

## Behavior exercised

- Independent global, project and automatic-learning switches; disabled scopes
  stop recall and automatic/model writes, while management remains available.
- Shared extension/terminal policy readback without restarting a terminal.
- Explicit preferences, three-session inference, project isolation, provenance,
  conflict precedence, optimistic edits, deduplication and bounded recall.
- Secret redaction, quoted/history/code exclusion, child/synthetic-input exclusion,
  and preservation of the explicit-request-only delegation gate.
- Atomic concurrent writes from five processes, old JSONL migration, expiration,
  body removal on deletion, replay resistance and explicit manual restoration.
- Global and saved-project management without an open workspace.
- Settings UI: switches, project list, search, edit/save, delete, add, export,
  clear and a 680 px viewport. Screenshots were visually reviewed.

## Evidence limits

Host and terminal tests exercised four provider profiles through the actual shared
hooks using fixtures. They did not call live Claude, DeepSeek, Codex or other model
APIs. UI tests used a simulated VS Code message bridge with real local storage in
a temporary directory, not an installed extension-host acceptance session. Test
memory and test policy files were removed after execution. No user conversation,
third-party memory folder or KiCad design was imported or modified.

The extractor currently learns Chinese/English reply language, concise/detailed
presentation preferences, and explicit remember requests. General project facts
and workflows can also be managed through `local_memory` and the settings page.
Recall is bounded lexical retrieval; there is no embedding service or model-weight
training. Selected recalled entries are sent with requests to the configured model
provider. Local JSON uses OS file permissions, not application-level encryption.

Screenshots: `settings.png`, `entries.png`, `narrow.png` (fixture data; ignored build
evidence, reproducible with `test-memory-ui.cjs`).
