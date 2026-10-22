const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate(),inst=api.getInstantiationService(),id=[...inst._services._entries.keys()].find(id=>String(id)==='claudeAgentService'),agent=inst.invokeFunction(a=>a.get(id)),sdk=agent.sdkService;
 const channelId='dashboard-live-fixture',messages=[],oldEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport),oldSecret=sdk.context.secrets.get;
 sdk.context.secrets.get=async()=>undefined;
 const config=vscode.workspace.getConfiguration('kicadAgent');await config.update('deepseek.baseUrl',process.env.KICAD_DASHBOARD_URL,vscode.ConfigurationTarget.Workspace);await config.update('deepseek.apiKey','fixture-only',vscode.ConfigurationTarget.Workspace);
 sdk.getMergedEnvironmentVariables=async()=>({...process.env,ANTHROPIC_BASE_URL:process.env.KICAD_DASHBOARD_URL,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 agent.transport.send=m=>m.channelId===channelId?messages.push(m):oldSend(m);
 let sdkProcess,channelAbort;
 try{
  await agent.launchClaude(channelId,null,vscode.workspace.workspaceFolders[0].uri.fsPath,'deepseek-flash','bypassPermissions','off');
  const query=agent.channels.get(channelId).query;sdkProcess=query.transport?.process;channelAbort=query.abortController;
  await agent.transportMessage(channelId,{type:'user',message:{role:'user',content:'KICAD_DASHBOARD_MAIN: Use the Task tool with subagent_type general-purpose to delegate KICAD_DASHBOARD_CHILD. Do not use other tools.'},session_id:'',parent_tool_use_id:null},false);
  const until=Date.now()+45000;while(!messages.some(m=>m.message?.type==='result')){if(Date.now()>until)throw Error('dashboard timeout');await new Promise(r=>setTimeout(r,50));}
  const events=messages.filter(m=>m.type==='io_message').map(m=>m.message);
  fs.writeFileSync(process.env.KICAD_DASHBOARD_EVENTS,JSON.stringify(events,null,2));
  assert.equal(events.at(-1).is_error,false);assert.ok(events.some(e=>e.type==='assistant'&&e.message?.content?.some(b=>b.type==='tool_use'&&['Task','Agent'].includes(b.name))));
  assert.ok(events.some(e=>e.type==='user'&&e.message?.content?.some(b=>b.type==='tool_result')));
 }finally{agent.closeChannel(channelId,false);sdk.getMergedEnvironmentVariables=oldEnv;agent.transport.send=oldSend;sdk.context.secrets.get=oldSecret;}
 assert.equal(channelAbort?.signal.aborted,true,'channel close must abort SDK process');
 if(sdkProcess){const deadline=Date.now()+5000;while(sdkProcess.exitCode===null&&sdkProcess.signalCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));assert.ok(sdkProcess.exitCode!==null||sdkProcess.signalCode!==null,'CLI must exit on close');}
 fs.writeFileSync(process.env.KICAD_DASHBOARD_EVENTS+'.closed.json',JSON.stringify({ok:true,aborted:channelAbort.signal.aborted,processExited:!sdkProcess||sdkProcess.exitCode!==null||sdkProcess.signalCode!==null}));
};
