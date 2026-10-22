# KiCad terminal and extension

The terminal and VS Code extension share the native JavaScript implementation
in [direct](direct/README.md). Both call the handlers in process, then use native
KiCad IPC/CLI. Go, an external EDA client, daemon and connector extension are not
part of this call chain.

The current [live-project acceptance report](audit/live-project-2026-10-21/REPORT.md)
records extension 0.4.27, terminal 1.19.3 and the connected RK3308B project.
Both visible frontends completed native live checks and exports; the project's
DRC/ERC and release evidence still fail. Per-action cumulative coverage and
the exact limits of that verification are recorded in the report.

- `direct/`: typed native API, CLI argument validation, workflows, routing and
  engineering checks; 333 available actions and 20 tool definitions.
- `Kicad-terminal/`: complete native OpenCode terminal, built-in KiCad tools,
  task continuity and npm packaging.
- `Kicad-extension/`: Claudix-based chat and terminal integration, with in-process
  SDK tools loaded from the exact same shared bundle.
- `composer/`: shared intent and engineering instructions.
- `stepcheck/`: optional native OpenCASCADE STEP collision checker.

## Build

```sh
npm ci --ignore-scripts --prefix tools/ai/direct
node tools/ai/direct/generate.mjs
node tools/ai/direct/build.mjs
cmake --build build --target kicad-direct kicad-cli
bash tools/ai/Kicad-terminal/build.sh
bash tools/ai/Kicad-extension/build.sh
```

Build dependencies are Node.js 22+, Bun, pnpm and the normal native KiCad build
chain. There is no Go dependency. The terminal build targets macOS arm64 and
retains the complete terminal and embedded web UI. The extension is packaged as
`Kicad-extension/dist/kicad-*.vsix`.

## Native tool calls

The built-in frontends load all tools automatically; slash commands are optional.
Use `kicad_actions` to discover fields before calling a domain tool. Mutations
retain the frontend permission mode. The C++ editor owns live document state and
is accessed through its Unix-domain IPC socket.

For shell automation:

```sh
node tools/ai/direct/dist/kicad-direct.mjs health
node tools/ai/direct/dist/kicad-direct.mjs call reference.plan --payload '{"query":"PCB"}'
node tools/ai/direct/dist/kicad-direct.mjs call board.items.get --payload '{"document":"/abs/test.kicad_pcb"}'
kicad-cli agent manifest
```

`KICAD_CLI` selects the native executable; `KICAD_API_SOCKET` selects the IPC
socket. Native `kicad-cli agent` runs the shared JavaScript shell entry with Node.
The external stdio relay entry has been removed. Terminal and extension call
the shared handlers in their own process.

## Install and test

```sh
bash tools/ai/install.sh
node --test tools/ai/direct/test/*.test.mjs
KICAD_TEST_CLI=/abs/kicad-cli node --test tools/ai/direct/test/*.test.mjs
python3 tools/ai/Kicad-terminal/test-launcher.py
```

The installer writes into the user's chosen installation prefix. Building and
packaging do not install or publish releases. npm package preparation and
acceptance scripts are in `Kicad-terminal/npm/scripts/`.

The original connector's 170 handlers are inventoried in
[connector-audit.json](direct/data/connector-audit.json). Native equivalents
require KiCad parameters and units; external platform identities and browser
JavaScript are not supported. Circuit topology data is reference material and
requires fresh native library resolution and engineering verification.

Existing `.kicad-agent` state directories and the `kicad-agent.kicad` extension
identity are retained for user data and extension upgrade compatibility. They
do not refer to a Go program. Optional provider settings remain under
`~/.config/kicad-agent/settings.json` (example: `direct/settings.example.json`).

A clean test suite, DRC/ERC report or build is not fabrication approval. Review
revision-bound manufacturing evidence, connectivity and device validation as
required by the actual design.
