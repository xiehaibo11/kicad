// Verify the packaged native tools in an actual VS Code extension host.
// No provider credentials, intermediary Node command, or live design is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');

exports.run = async () => {
  const destination = process.env.KICAD_HOST_TEST_RESULT;
  assert.ok(destination, 'Set KICAD_HOST_TEST_RESULT to an isolated report path');
  const progress = stage => fs.writeFileSync(destination + '.progress', stage + '\n');
  const bounded = async (promise, label) => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out')), 15000);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    const extension = vscode.extensions.getExtension('kicad-agent.kicad');
    assert.ok(extension, 'The packaged KiCad extension must be loaded');
    progress('activate');
    const api = await bounded(extension.activate(), 'extension activation');
    assert.ok(extension.isActive);
    assert.equal(vscode.workspace.getConfiguration('kicadAgent').get('nodePath'),
      '/nonexistent/native-tools-do-not-use-node');
    progress('native health');
    let finished = false;
    const healthPromise = vscode.commands.executeCommand('kicadAgent.health')
      .finally(() => { finished = true; });
    const deadline = Date.now() + 20000;
    while (!finished && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    }
    assert.ok(finished, 'In-process health command must finish');
    const health = await healthPromise;
    assert.equal(health?.ok, true);
    assert.equal(health.data.cli?.ok, true, 'The actual native KiCad CLI must answer');
    progress('in-process tool catalog');
    const instantiation = api.getInstantiationService();
    const id = [...instantiation._services._entries.keys()].find(value => String(value) === 'claudeAgentService');
    const agent = instantiation.invokeFunction(accessor => accessor.get(id));
    const catalog = await bounded(agent.processRequest({type:'request', requestId:'native-host-catalog',
      request:{type:'tool_references'}}, new AbortController().signal), 'native catalog');
    assert.equal(catalog.type, 'tool_references_response');
    assert.equal(catalog.tools.length, 20);
    for (const tool of catalog.tools) assert.equal(JSON.parse(tool.schema).type, 'object');
    const report = {
      ok: true, version: extension.packageJSON.version, active: extension.isActive,
      inProcessHealth: {ok: health.ok, action: health.action, cli: health.data.cli.data,
        ipcConnected: health.data.ipc?.available},
      invalidCompatibilityNodePathIgnored: true,
      inProcessCatalog: {count: catalog.tools.length, names: catalog.tools.map(tool => tool.name)},
      automaticIntermediaryRemoved: true,
      webviewReadinessObserved: api.getWebviewReadiness(),
      scope: 'Native host activation, in-process health and tool catalog. Full chat UI and terminal creation are separate tests.'
    };
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    fs.writeFileSync(destination, JSON.stringify({ok:false, error:String(error), stack:error.stack}, null, 2) + '\n');
    throw error;
  }
};
