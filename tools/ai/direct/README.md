# KiCad shared native tools

Terminal and extension use the same JavaScript handlers **in their own process**.

```text
KiCad terminal / extension tools
    → Runtime.dispatch(action, payload)
        → typed native KiCad IPC (Unix socket, protobuf, NNG REQ0)
        → native kicad-cli (fixed argument arrays)
        → local JavaScript workflows and checks
```

No Go executable, Go daemon, external EDA client, WebSocket connector or EDA
extension is required. IPC is the boundary to the C++ editor process, which owns
the live document; it is not an additional routing daemon. Native CLI processes
are used for exports and checks that KiCad implements as jobs.

`bindings.mjs` builds both frontend tool definitions from the same 20-tool
catalog. The terminal calls these handlers as native OpenCode plugin tools.
The extension uses the Claude SDK's in-process server interface. The external stdio relay entry has been removed. Mutating terminal tools ask
through the native permission system;
extension mutations retain SDK permission checks. Mixed domain tools are never
auto-approved as read-only.

## Build and use

Requires Node.js 22+ and Bun for bundling. The package carries its protobuf
runtime; users do not need protobuf or Go installations.

```sh
cd tools/ai/direct
npm ci --ignore-scripts
npm run generate
npm run build
node dist/kicad-direct.mjs manifest
node dist/kicad-direct.mjs actions --domain board
node dist/kicad-direct.mjs call board.items.get --payload '{"document":"/abs/board.kicad_pcb","types":["via"]}'
```

Environment: `KICAD_CLI` selects native CLI, `KICAD_API_SOCKET` selects the editor
socket, and `KICAD_API_TOKEN` supplies an optional IPC token. `KICAD_DIRECT` is
only the compatibility shell-entry override. Built-in terminal tools are bundled
from this source; the extension can override its bundle using
`kicadAgent.directPath`.

```js
import { Runtime, bindTools } from './dist/kicad-direct.mjs';
const runtime = new Runtime({ binary: '/abs/kicad-cli', socket: '/tmp/kicad/api.sock' });
try {
  const result = await runtime.dispatch('system.ping', {});
  console.log(result);
} finally { runtime.close(); }
```

## Coverage and failure behavior

The migrated catalog exposes 333 available actions (two retired HPGL entries are excluded), including 130 typed IPC mappings,
57 CLI mappings and local routing, planes, fanout, impedance, schematic generation,
workflow, pipeline, DFM, audit, release evidence and web utilities. There are 971
native GUI action descriptions. GUI action submission is not proof of completion.

Unknown native fields, ambiguous documents, invalid enums, per-item native
failures, missing output files and incomplete readbacks fail explicitly. Partial
writes preserve created/updated IDs in the error evidence. Composite planning is
heuristic; native DRC/ERC, connectivity and current design evidence remain needed.
Release checks never convert a software check into fabrication certification.

The circuit blocks retain their original MIT attribution and circuit topology.
External device UUIDs and historical validation claims are excluded; native
library resolution and fresh verification are required.

`data/connector-audit.json` inventories all 170 handlers found in the original
1.14.0 connector archive. It distinguishes native capabilities from external
platform contracts and 79 implemented KiCad workflows. Those 79 operations expose native input
contracts and execute directly in both frontends. The remaining 72 capability
matches are audit references that require native parameters; they are not
executable compatibility aliases. See [native workflow contracts](NATIVE-WORKFLOWS.md). The old connector's
JavaScript is not loaded or shipped.

## Regeneration and tests

`generate.mjs` derives registered command pairs and protobuf descriptors from
this repository's C++ handlers and `api/proto`. The `scripts/` directory contains
CLI help, native UI text and engineering-example catalog generators. Review
catalog changes when native C++ APIs change.

```sh
npm test
KICAD_TEST_CLI=/abs/kicad-cli npm test
```

The optional native tests start isolated API servers with temporary boards and
hierarchical schematics, and parse generated symbol libraries with the native CLI.
They verify all 79 workflow contracts; GUI-only view state uses
`scripts/test-native-gui.mjs` against an isolated native PCB editor.
The basic board test creates, reads, changes and deletes a via, places a footprint, creates a rule
area and custom rule, runs DRC using a saved temporary copy, and exports SVG.
The original fixture is checked for byte equality. Tests also exercise protocol
fragments, deadlines, cancellation, schema validation, partial failures,
permission checks, routing obstacles, pipeline previews and evidence gates.

Third-party notice: circuit-block data originates from the MIT-licensed
`zhoushoujianwork/easyeda-agent` project; see `LICENSE-blocks-MIT.txt`. That
attribution does not imply a runtime dependency on its software or services.

## Automatic native connection

Both frontends connect directly to the native GUI. The default connection probes
`/tmp/kicad/api.sock`, discovers native `api-<pid>.sock` fallbacks, and starts
the KiCad GUI if no instance is available. Multiple fallback instances require
an explicit socket. Startup waits for native readiness; edits are never retried.
An explicit `KICAD_API_SOCKET` stays isolated and is never redirected.
`KICAD_GUI` can select the native GUI executable; installer CLI wrappers are
resolved without executing shell text. Set `KICAD_AUTO_CONNECT=0` to disable
automatic GUI launch. `project.open` uses the GUI's native OpenDocument handler
and no longer creates a headless API process. IPC connection and loaded-document
readiness are reported separately.
