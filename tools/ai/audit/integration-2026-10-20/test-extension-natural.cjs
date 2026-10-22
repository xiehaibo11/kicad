const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('kicad-agent.kicad');
  const api = await extension.activate();
  const instantiation = api.getInstantiationService();
  const serviceId = [...instantiation._services._entries.keys()].find(key => String(key) === 'claudeAgentService');
  const agent = instantiation.invokeFunction(accessor => accessor.get(serviceId));
  const channelId = 'kicad-natural-language-integration';
  const messages = [];
  const originalSend = agent.transport.send.bind(agent.transport);
  agent.transport.send = message => {
    if (message.channelId !== channelId) return originalSend(message);
    messages.push(message);
    if (message.type === 'request' && message.request.type === 'tool_permission_request') {
      const request = message.request;
      const allowed = request.toolName.startsWith('mcp__kicad__') &&
        (['project.list', 'project.resolve', 'system.manifest'].includes(request.inputs.action) ||
         ['mcp__kicad__kicad_actions', 'mcp__kicad__kicad_health'].includes(request.toolName));
      agent.handleResponse({type:'response', requestId:message.requestId, response:{type:'tool_permission_response', result:allowed ? {behavior:'allow', updatedInput:request.inputs, updatedPermissions:[]} : {behavior:'deny', message:'This test permits read-only project discovery only'}}});
    }
  };
  const prompt = '检查 KiCad API 服务连接和可用工具，然后列出当前目录的 KiCad 工程及完整路径。只进行读取。';
  try {
    await agent.launchClaude(channelId, null, vscode.workspace.workspaceFolders[0].uri.fsPath, 'deepseek-flash', 'default', 'off');
    agent.transportMessage(channelId, {type:'user', message:{role:'user', content:prompt}, parent_tool_use_id:null, session_id:''}, false);
    const deadline = Date.now() + 120000;
    while (!messages.some(entry => entry.type === 'io_message' && entry.message.type === 'result')) {
      if (Date.now() > deadline) throw Error('Natural language tool call timed out');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const result = messages.find(entry => entry.type === 'io_message' && entry.message.type === 'result').message;
    const toolUses = messages.flatMap(entry => entry.message?.message?.content || []).filter(part => part.type === 'tool_use');
    const projectCalls = toolUses.filter(part => part.name === 'mcp__kicad__kicad_health');
    fs.writeFileSync(path.join(__dirname, 'extension-natural.json'), JSON.stringify({version:extension.packageJSON.version, fixture:'installed extension, bundled SDK, actual configured DeepSeek model and real MCP, plain Chinese prompt', prompt, ok:!result.is_error && projectCalls.length > 0, toolUses, result}, null, 2));
    assert.equal(result.is_error, false);
    assert.ok(projectCalls.length > 0, 'Plain request must invoke the real KiCad health MCP tool');
  } finally {
    agent.closeChannel(channelId, false);
    agent.transport.send = originalSend;
  }
};
