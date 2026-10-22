// Actual chat service, SDK and native KiCad; model responses come from localhost.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 const instantiation=api.getInstantiationService(),id=[...instantiation._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(id)),sdk=agent.sdkService;
 const originalEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport);
 const channelId='kicad-native-tools-acceptance',messages=[];
 sdk.getMergedEnvironmentVariables=async()=>({...process.env,ANTHROPIC_BASE_URL:process.env.KICAD_TOOL_MODEL_URL,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 agent.transport.send=message=>{if(message.channelId===channelId)messages.push(message);else oldSend(message)};
 try{
  const cwd=vscode.workspace.workspaceFolders[0].uri.fsPath;
  await agent.launchClaude(channelId,null,cwd,'sonnet','bypassPermissions','off');
  agent.transportMessage(channelId,{type:'user',message:{role:'user',content:'Run every supplied KiCad acceptance tool once on this temporary project. Create the test via, export the schematic netlist and persist workflow/pipeline state, then finish.'},parent_tool_use_id:null,session_id:''},false);
  const deadline=Date.now()+120000;
  while(!messages.some(m=>m.type==='io_message'&&m.message.type==='result')){
   if(Date.now()>deadline)throw Error('native chat tool acceptance timed out: '+JSON.stringify(messages).slice(-4000));
   await new Promise(r=>setTimeout(r,100));
  }
  const result=messages.findLast(m=>m.type==='io_message'&&m.message.type==='result').message;
  assert.equal(result.is_error,false,JSON.stringify(result));
  fs.writeFileSync(process.env.KICAD_TOOL_HOST_RESULT,JSON.stringify({ok:true,version:extension.packageJSON.version,resultSubtype:result.subtype,webviews:api.getWebviewReadiness(),fixture:'actual extension chat service + SDK + native IPC/CLI, localhost model'},null,2));
 }finally{agent.closeChannel(channelId,false);sdk.getMergedEnvironmentVariables=originalEnv;agent.transport.send=oldSend;}
};
