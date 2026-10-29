Adds local memory shared by the extension and bundled terminal runtime:

- Independent global memory, project memory and usage-learning switches.
- Recall relevant preferences and project notes across conversations and models.
- View, search, add, edit, export and delete memories from Settings → Memory.
- Preserve explicit-request-only sub-agent behavior and existing permissions.

Validation: 65 composer tests, 29 extension checks, terminal memory/session checks, production webview tests and a real isolated VS Code extension host passed. Installed payloads match in both VS Code and Cursor. Four provider profiles were exercised through shared hooks; this release did not make live model API calls.

Reload existing editor windows when convenient to activate 0.4.68. See REPORT.md and memory-validation.json for evidence and limits. Distribution is through this GitHub Release.
