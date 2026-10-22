// Actual installed extension service + bundled SDK/CLI against local models only.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 const instantiation=api.getInstantiationService(),id=[...instantiation._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(id)),sdk=agent.sdkService;
 const config=vscode.workspace.getConfiguration('kicadAgent');
 await config.update('deepseek.apiKey','fixture-only',vscode.ConfigurationTarget.Global);
 await config.update('deepseek.baseUrl',process.env.KICAD_FIXTURE_DEEPSEEK,vscode.ConfigurationTarget.Global);
 const base=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!k.startsWith('ANTHROPIC_')));
 const originalEnv=sdk.getMergedEnvironmentVariables;
 sdk.getMergedEnvironmentVariables=async()=>({...base,ANTHROPIC_BASE_URL:process.env.KICAD_FIXTURE_CLAUDE,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 const channelId='kicad-routing-regression',messages=[];
 const oldSend=agent.transport.send.bind(agent.transport);
 agent.transport.send=(message)=>{if(message.channelId===channelId)messages.push(message);else oldSend(message)};
 async function waitFor(predicate){const until=Date.now()+30000;while(!predicate()){if(Date.now()>until)throw Error('routing timeout: '+JSON.stringify(messages));await new Promise(r=>setTimeout(r,50))}}
 async function turn(number){agent.transportMessage(channelId,{type:'user',message:{role:'user',content:'Reply FIXTURE_OK. Do not use tools. Test turn '+number},parent_tool_use_id:null,session_id:''},false);await waitFor(()=>messages.filter(m=>m.type==='io_message'&&m.message.type==='result').length>=number);assert.equal(messages.filter(m=>m.type==='io_message'&&m.message.type==='result').at(-1).message.is_error,false)}
 try {
  await agent.launchClaude(channelId,null,vscode.workspace.workspaceFolders[0].uri.fsPath,'deepseek-flash','default','off');await turn(1);
  const first=agent.channels.get(channelId),sessionId=first.sessionId;assert.ok(sessionId);
  await agent.setModel(channelId,'sonnet');await turn(2);
  assert.equal(agent.channels.get(channelId).sessionId,sessionId);
  await agent.setModel(channelId,'deepseek-v4-pro');await turn(3);
  assert.equal(agent.channels.get(channelId).sessionId,sessionId);
  assert.equal(messages.some(m=>m.type==='close_channel'),false,'old process may not close replacement');
  const result={ok:true,version:extension.packageJSON.version,fixture:'actual installed extension service + bundled SDK/CLI; local model servers; no external model calls',completedTurns:3,sameConversation:true,modelSequence:['deepseek-flash','sonnet','deepseek-v4-pro'],staleProcessClosedReplacement:false};
  fs.writeFileSync('/tmp/Kicad-fix-routing-host.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {agent.closeChannel(channelId,false);sdk.getMergedEnvironmentVariables=originalEnv;}
};
