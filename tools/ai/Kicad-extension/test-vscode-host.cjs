// Run against the packaged extension in a real VS Code Extension Test Host:
// code --user-data-dir /tmp/kicad-test-profile --disable-extensions 
//   --disable-workspace-trust --extensionDevelopmentPath=/path/to/installed-extension 
//   --extensionTestsPath=/absolute/path/to/this/file /path/to/workspace
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('kicad-agent.kicad');
  assert.ok(extension, 'The packaged KiCad extension must be loaded');
  assert.equal(extension.packageJSON.displayName, 'Kicad');
  assert.equal(extension.packageJSON.contributes.views['kicad-sidebar'][0].name, 'Kicad');
  const api = await extension.activate();
  async function waitFor(predicate, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out: ' + description);
  }
  await vscode.commands.executeCommand('kicad.showChat');
  await waitFor(() => api.getWebviewReadiness().mounted >= 1, 'chat frontend mounted');
  await vscode.commands.executeCommand('kicad.openSettings');
  await waitFor(() => api.getWebviewReadiness().mounted >= 2, 'settings frontend mounted');
  await vscode.commands.executeCommand('kicadAgent.startOpenCode');
  const terminal = vscode.window.terminals.find(item => item.name === 'Kicad 终端');
  assert.ok(terminal, 'Native terminal was created');
  assert.equal(path.basename(terminal.creationOptions.shellPath), 'kicad-terminal');
  const inline = JSON.parse(terminal.creationOptions.env.OPENCODE_CONFIG_CONTENT);
  const mcp = inline.mcp.kicad;
  assert.equal(mcp.enabled, true);
  assert.equal(path.basename(mcp.command[0]), 'kicad-agent');
  assert.equal(mcp.command[1], 'mcp');
  const pid = await terminal.processId;
  assert.ok(pid > 0, 'Native terminal has a process');
  const result = {
    version: extension.packageJSON.version,
    displayName: extension.packageJSON.displayName,
    active: extension.isActive,
    webviews: api.getWebviewReadiness(),
    nativeTerminal: { name: terminal.name, pid, binary: terminal.creationOptions.shellPath },
    kiCadMcpEnabled: mcp.enabled,
    availableTerminalProviders: Object.keys(inline.provider ?? {})
  };
  const destination = process.env.KICAD_HOST_TEST_RESULT || path.join(__dirname, "audit", "composer-installed-host.json");
  if (destination) fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
  console.log('KiCad real VS Code host checks passed: ' + JSON.stringify(result));
  terminal.dispose();
};
