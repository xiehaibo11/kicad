---
description: Generate a KiCad schematic from a circuit spec and run ERC
allowed-tools: Bash, Read
---
Read the circuit spec path from the arguments. Run
`kicad-agent sch generate --spec <spec> --project <dir>`.
If ERC reports violations, map each one back to the spec (missing PWR_FLAG,
unconnected pin, duplicate reference) and propose a spec change. Report the
placed components, net labels, and ERC result. $ARGUMENTS
