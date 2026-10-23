# Kicad extension 0.4.66: shared integrations and settings recovery

Source: `d7085b573ade6711d396d5d869131c09168bfd1a` (parent `c9331b47627df92032b7836a5ef2a051033e3793`). Build provenance matches all 256 source files covered by the build manifest. The release source commit was made with an isolated Git index, preserving the working branch, existing index and unrelated changes.

## Delivered behavior

- **MCP Servers → Sync from Other Tools → Codex Plugins / Claude Plugins** reuses standalone MCP definitions from installed, selected user plugins without copying or modifying their packages. Both plugin-source switches are off by default. Existing configured servers retain precedence.
- Portable `plugin.json` + `mcp.json`, compatibility `.codex-plugin/plugin.json` / `.claude-plugin/plugin.json` + `.mcp.json`, and Claude manifest inline/local JSON references use the existing MCP connector and on-demand catalog. Plugin-root variables and cwd resolve to the installed folder. Provider-safe names prevent collisions.
- Loading settings or reading plugin metadata starts no server. Tool discovery and execution use the shared model-independent catalog. Disabling a source applies to the next conversation; existing session lifecycle remains unchanged.
- Private host channels, authentication stores/helpers, host tool policies that cannot be preserved, remote MCP bundles, project plugin installations and out-of-package references are not imported. Unsupported definitions have a visible reason. A local cache alone grants no execution.
- Computer Control detects a missing settings schema before attempting writes, disables affected controls and offers a user-triggered **Reload Window**. It never reloads a window on activation. Settings are read explicitly from the user layer so workspace values cannot broaden app access during upgrades.
- Removed the unusable Locked-Screen switch and retained its explanation. Cua Driver continues to provide native app-window control. Chrome/Excel add-ins and browser extensions remain their own integrations.

## Settings error evidence

The installed 0.4.65 manifests already declared `kicadAgent.computer.allowedApps`. Logs showed repeated replacement/reload of the same extension version. An existing editor window retaining an older configuration registry is the likely explanation for the screenshot; the exact original renderer registry was not captured, so this is not asserted as a proven historical root cause. A unique 0.4.66 package plus explicit schema detection makes recovery actionable.

Both actual 0.4.66 Extension Test Hosts (VS Code and Cursor) registered `enabled`, `driverPath`, `anyApp` and `allowedApps`; they saved/read back Any App, Chrome, Excel and KiCad allowlists at user scope, with no workspace writes. The signed Cua service passed off/on/restart readback in both hosts. The production LaunchAgent was restored afterward; Accessibility and Screen Recording remain granted.

## Validation

- Full extension build, TypeScript, Vue TypeScript, build regression gates and packaged bundle checks: passed.
- Shared composer tests: **57 passed, 0 failed**. Includes plugin opt-in, package formats/precedence, source disabled behavior, project exclusion, private connections, path boundaries, policy preservation, ambiguous cache selection, names and unchanged source files.
- Real stdio MCP acceptance: production connector/catalog loads one disposable local plugin on demand, preserves schema/results and disconnects on revocation. No real third-party plugin server, model or user application was executed by that test.
- Production Computer Control and settings webview UI tests: passed, using simulated host responses. Checked plugin sync controls and unavailable reasons, no automatic reload, disabled stale-schema controls, user reload click, app toggles, service status and diagnostics. A test assertion was corrected to use the native disabled property; the packaged production code was unchanged.
- Real VS Code and Cursor hosts: passed final-VSIX settings registration and save/readback, signed service and permissions.
- Installed 0.4.66 in both VS Code and Cursor; **1,218 packaged files matched in each editor**, excluding editor-owned package metadata. Existing windows were left open without forced reload.
- Build manifest: verified source and artifact hashes.

No new cross-model screen-control matrix was run for this patch. The prior [0.4.65 release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.65) records 12 live model passes (Claude, Codex and DeepSeek) and Fable 5.1 blocked by usage credits. These are prior-version results, not an assertion that every model passed 0.4.66. This patch's new interoperability test exercises the common MCP transport without provider-specific logic.

## Reuse boundary on this computer

Metadata-only inspection found 12 selected plugin reports. Codex's computer-use MCP depends on a private host connection; its app-tools server requires original host policies. Registered spreadsheet app connections also belong to the original app. No enabled standalone server from those installed plugin selections was eligible for import. One otherwise standalone entry was disabled in the original selection. No source was enabled or original configuration changed by this release.

Enable Codex Plugins or Claude Plugins only for standalone definitions you want to use, then start a new conversation. Skills continue to use the existing Skills page. Shared definitions do not transfer Codex/Claude account grants, host sessions, browser extensions, Excel add-ins or locked-screen privileges.

## Installation and artifacts

VSIX SHA-256: `cff148dc2fb100664009af640f479c0048311930c472e12873c1f89fd8e158a0`.

Reload existing editor windows when convenient after upgrading to register the new settings schema. This release is distributed through GitHub; no Marketplace or npm publication was performed.

Sources: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference), [Claude Chrome integration](https://code.claude.com/docs/en/chrome), [OpenAI computer-use settings](https://learn.chatgpt.com/docs/computer-use).
