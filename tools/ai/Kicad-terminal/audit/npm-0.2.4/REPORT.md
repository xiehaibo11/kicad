# Kicad terminal 0.2.4

The npx package includes shared user/project memory from extension 0.4.68. The terminal overlay now copies the history module required by shared settings, with a shipped-module regression check.

Build and validation succeeded: 65 composer tests, 212 terminal UI tests (one skip), 11 terminal runtime tests, 4 package tests, memory and orchestration checks, native binary and embedded Web UI. Isolated npx/local installs verified 581 payload files and all 22 commands. Model checks use four local profiles; no live model API calls were made.

The source input hashes match commit `0c624cb06530b24c1213c6ce958e9cd8a03d2e82`. The active worktree, Git index and editor settings were preserved.

The official npm publish attempt was rejected by registry E403, requiring account two-factor authentication or an appropriately permitted granular access token. Local browser/CLI login alone does not satisfy publishing policy. npm latest is still 0.2.0 pending that account step.
