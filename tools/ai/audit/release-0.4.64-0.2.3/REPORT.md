# KiCad AI release verification: extension 0.4.64 and terminal 0.2.3

Verified: 2026-10-23T10:40:05+00:00

Rebuilt the current source, including the updated extension settings, installed both products locally, and published both GitHub releases.

## Published products

| Product | Version | Public release | Local installation |
| --- | --- | --- | --- |
| VS Code / Cursor extension | 0.4.64 | [GitHub release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-extension-v0.4.64) | Installed and registered in both editors |
| Terminal / npm archive | 0.2.3 | [GitHub release](https://github.com/xiehaibo11/kicad/releases/tag/kicad-code-v0.2.3) | Standalone installation and global npm installation upgraded |

Both releases reference source commit [`0197fd4cd801833e1d3473861cc7303e4e505377`](https://github.com/xiehaibo11/kicad/commit/0197fd4cd801833e1d3473861cc7303e4e505377), pushed on `codex/release-settings-0.4.64`. Both releases are public, not drafts or prereleases. All final assets, including verification reports and SHA256SUMS, were confirmed uploaded and matched against local size and SHA256 digest.

## Build and regression verification

- Full extension build passed: TypeScript/Vue checks, production frontend/backend bundles, build regression checks, and packaged bundle loading.
- Full terminal build passed in an isolated, pinned source checkout, including embedded Web resources.
- Shared composer: 55 passed.
- Direct backend: 64 passed; 6 live IPC tests skipped.
- Membership: 3 passed.
- Terminal TUI: 212 passed; 1 skipped.
- Terminal KiCad-specific checks: 11 passed.
- npm launcher: 4 passed.
- Build manifest verification passed for both distributions.
- Production settings UI passed Skills, Slash, Hooks, Plugins, MCP/synchronization toggles, and permission cleanup checks.
- Slash menu fixtures passed for Claude, DeepSeek, Codex, and a custom compatible provider without issuing model requests while browsing.
- A real VS Code host passed the production router checks, including native editor documents for doctor/MCP output and zero terminals created by that test.
- Execution, image, IN/OUT, and copy UI checks passed, including a 320px layout without overflow. Tool counts were absent and editor tabs did not open automatically.
- The tested executable/frontend payload hashes matched the final VSIX.

These are build, fixture, local host, and packaging checks. They do not establish live inference parity across all models or live PCB/schematic design acceptance. No paid model inference was run for this release verification.

## Installation verification

- VS Code: `/Users/mosc/.vscode/extensions/kicad-agent.kicad-0.4.64`.
- Cursor: `/Users/mosc/.cursor/extensions/kicad-agent.kicad-0.4.64`.
- For each editor, 1,218 installed files matched the final VSIX; only installer-owned `package.json.__metadata` was excluded from the comparison.
- Editor settings checksums were unchanged by installation.
- Standalone terminal: `/Users/mosc/.local/bin/Kicad`, runtime and shared assets installed alongside the existing standalone distribution.
- Global command: `/opt/homebrew/bin/Kicad`, package `/opt/homebrew/lib/node_modules/@-kicadai/kicad-code`; all 581 manifest payload files verified.
- The normal PATH command reports `Kicad --version` as `0.2.3`.
- Both terminal installations passed local `doctor prompt-audit` invocation.

Running editor windows were not reloaded. Reload VS Code or Cursor after the current task finishes to activate extension 0.4.64.

## Public download and clean install acceptance

Both main archives were downloaded anonymously from their public GitHub URLs. Their sizes and SHA256 hashes matched the local final artifacts.

The terminal package passed clean-cache npx, global installation, and repeat installation without `--force`, using its public GitHub tarball in an isolated HOME/cache. Verification covered all 32 command case variants, retention of the 22 original commands, 581 manifest payload files, eight lazily discovered bundled skills, capability search pagination and selected skill body loading, bundled native transport, reference calls through CLI and in-process JavaScript, healthy headless server, embedded Web HTML/JavaScript, no startup task, existing model/settings preservation, and an installation prefix containing spaces.

## Artifact hashes

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `kicad-0.4.64.vsix` | 34,660,983 | `ff309cfc00ae7a8de3feafdc29acb941818fbfdc1b0cd875c55e746c52b62074` |
| `-kicadai-kicad-code-0.2.3.tgz` | 47,499,525 | `40ff1d9794775851b93f6674adc247cc9b427c0e56d636141e6b8234bf70ef2a` |

## Publication limits and workspace preservation

GitHub Releases are published. The npm registry was not updated: `npm whoami` returned E401 Unauthorized; registry `latest` was observed at 0.2.0. The global local installation used the rebuilt tarball. VS Code Marketplace publication was not performed.

The active branch remains `feature/ai-automation` at `4f5fbd4b1ac13ccdbeb17628144f734a2a9d360b`, with the user's existing dirty worktree preserved and no staged files introduced. Release source was assembled with an isolated temporary Git index. Audit/cache/dist material, local credentials/provider configuration, private prompt documents, and unrelated edits were excluded from the source release commit.

## Evidence

- [Final public release assets and digest verification](final-release-verification.json)
- [Anonymous download verification](public-download-verification.json)
- [Public package clean install acceptance](github-npm-acceptance.json)
- [Local installation comparison](installed-verification.json)
- [Terminal installed payload comparison](terminal-installed-payload.json)
- [Tested UI versus final VSIX comparison](ui-tested-payload.json)
- [Workspace preservation](workspace-preserved.json)

Build, test, installation, and publication logs are retained in this audit directory. Release-specific verification files and checksums are also attached to the public GitHub releases.
