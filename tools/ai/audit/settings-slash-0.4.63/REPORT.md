# Slash menu restoration and shared settings — 0.4.63 / 0.2.2

The extension and terminal are locally built and installed. The current VS Code window was not reloaded; loading the new extension requires a window reload when the current task is finished. No marketplace, npm registry or GitHub release was published.

## Cause and behavior

The old slash provider depended on Claude SDK command discovery. An empty discovery result left the menu empty for other providers. The host now owns eleven core commands: `/model`, `/effort`, `/permissions`, `/tools`, `/skills`, `/mcp`, `/status`, `/doctor`, `/settings`, `/history`, `/new`.

Bare `/` is synchronous and independent of login, selected model and SDK discovery. `/tools` and `/skills` load bounded metadata pages (at most ten entries) and insert a draft when selected. `/tool:query` and `/skill:query` filter names. Browsing neither executes tools nor loads skill bodies nor contacts MCP servers. The tool browser lists built-in local tools; external MCP remains part of model-driven on-demand discovery. `/mcp` displays configuration names and enabled flags without credentials or connection details. Unknown project slash commands can still be sent normally. Natural-language tool invocation remains available.

Keyboard regression checks cover Enter, menu opening, late empty discovery, pagination, skill drafts and `/doctor prompt-audit` arguments. Local commands issue no model requests. Model and effort menus use existing controls and preserve the existing session switching behavior.

## Shared settings and operational scope

`composer/settings.ts` reads user, project, project-local, explicit host and managed settings. Managed settings are applied last; model denials are unioned, effort caps use the lowest applicable cap, and malformed settings fail closed. Main sessions and auxiliary requests enforce model policy. Model IDs support wildcards; unresolved aliases are rejected when a denial policy is configured.

Low-risk Auto defaults to enabled. The extension uses conservative local allowlists, while terminal defaults allow reads and edits and retain approval for unknown tools and shell operations. Explicit native permissions still win. This is not parity with Claude's proprietary Auto risk classifier.

`maxEffortLevel`, per-model caps, `maxProseWidth`, attribution opt-out and suggestion opt-out are documented in the extension README. `mcpVerification` controls shared-wrapper tool-call confirmation only, not TLS/authentication; direct native MCP permissions remain runtime-owned. Terminal and Codex do not have extra commit attribution added by this extension. WebFetch defaults to a five-minute total download deadline.

`Kicad doctor prompt-audit` prints local JSON without starting an interactive terminal, model or MCP server. Extension `/doctor` opens the static report inside the editor. This audits registered prompt sections and root instruction references; it does not semantically validate every dynamic prompt. The AI-plugin evaluation command checks installed Claude support and delegates actual `plugin eval` to a standard task terminal; no plugin benchmark was executed here and no native KiCad plugin/design certification is claimed.

Ultracode is an independent multi-agent workflow, not the Ultra effort tier. The bundled CLI 2.1.83 lacks this feature, so no nonfunctional Ultracode toggle is exposed. Native workflows are disabled defensively, while subagents require the independent feature setting and an explicit current human request. Research: [official workflows](https://code.claude.com/docs/en/workflows), [official model configuration](https://code.claude.com/docs/en/model-config), [Serverworks review](https://blog.serverworks.co.jp/2026/10/03/190000). Source-review evidence for the two requested repositories remains in [the earlier review](../claude-code-source-review-2026-10-22/REPORT.md).

## Validation

- Both extension TypeScript checks pass; production extension and webview bundle build and load.
- 23 extension regression scripts pass. Shared composer: 49 pass. Direct backend: 64 pass, six live-IPC tests skipped. Membership: three pass. npm launcher: four pass.
- Terminal type checks pass; TUI: 212 pass, one skipped. Terminal binary builds with its embedded Web UI. An upstream `client/promise` export omission is bridged to the existing generated Promise client.
- Production slash UI with simulated host: Claude, DeepSeek, Codex and a custom compatible model pass. Browsing sends zero model requests. Real VS Code host validates the packaged router, bounded catalog and editor reports; no terminal is launched.
- Reasoning UI tests check all eleven locally discovered Claude/Codex model entries. Local HTTP fixtures validate 71 installed-CLI model/effort requests plus 15 DeepSeek requests, across fourteen model IDs. A separate real Codex CLI Ultra case confirms the host policy removes native delegation tools and keeps delegation disabled.
- Packaged SDK/CLI forced-delegation regression: eight queries, eleven turns; unauthorized child requests = zero. It covers DeepSeek, Claude and a custom compatible name, explicit requests, refusal, subsequent ordinary turns and quoted-document instructions.
- Concurrent workspace changes adding progress/final-answer copy controls were preserved and tested with the execution, image preview and IN/OUT editor-link UI. No automatic editor opening, counter regression or narrow-screen overflow was observed.

All provider response fixtures run on localhost without external inference or provider charges. These results verify UI, host policy and protocol behavior; they do not establish live access, quota, quality or feature parity for every provider. Native KiCad design acceptance was outside this task.

### Model/effort request coverage

| Model | Tested levels |
| --- | --- |
| `claude-opus-5-5` | default_on, low, medium, high, xhigh, max |
| `claude-fable-5-1` | default_on, low, medium, high, xhigh, max |
| `claude-sonnet-5-5` | default_on, low, medium, high, xhigh, max |
| `claude-haiku-5-5` | default_on, low, medium, high, xhigh, max |
| `codex:gpt-6.1-sol` | default_on, low, medium, high, xhigh, max, ultra |
| `codex:gpt-6-astra` | default_on, low, medium, high, xhigh, max, ultra |
| `codex:gpt-6-sol` | default_on, low, medium, high, xhigh, max, ultra |
| `codex:gpt-6-luna` | default_on, low, medium, high, xhigh, max |
| `codex:gpt-5.6-sol` | default_on, low, medium, high, xhigh, max, ultra |
| `codex:gpt-5.6-terra` | default_on, low, medium, high, xhigh, max, ultra |
| `codex:gpt-5.6-luna` | default_on, low, medium, high, xhigh, max |
| `deepseek-flash` | default_on, off, low, high, max |
| `deepseek-v4-pro` | default_on, off, low, high, max |
| `deepseek-v4-flash` | default_on, off, low, high, max |

See [verification.json](verification.json) for artifact hashes and counts. The raw installed Codex CLI matrix records native behavior without KiCad policy; the separate `reasoning-codex-policy-local.json` records the actual policy override test. Do not interpret the raw matrix as permission for delegation in the extension.
