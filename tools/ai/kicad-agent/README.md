# kicad-agent

AI-native KiCad automation terminal.  This is a downstream fork/extension of
[`easyeda-agent`](../upstream/easyeda-agent) (MIT, pinned as a git submodule).
It keeps the upstream's design-spec, circuit-block, and typed-action patterns,
but replaces the EasyEDA WebSocket connector with KiCad's protobuf API and
`kicad-cli`.

## Build

Requirements: Go (the version in `go.mod`; the toolchain may be downloaded
automatically), network access for module downloads on the first build, and a
C toolchain only for the IPC build.  The binary is written to
`bin/kicad-agent` (`bin/kicad-agent.exe` on Windows).

```bash
cd tools/ai/kicad-agent

# CLI only (no NNG dependency)
make build

# With KiCad IPC support (requires NNG 1.x)
make build-ipc NNG_PREFIX=$HOME/kicad-deps/nng-install
```

The CMake target (`-DKICAD_BUILD_AI_AGENT=ON`) builds with `CGO_ENABLED=0`
unless `-DKICAD_BUILD_AI_AGENT_IPC=ON` is also set.

The CMake build also produces `kicad-stepcheck` next to the agent when
OpenCASCADE is available.  It performs exact STEP solid intersection for
`structural check --exact-step`.

## Use

```bash
kicad-agent actions --domain board
kicad-agent health
kicad-agent call board.drc.run --payload '{"input":"board.kicad_pcb","output":"drc.json","format":"json","timeoutMs":60000}'
kicad-agent pipeline run --spec design.spec.json --project ./my-project
```

Every command prints exactly one JSON envelope on stdout.  Logs go to stderr.

## Backends

| Backend | Transport | Examples |
|---|---|---|
| `cli` | `kicad-cli` subprocess | DRC, ERC, exports, render |
| `ipc` | protobuf over NNG | item CRUD, connectivity proof, stackup |
| `external` | allowlisted subprocess | Freerouting, ngspice, mechanical checks |
| `offline` | local Go packages | spec validation, circuit blocks |
| `composite` | orchestrator | design pipeline |

## Relationship to upstream

- Upstream is the source of the S0 spec schema, circuit-block library, and
  design workflow inspiration.
- The EasyEDA connector/daemon is **not** used; KiCad has its own API.
- The upstream workflow state is EasyEDA-specific, so `kicad-agent` uses a
  KiCad-native stage machine (`.kicad-agent/workflow.json`).

## Status

The action catalog exposes only capabilities that are implemented or have a
clear implementation path.  Implemented PCB features include autoplace,
inner-layer planes, via-in-pad/dog-bone fanout, L-router autorouting, parallel
differential-pair routing, length reporting, batch DFM width/angle fixes,
IPC-2141 impedance analysis and checks, and a 2.5D structural check.  The
router, fanout, and structural checks report `verified: false` or their
limitations; always follow with DRC and connectivity verification.
