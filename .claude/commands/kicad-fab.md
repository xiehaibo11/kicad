---
description: Produce fabrication outputs and a verification report
allowed-tools: Bash, Read
---
Run `kicad-agent pipeline run --spec <spec> --project <dir>`.
Then report each stage from `.kicad-agent/pipeline-report.json`, the DRC/ERC
counts, connectivity proof result, and the paths of Gerber, drill, position,
BOM, and STEP artifacts. Flag any failed or unimplemented stage. $ARGUMENTS
