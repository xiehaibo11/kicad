// Run against the packaged extension in a real VS Code Extension Test Host:
// code --user-data-dir /tmp/kicad-test-profile --disable-extensions
//   --disable-workspace-trust --extensionDevelopmentPath=/path/to/installed-extension
//   --extensionTestsPath=/absolute/path/to/this/file /path/to/workspace
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

exports.run = async () => {
  const progress = stage => fs.writeFileSync(process.env.KICAD_HOST_TEST_RESULT + '.progress', stage+'\n');
  progress('activate');
  const extension = vscode.extensions.getExtension('kicad-agent.kicad');
  assert.ok(extension, 'The packaged KiCad extension must be loaded');
  assert.equal(extension.packageJSON.displayName, 'Kicad');
  assert.equal(extension.packageJSON.contributes.views['kicad-sidebar'][0].name, 'Kicad');
  const api = await Promise.race([extension.activate(),new Promise((_,r)=>setTimeout(()=>r(new Error('activation timeout')),15000))]);
  progress('show chat');
  async function waitFor(predicate, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out: ' + description + ': '+JSON.stringify(api.getWebviewReadiness()));
  }
  void vscode.commands.executeCommand('kicad.showChat');
  progress('wait mounted');
  await waitFor(() => api.getWebviewReadiness().mounted >= 1, 'chat frontend mounted');
  progress('open settings');
  void vscode.commands.executeCommand('kicad.openSettings');
  await waitFor(() => api.getWebviewReadiness().mounted >= 2, 'settings frontend mounted');
  progress('start terminal');
  await vscode.commands.executeCommand('kicadAgent.startOpenCode');
  const terminal = vscode.window.terminals.find(item => item.name === 'Kicad 终端');
  assert.ok(terminal, 'Native terminal was created');
  assert.equal(path.basename(terminal.creationOptions.shellPath), 'kicad-terminal');
  const inline = JSON.parse(terminal.creationOptions.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(inline.mcp?.kicad, undefined);
  assert.equal(inline.mcp?.easyeda, undefined);
  assert.ok(inline.plugin.some(item => String(item).includes('session-runtime.mjs')));
  const healthPromise = vscode.commands.executeCommand('kicadAgent.health');
  // Health can finish after IPC timeout; close the result picker when it actually appears.
  const closePicker=setInterval(()=>void vscode.commands.executeCommand('workbench.action.closeQuickOpen'),200);
  let health;
  try {health = await Promise.race([healthPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native health command timed out')),20000))]);}
  finally {clearInterval(closePicker);}
  assert.equal(health?.ok,true,'Health must execute in-process, even without the compatibility Node command');
  const pid = await terminal.processId;
  assert.ok(pid > 0, 'Native terminal has a process');
  assert.equal(terminal.exitStatus, undefined, 'Terminal must remain running after native health verification');
  const result = {
    ok: true,
    version: extension.packageJSON.version,
    displayName: extension.packageJSON.displayName,
    active: extension.isActive,
    webviews: api.getWebviewReadiness(),
    nativeTerminal: { name: terminal.name, pid, binary: terminal.creationOptions.shellPath },
    nativeToolPluginEnabled: true,
    inProcessHealth: {ok:health.ok,action:health.action,cliAvailable:health.data.cli.ok},
    availableTerminalProviders: Object.keys(inline.provider ?? {})
  };
  const destination = process.env.KICAD_HOST_TEST_RESULT || path.join(__dirname, "audit", "composer-installed-host.json");
  if (destination) fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
  console.log('KiCad real VS Code host checks passed: ' + JSON.stringify(result));
  terminal.dispose();
};
