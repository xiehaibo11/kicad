## Install

```bash
cd tools/ai/vscode-extension
npm install
npm run compile
npx @vscode/vsce package --no-dependencies
code --install-extension kicad-agent-vscode-0.1.0.vsix
```

Configure `kicadAgent.path` (the `kicad-agent` binary), `kicadAgent.kicadCli`,
and optionally `kicadAgent.symbolDir` / `kicadAgent.footprintDir`.  Open a
`.kicad_pcb` or `.kicad_sch` file and run **KiCad: Start API Server for Active
Document**; the socket setting is updated automatically.  **KiCad: Stop API
Server** shuts it down.

# KiCad Agent for VS Code

A thin, local front end for the `kicad-agent` terminal.  It does **not** bundle
KiCad or an LLM: it invokes the configured `kicad-agent` / `kicad-cli` binaries
and reads their JSON results.

## Features

- **Action tree** — every typed KiCad action, grouped by domain; click to run.
- **DRC / ERC diagnostics** — run on the active `.kicad_pcb` / `.kicad_sch`
  and publish findings in the Problems panel, linked to the item UUID.
- **Schematic generation** — pick a circuit spec and run
  `kicad-agent sch generate`.
- **BGA fanout**, **DFM analyze/fix**, **impedance calculation**, **L-router
  autoroute**, and **2.5D structural check + STEP export**.
- **Ask the model** — runs the configured `settings.json` provider through the
  `kicad-agent ai` tool loop.
- **MCP configuration** — shows a ready-to-paste MCP server stanza.

## Requirements

- `kicad-agent` built from `tools/ai/kicad-agent` (or installed next to
  `kicad-cli`).
- `kicad-cli` and the KiCad editor kifaces for GUI-free jobs.
- For item-level actions, a running API server:
  `kicad-cli api-server <project-or-board> --socket /tmp/kicad/api.sock`.
- For **Ask the model**, a `~/.config/kicad-agent/settings.json` with a
  provider and the provider's API key in the environment.

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| `kicadAgent.path` | `kicad-agent` | Path to the terminal executable |
| `kicadAgent.kicadCli` | `kicad-cli` | Passed as `KICAD_CLI` |
| `kicadAgent.socket` | empty | Passed as `KICAD_API_SOCKET` |
| `kicadAgent.settings` | empty | Passed to `kicad-agent ai --settings` |
| `kicadAgent.timeoutMs` | `1800000` | Per-invocation timeout |

## Development

```bash
cd tools/ai/vscode-extension
npm install
npm run compile
```

Open the folder in VS Code and press `F5` (Run Extension) to launch an
Extension Development Host.  `npm run watch` recompiles on change.

## Scope

The extension is a convenience shell.  It inherits the CLI's limits: the
autorouter is an L-router baseline, DFM fixes only cover width/angle, fanout is
via-in-pad/dog-bone without escape search, and the structural check is 2.5D
(bounding boxes plus optional heights), not a mesh-level STEP collision.
