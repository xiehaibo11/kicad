# Kicad terminal distribution

The npm launcher and KiCad automation backend are distributed under
GPL-3.0-or-later. The complete license is in LICENSE. Component licenses remain
in force; this distribution does not replace upstream copyright notices.

- OpenCode 1.19.3: MIT, https://github.com/anomalyco/opencode,
  commit e3c4eb242585dcd77be1a867391b7c25fd47ce52.
- KiCad and shared JavaScript tools: GPL-3.0-or-later,
  https://github.com/xiehaibo11/kicad. KiCad GUI is a separate prerequisite.
- Reference circuit-block data: MIT,
  https://github.com/zhoushoujianwork/easyeda-agent.
- jsonc-parser 3.3.1: MIT, https://github.com/microsoft/node-jsonc-parser.

Component and dependency notices are retained in licenses/. The native
runtime's embedded Web UI is included. This npm package does not bundle the
proprietary Claude Code runtime. External model services and EDA applications
keep their own terms.

Corresponding source and build instructions are available in the public
repository (tools/ai/Kicad-terminal and tools/ai/direct), including the
pinned upstream source references, lockfiles, integration overlays and tests.
Release tags and SHA256SUMS identify the delivered package.
