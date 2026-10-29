Kicad terminal 0.2.4 adds the shared user and project memory available in extension 0.4.68. Memory is recalled by task, respects live global/project/learning switches, and does not grant tool or sub-agent authorization.

The terminal settings overlay now includes its history dependency. A regression check loads the shipped module and verifies live memory switches before the native build.

Validation: shared composer 65 passing tests; terminal memory and orchestration checks; terminal UI 212 passing tests and one skip; update/lazy-tool/status checks 11 passing tests; package configuration 4 passing tests; clean-cache npx and isolated global install, full payload hashes, 22 commands, backend references and embedded Web UI. Model coverage uses local fixtures, with no live model API calls.

The official npm registry publish attempt was rejected by E403, requiring account two-factor authentication or an appropriately permitted granular token. At publication time npm `latest` remains 0.2.0.

Run the verified 0.2.4 GitHub package directly:

```sh
npx --yes --package=https://github.com/xiehaibo11/kicad/releases/download/kicad-code-v0.2.4/-kicadai-kicad-code-0.2.4.tgz Kicad
```

The package supports macOS Apple Silicon and Node.js 22+.
