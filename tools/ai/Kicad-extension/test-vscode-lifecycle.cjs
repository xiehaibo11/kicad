const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate(),inst=api.getInstantiationService(),id=[...inst._services._entries.keys()].find(id=>String(id)==='claudeAgentService'),agent=inst.invokeFunction(a=>a.get(id)),sdk=agent.sdkService;
 const ids=['pause-fixture','resend-fixture'],messages=[],oldEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport),oldSecret=sdk.context.secrets.get;
 const url=process.env.KICAD_LIFECYCLE_URL,config=vscode.workspace.getConfiguration('kicadAgent');
 await config.update('deepseek.baseUrl',url,vscode.ConfigurationTarget.Workspace);await config.update('deepseek.apiKey','fixture-only',vscode.ConfigurationTarget.Workspace);
 sdk.context.secrets.get=async()=>undefined;
 sdk.getMergedEnvironmentVariables=async()=>({...process.env,ANTHROPIC_BASE_URL:url,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 agent.transport.send=m=>ids.includes(m.channelId)?messages.push(m):oldSend(m);
 const wait=async(check,label)=>{const deadline=Date.now()+45000;while(!await check()){if(Date.now()>deadline)throw Error('timeout: '+label);await new Promise(r=>setTimeout(r,40));}};
 const originalId='ab190000-0000-4000-8000-000000000001',replacementId='ab190000-0000-4000-8000-000000000002';
 const user=(text,uuid)=>({type:'user',uuid,message:{role:'user',content:text},session_id:'',parent_tool_use_id:null});
 let persisted,processStopped;
 const configuration=agent.configService,oldConfigPath=configuration.getExtensionConfigPath;
 try{
  const cwd=vscode.workspace.workspaceFolders[0].uri.fsPath;
  // Exercise the real storage and init handlers, isolated from the user's settings.
  configuration.getExtensionConfigPath=()=>path.join(cwd,'fixture-preferences.json');
  const request=request=>agent.processRequest({type:'request',requestId:'fixture-config',request},new AbortController().signal);
  await request({type:'update_extension_config',key:'selectedModel',value:'deepseek-v4-pro'});
  assert.equal((await request({type:'init'})).state.modelSetting,'deepseek-v4-pro');
  assert.equal(JSON.parse(fs.readFileSync(configuration.getExtensionConfigPath())).selectedModel,'deepseek-v4-pro');
  await request({type:'update_extension_config',key:'selectedModel',value:'deepseek-flash'});
  assert.equal((await request({type:'init'})).state.modelSetting,'deepseek-flash');
  await agent.launchClaude(ids[0],null,cwd,'deepseek-flash','bypassPermissions','high');
  await agent.transportMessage(ids[0],user('KICAD_PAUSE_MAIN: Delegate KICAD_PAUSE_CHILD with Task general-purpose.',originalId),false);
  await wait(async()=>(await(await fetch(url+'/fixture-state')).json()).childPending,'child request running');
  persisted=agent.channels.get(ids[0]).sessionId;assert.ok(persisted);
  const query=agent.channels.get(ids[0]).query,sdkProcess=query.transport?.process;
  assert.ok(sdkProcess,'running SDK query must expose its process transport');
  const exited=new Promise(resolve=>sdkProcess.once('exit',()=>resolve(true)));
  await agent.interruptClaude(ids[0]);assert.equal(agent.channels.has(ids[0]),false);assert.equal(query.abortController.signal.aborted,true);
  let exitTimer;try{processStopped=await Promise.race([exited,new Promise((_,reject)=>{exitTimer=setTimeout(()=>reject(Error('old CLI did not exit')),5000)})]);}finally{clearTimeout(exitTimer)}
  await agent.launchClaude(ids[1],persisted,cwd,'deepseek-flash','bypassPermissions','high');
  await request({type:'record_message_edit',sessionId:persisted,originalId,replacementId});
  await agent.transportMessage(ids[1],user('KICAD_RESEND: Continue this conversation and finish the task. Write continuation-proof.txt with CONTINUED_WITH_WRITE, then reply RESEND_OK.',replacementId),false);
  await wait(()=>messages.some(m=>m.channelId===ids[1]&&m.message?.type==='result'),'resend result');
  const events=messages.filter(m=>m.channelId===ids[1]&&m.type==='io_message').map(m=>m.message),result=events.find(e=>e.type==='result');
  assert.equal(result.is_error,false);assert.equal(result.session_id,persisted);assert.ok(events.some(e=>e.message?.content?.some(b=>b.text?.includes('RESEND_OK'))));
  assert.equal(fs.readFileSync(path.join(cwd,'continuation-proof.txt'),'utf8'),'CONTINUED_WITH_WRITE');
  const active=agent.channels.get(ids[1]);assert.equal(active.busy,false);assert.equal(active.permissionMode,'bypassPermissions');assert.equal(active.model,'deepseek-flash');assert.equal(active.thinkingLevel,'high');
  let loaded;await wait(async()=>{loaded=(await request({type:'get_session_request',sessionId:persisted})).messages;return loaded.some(m=>m.uuid===replacementId);},'edited transcript flushed');
  assert.ok(loaded.some(m=>m.uuid===replacementId),'SDK preserves the input UUID in persisted history');assert.ok(!loaded.some(m=>m.uuid===originalId),'reopened history contains the replacement only');
  assert.equal(loaded.filter(m=>m.type==='user' && (typeof m.message?.content==='string'?m.message.content.includes('KICAD_'):m.message?.content?.some(b=>b.text?.includes('KICAD_')))).length,1,'exactly one visible user request after editing');
  const listed=(await request({type:'list_sessions_request'})).sessions.find(s=>s.id===persisted);assert.match(listed.summary,/KICAD_RESEND/,'history title follows the updated first request');
  fs.writeFileSync(process.env.KICAD_LIFECYCLE_OUTPUT,JSON.stringify({ok:true,persistedSession:true,processStopped,resendResult:result.subtype,sameModel:true,samePermissions:true,sameEffort:true,continuedToolWrite:true,hostModelPreferencePersists:true,reopenedEditedRequestAppearsOnce:true,sdkPersistsClientMessageUuid:true,events:messages.map(m=>({channelId:m.channelId,type:m.type,messageType:m.message?.type,parent:!!m.message?.parent_tool_use_id}))},null,2));
 }finally{configuration.getExtensionConfigPath=oldConfigPath;for(const id of ids)agent.closeChannel(id,false);sdk.getMergedEnvironmentVariables=oldEnv;agent.transport.send=oldSend;sdk.context.secrets.get=oldSecret;}
};
