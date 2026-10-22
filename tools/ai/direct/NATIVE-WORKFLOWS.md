# KiCad native workflow contracts

All 79 formerly deferred operations execute inside the terminal or extension
process, using native IPC, native CLI jobs or native file transactions.
The catalog has 335 actions, 130 IPC mappings (125 unique native requests),
20 frontend tool definitions and 971 GUI action descriptions.

Use the kicad_actions tool or CLI actions command to inspect the full inputSchema.
Live identities are KiCad KIID and Library:Item IDs. Positions explicitly use
millimetres or nanometres. Platform cloud projects and external UUIDs are removed.

## Behavior

- File edits require affected documents to be closed, reject overwrites, compare
  source hashes, preserve recoverable backups and read the result back. Child
  sheet deletion removes the parent link and preserves the child source file.
- schematic.page.open returns a verified native sheetPath context for subsequent
  IPC requests, including child sheets. GUI viewport navigation is not requested.
  schematic.rename updates an explicitly supplied parent link atomically.
- Images use native PCB reference images or schematic images (PNG/JPEG). Image
  exports and snapshots are native SVG renders. GUI filter reads require a GUI.
- Symbol replacement preserves pin identities and geometry. Pin disconnect uses
  exact wire IDs and rejects ambiguous junction, label and crossing cases.
- Differential pairs require native paired net names. Pair and skew groups edit
  workflow-owned custom rules. Creating a net class preserves other classes;
  assign nets using native labels or project patterns.
- Specctra DSN export and SES import call C++ handlers with undo support.
  Beautification merges safe collinear segments and defaults to preview, protecting
  branch, pad, locked and net geometry. Via hop creation checks native clearances.
- SVG silk import accepts explicit units/viewBox and outline geometry: line,
  rectangle, circle, polyline, polygon and M/L/H/V/C/Z paths. Unsupported CSS,
  transforms, embedded resources, text and external content fail explicitly.
- Zone refill, reports, DRC/ERC and connectivity return native evidence and do
  not certify fabrication. Notifications use a frontend callback or terminal output.

## Operations

Full contracts are saved in the acceptance evidence directory. Conditional keys,
alternative selectors, units and optional parameters are in each inputSchema.

| Action | Required top-level keys |
| --- | --- |
| `board.copy` | See inputSchema alternatives |
| `board.create` | See inputSchema alternatives |
| `board.current` | See inputSchema alternatives |
| `board.delete` | `confirm` |
| `board.list` | See inputSchema alternatives |
| `board.new_pcb` | See inputSchema alternatives |
| `board.rebind` | `project` |
| `board.rename` | See inputSchema alternatives |
| `library.footprint.build` | See inputSchema alternatives |
| `library.footprint.copy` | `output` |
| `library.footprint.create` | See inputSchema alternatives |
| `library.footprint.delete` | `confirm` |
| `library.footprint.get` | See inputSchema alternatives |
| `library.footprint.region_create` | `points` |
| `library.list` | See inputSchema alternatives |
| `library.symbol.build` | `name` |
| `library.symbol.create` | `name` |
| `library.symbol.delete` | `name`, `confirm` |
| `library.symbol.export_source` | `name` |
| `pcb.beautify` | `document` |
| `pcb.board.info` | See inputSchema alternatives |
| `pcb.component.attrs_backfill` | `document`, `schematic` |
| `pcb.components.arrange` | `document`, `ids`, `position` |
| `pcb.config.set` | See inputSchema alternatives |
| `pcb.constraint.list` | See inputSchema alternatives |
| `pcb.differential_pair.create` | `document`, `name`, `positiveNet`, `negativeNet`, `gapMm`, `widthMm` |
| `pcb.differential_pair.delete` | `document`, `name` |
| `pcb.differential_pair.rename` | `document`, `name`, `newName` |
| `pcb.equal_length_group.add_nets` | `document`, `name`, `nets` |
| `pcb.equal_length_group.create` | `document`, `name`, `nets`, `maxSkewMm` |
| `pcb.equal_length_group.delete` | `document`, `name` |
| `pcb.export.dsn` | `document`, `output` |
| `pcb.image.create` | `document`, `position` |
| `pcb.image.delete` | `document` |
| `pcb.image.list` | `document` |
| `pcb.image.modify` | `document` |
| `pcb.import_autoroute` | `document`, `file` |
| `pcb.import_changes` | `document` |
| `pcb.net_class.create` | `name` |
| `pcb.net_class.list` | See inputSchema alternatives |
| `pcb.net.color.set` | `net`, `color` |
| `pcb.page.clear` | `document`, `confirm` |
| `pcb.pour.rebuild` | `document` |
| `pcb.report` | `document` |
| `pcb.route.via_hop` | `document`, `start`, `end`, `via1`, `via2`, `layer`, `hopLayer`, `net` |
| `pcb.silk.align` | `document`, `ids`, `coordinateMm` |
| `pcb.silk.import_svg` | `document` |
| `pcb.silk.label_pads` | `document` |
| `pcb.silk.netnames` | `document` |
| `pcb.snapshot` | `document`, `output` |
| `pcb.stackup.set` | `document`, `stackup` |
| `pcb.view.filter.get` | See inputSchema alternatives |
| `project.create` | `directory`, `name` |
| `schematic.attribute.inspect` | `document` |
| `schematic.attribute.move` | `document`, `field`, `position`, `expectedSha256` |
| `schematic.bridgeCheck` | `document` |
| `schematic.check` | `document` |
| `schematic.component.replace` | `document`, `libId` |
| `schematic.designators.list` | `document` |
| `schematic.export.image` | `document`, `output` |
| `schematic.group.move` | `document`, `ids`, `delta` |
| `schematic.image.create` | `document`, `position` |
| `schematic.image.list` | `document` |
| `schematic.image.modify` | `document` |
| `schematic.page.clear` | `confirm` |
| `schematic.page.create` | `page`, `name` |
| `schematic.page.delete` | `confirm` |
| `schematic.page.open` | See inputSchema alternatives |
| `schematic.page.rename` | `newName` |
| `schematic.pages.list` | See inputSchema alternatives |
| `schematic.pin.disconnect` | `document`, `pin`, `wireIds` |
| `schematic.power.connect_pin` | `document`, `pin`, `net` |
| `schematic.rebind.footprint` | `document`, `libId` |
| `schematic.rebind.symbol` | `document`, `libId` |
| `schematic.rename` | See inputSchema alternatives |
| `schematic.titleblock.get` | `document` |
| `schematic.titleblock.modify` | `document`, `titleBlock` |
| `schematic.visible_text.bboxes` | `document` |
| `system.notify` | `message` |
