// Production services, same-session restarts and actual HTTP effort payloads.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 const inst=api.getInstantiationService(),id=[...inst._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=inst.invokeFunction(a=>a.get(id)),sdk=agent.sdkService,channelId='reasoning-live-fixture',messages=[];
 const oldEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport),config=vscode.workspace.getConfiguration('kicadAgent');
 await config.update('deepseek.baseUrl',process.env.KICAD_REASONING_URL,vscode.ConfigurationTarget.Workspace);
 await config.update('deepseek.apiKey','fixture-only',vscode.ConfigurationTarget.Workspace);
 const oldSecret=sdk.context.secrets.get;sdk.context.secrets.get=async()=>undefined;
 sdk.getMergedEnvironmentVariables=async()=>({...process.env,ANTHROPIC_BASE_URL:process.env.KICAD_REASONING_URL,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 agent.transport.send=m=>m.channelId===channelId?messages.push(m):oldSend(m);
 const results=()=>messages.filter(m=>m.type==='io_message'&&m.message.type==='result');
 async function waitFor(predicate){const until=Date.now()+30000;while(!predicate()){if(Date.now()>until)throw Error('reasoning fixture timeout '+JSON.stringify(messages.slice(-4)));await new Promise(r=>setTimeout(r,50))}}
 async function turn(name){const count=results().length;agent.transportMessage(channelId,{type:'user',message:{role:'user',content:'KICAD_REASONING_CASE '+name+'. Reply FIXTURE_OK without tools.'},parent_tool_use_id:null,session_id:''},false);await waitFor(()=>results().length>count);assert.equal(results().at(-1).message.is_error,false,JSON.stringify(results().at(-1)))}
 try{
  await agent.launchClaude(channelId,null,vscode.workspace.workspaceFolders[0].uri.fsPath,'deepseek-flash','bypassPermissions','low');
  await turn('low');const sessionId=agent.channels.get(channelId).sessionId;assert.ok(sessionId);
  const before=results().length;await agent.setThinkingLevel(channelId,'max');
  assert.equal(results().length,before,'changing effort must not send');
  assert.equal(agent.channels.get(channelId).sessionId,sessionId);assert.equal(agent.channels.get(channelId).permissionMode,'bypassPermissions');
  await turn('max');await agent.setThinkingLevel(channelId,'off');await turn('off');
  await assert.rejects(agent.setThinkingLevel(channelId,'medium'),/does not support/);
  assert.equal(agent.channels.get(channelId).thinkingLevel,'off');
  await agent.setThinkingLevel(channelId,'high');await turn('high');
  assert.equal(agent.channels.get(channelId).sessionId,sessionId);
  const report={ok:true,version:extension.packageJSON.version,completedTurns:results().length,sessionId,checks:['low/max/off/high reach HTTP','same conversation resumed','permission mode retained','invalid effort rejected','switching does not send'],fixture:'production VS Code services + bundled SDK/CLI + localhost model; no external model'};
  fs.writeFileSync(process.env.KICAD_REASONING_RESULT,JSON.stringify(report,null,2)+'\n');
 }finally{agent.closeChannel(channelId,false);sdk.getMergedEnvironmentVariables=oldEnv;agent.transport.send=oldSend;sdk.context.secrets.get=oldSecret}
};
