# Single-window project workspace

Opening the project's schematic or PCB from the KiCad manager creates an editor
page in the manager's notebook. The project tree remains available while switching
between Start, Schematic and PCB. Editor objects stay alive when their pages are
hidden; opening an existing editor selects its page.

The schematic page includes a second row of sheet tabs. These use the native
hierarchy-navigation action, including cancellation of active tools, selection
clearing and restoration of the destination sheet's view. Sheets share the same
schematic model and undo history. The project tree can also navigate to a child
sheet without opening that file as a separate root schematic.

The selected editor supplies the application menus. A tab's close button invokes
its normal close handler, including unsaved-change prompts. Closing the manager
still closes the project's editors through KIWAY. Short tab captions retain the
modified marker; hover over a tab for its full document title.

Standalone editor launches remain independent windows. For troubleshooting,
`KICAD_SINGLE_WINDOW=0` restores independent schematic and PCB windows when
launching the manager. This does not change project files.

## Build and acceptance checks

```sh
cmake --build build --target kicad eeschema pcbnew kicad-cli \
  gerbview pl_editor cvpcb_kiface pcb_calculator bitmap2component --parallel 8
```

Restart the native application after rebuilding. Use a disposable copy of a
hierarchical demo such as `demos/pic_programmer` and a separate `KICAD_CONFIG_HOME`
for acceptance testing:

- Open the schematic and PCB: both must be pages of one manager window.
- Switch root/child sheet tabs and use the project tree: the current sheet and
  canvas must agree, with the sheet's previous zoom restored.
- Switch Schematic/PCB/Start: verify the menus and tool commands match the page.
- Modify the test copy, close its tab, and cancel: the document must remain open.
- Close/reopen editor tabs and switch projects without crashes or stale menus.
- Read both documents through native IPC while switching pages.

IPC remains a direct connection to the native editor process. The notebook is a
window host, not a transport or an additional service.

## Verified on macOS, 2026-10-22

The targets above build successfully. An isolated `pic_programmer` copy verified
root/child navigation, Schematic/PCB/Start switching, editor menus, closing and
reopening an editor, and a modified document's close prompt. Cancelling that
prompt preserved its modified state; saving and quitting then completed normally.

The RK3308B project was opened in the rebuilt manager with eight sheet tabs and
a PCB tab. Selecting DDR updated both the canvas and IPC's active sheet to
`/DDR/`. Both open documents reported `DMS_UNMODIFIED`; hashes of the eight
schematics and PCB were unchanged. Windows and Linux UI behavior has not yet
been verified.
