// Optional live check: sends one prompt optimization request using configured
// credentials. Run with the installed VSIX as extensionDevelopmentPath.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('kicad-agent.kicad');
  const api = await extension.activate();
  const instantiation = api.getInstantiationService();
  const serviceId = [...instantiation._services._entries.keys()].find(id => String(id) === 'claudeAgentService');
  assert.ok(serviceId, 'Agent request service is registered');
  const agent = instantiation.invokeFunction(accessor => accessor.get(serviceId));
  const original = '我只需要了解 PCB 或原理图里的 U1 和 R1（10 kΩ）相关问题，不要修改文件，也不要布线。先用 kicad-agent MCP 检查，再给我验证步骤。';
  const response = await agent.processRequest({ type: 'request', requestId: 'optimizer-live-check', request: { type: 'optimize_prompt', text: original, model: 'deepseek-flash' } }, new AbortController().signal);
  assert.equal(response.type, 'optimize_prompt_response');
  assert.equal(response.model, 'deepseek-flash');
  assert.ok(response.text.length > 10);
  assert.match(response.text, /U1/);
  assert.match(response.text, /R1/);
  assert.match(response.text, /10\s*kΩ/);
  const result = { version: extension.packageJSON.version, liveModel: response.model, original, optimized: response.text, requestRoute: 'optimize_prompt', chatMessagesSent: 0 };
  fs.writeFileSync(process.env.KICAD_OPTIMIZER_TEST_RESULT, JSON.stringify(result, null, 2) + '\n');
  console.log('Live prompt optimizer request passed. Model: ' + response.model);
};
