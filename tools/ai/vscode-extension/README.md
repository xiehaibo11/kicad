# KiCad lightweight extension

This legacy UI now imports the same JavaScript module as the main KiCad
extension and terminal. Action commands and its optional provider loop execute
inside the extension host. Only native KiCad jobs start native CLI processes.
The primary supported chat UI is `../Kicad-extension`.

Build and package with:

```sh
npm ci --ignore-scripts
npm run vscode:prepublish
npm run package
```

Configure `kicadAgent.kicadCli` and optionally `kicadAgent.socket`, `symbolDir`
and `footprintDir`. `kicadAgent.directPath` overrides the bundled shared module.
For chat, `kicadAgent.settings` selects the provider settings JSON; API keys are
read from its configured environment variable. Provider calls run in the
extension host and can be cancelled. No Go installation or daemon is required.

The native API server owns the live document. The extension can start
`kicad-cli api-server <document> --socket <path>` when explicitly starting the
server or sending a chat request. The native server is distinct from the removed
tool routing intermediaries. Commands expose DRC/ERC, library-resolved schematic
generation, routing previews, fanout, DFM, impedance and STEP workflows. Inspect
tool results and fresh native verification; heuristic plans are not engineering
acceptance.

The native tool configuration command displays the imported module and the
native CLI/socket settings. It does not generate or launch a routing server.
