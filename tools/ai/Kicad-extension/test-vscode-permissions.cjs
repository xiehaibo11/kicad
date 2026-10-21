// Real installed service + bundled SDK/CLI. Local model fixture only; writes
// harmless marker files exclusively inside this test's temporary workspace.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 const instantiation=api.getInstantiationService(),id=[...instantiation._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(id)),sdk=agent.sdkService;
 const base=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v!==undefined&&!k.startsWith('ANTHROPIC_')));
 const originalEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport);
 sdk.getMergedEnvironmentVariables=async()=>({...base,ANTHROPIC_BASE_URL:process.env.KICAD_PERMISSION_FIXTURE_URL,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 const channels=['kicad-permission-live','kicad-permission-startup'],messages=[],prompts=[];
 agent.transport.send=message=>{
  if(!channels.includes(message.channelId))return oldSend(message);
  messages.push(message);
  if(message.type==='request'&&message.request.type==='tool_permission_request'){
   prompts.push(message);
   // Deny in ordinary Agent mode. The pending case is resolved only after the
   // SDK accepts a live change to full access, as the real composer does.
   if(!message.request.inputs.command?.includes('pending-live'))agent.handleResponse({type:'response',requestId:message.requestId,response:{type:'tool_permission_response',result:{behavior:'deny',message:'Denied by test in ordinary mode',interrupt:false}}});
  }
 };
 async function waitFor(predicate){const until=Date.now()+30000;while(!predicate()){if(Date.now()>until)throw Error('permission fixture timeout: '+JSON.stringify(messages));await new Promise(r=>setTimeout(r,50))}}
 const cwd=vscode.workspace.workspaceFolders[0].uri.fsPath;
 const marker=name=>path.join(cwd,name+'.txt');
 const results=channelId=>messages.filter(m=>m.channelId===channelId&&m.type==='io_message'&&m.message.type==='result');
 function send(channelId,name){agent.transportMessage(channelId,{type:'user',message:{role:'user',content:'KICAD_PERMISSION_CASE '+name+'. Use Bash exactly once, then finish.'},parent_tool_use_id:null,session_id:''},false)}
 async function turn(channelId,name){const count=results(channelId).length;send(channelId,name);await waitFor(()=>results(channelId).length>count);assert.equal(results(channelId).at(-1).message.is_error,false)}
 try{
  await agent.launchClaude(channels[0],null,cwd,'sonnet','acceptEdits','off');
  await turn(channels[0],'ordinary-agent');assert.equal(fs.existsSync(marker('ordinary-agent')),false);assert.equal(prompts.length,1);
  await agent.setPermissionMode(channels[0],'bypassPermissions');assert.equal(agent.channels.get(channels[0]).permissionMode,'bypassPermissions');
  await turn(channels[0],'highest-live');assert.match(fs.readFileSync(marker('highest-live'),'utf8'),/KICAD_PERMISSION_OK/);assert.equal(prompts.length,1,'highest mode must not ask for Bash approval');
  await agent.setPermissionMode(channels[0],'acceptEdits');
  await turn(channels[0],'ordinary-restored');assert.equal(fs.existsSync(marker('ordinary-restored')),false);assert.equal(prompts.length,2,'switching back must restore tool checks');
  const before=results(channels[0]).length;send(channels[0],'pending-live');
  await waitFor(()=>prompts.length===3);const pending=prompts.at(-1);
  await agent.setPermissionMode(channels[0],'bypassPermissions');
  agent.handleResponse({type:'response',requestId:pending.requestId,response:{type:'tool_permission_response',result:{behavior:'allow',updatedInput:pending.request.inputs,updatedPermissions:[]}}});
  await waitFor(()=>results(channels[0]).length>before);assert.match(fs.readFileSync(marker('pending-live'),'utf8'),/KICAD_PERMISSION_OK/);
  await agent.launchClaude(channels[1],null,cwd,'sonnet','bypassPermissions','off');
  await turn(channels[1],'highest-startup');assert.match(fs.readFileSync(marker('highest-startup'),'utf8'),/KICAD_PERMISSION_OK/);assert.equal(prompts.length,3);
  await turn(channels[1],'question-highest');assert.equal(prompts.length,4);assert.equal(prompts.at(-1).request.toolName,'AskUserQuestion','full access may not invent answers to user questions');
  const report={ok:true,version:extension.packageJSON.version,extensionPath:extension.extensionPath,fixture:'production extension + real bundled SDK/CLI + localhost model; harmless temporary files',cases:{ordinaryAgentPrompts:true,highestLiveExecutesWithoutPrompt:true,switchBackRestoresChecks:true,highestResolvesPendingTool:true,highestStartupExecutesWithoutPrompt:true,explicitQuestionStillAsksUser:true},completedTurns:6,prompts:prompts.map(m=>({tool:m.request.toolName,command:m.request.inputs.command})),temporaryWorkspace:cwd};
  fs.writeFileSync(process.env.KICAD_PERMISSION_HOST_RESULT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{for(const channelId of channels)agent.closeChannel(channelId,false);sdk.getMergedEnvironmentVariables=originalEnv;agent.transport.send=oldSend;}
};
