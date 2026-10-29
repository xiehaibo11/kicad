# Kicad extension 0.4.68 — Local memory

Adds global and project memory, usage-based preference learning, bounded recall,
and a Memory settings page with independent switches and view/edit/export/delete controls.
The extension and its bundled terminal runtime share storage and live policy.

## Validation

- Shared composer: 65 tests passed.
- Terminal: memory and session-runtime checks passed.
- Extension: TypeScript, Vue typecheck, production build and all 29 build checks passed.
- Packaged webview: switches, project list, search, add/edit/delete/export/clear and narrow layout passed using real temporary stores and a simulated VS Code bridge.
- Real isolated VS Code extension host: 0.4.68 activated, all three settings registered, live policy updates passed, settings webview mounted.
- VS Code and Cursor: installed 0.4.68; all 1,218 payload files matched the VSIX. Only installer-owned package.json.__metadata was ignored.
- Original editor settings, Git index and active branch were preserved. Existing windows were not reloaded.
- Build manifest verified against current inputs and the VSIX.

Host and terminal tests cover four provider profiles through shared hooks. No live
Claude, DeepSeek, Codex or other model API request was made in this release run.
Preference extraction currently supports Chinese/English language, concise/detailed
presentation and explicit remember requests; retrieval is lexical. Local JSON is
protected by OS permissions. Recalled records enter configured model requests.

Distribution: GitHub Release. Reload existing editor windows when convenient,
then open Kicad Settings → Memory. No VS Code Marketplace publication is claimed.
