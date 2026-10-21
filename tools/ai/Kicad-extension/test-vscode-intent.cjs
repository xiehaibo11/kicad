const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate(),inst=api.getInstantiationService(),id=[...inst._services._entries.keys()].find(id=>String(id)==='claudeAgentService'),agent=inst.invokeFunction(a=>a.get(id)),sdk=agent.sdkService;
 const events=[],prompts=[],channels=[],oldEnv=sdk.getMergedEnvironmentVariables,oldSend=agent.transport.send.bind(agent.transport),cwd=vscode.workspace.workspaceFolders[0].uri.fsPath;
 sdk.getMergedEnvironmentVariables=async()=>({...process.env,ANTHROPIC_BASE_URL:process.env.KICAD_INTENT_URL,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
 agent.transport.send=m=>{if(!channels.includes(m.channelId))return oldSend(m);events.push(m);if(m.type==='request'&&m.request.type==='tool_permission_request'){
  prompts.push(m);const actual=m.channelId==='answered',updatedInput=actual?{...m.request.inputs,answers:{'你想执行什么任务？':'创建测试文件'}}:m.request.inputs;
  agent.handleResponse({type:'response',requestId:m.requestId,response:{type:'tool_permission_response',result:{behavior:'allow',updatedInput,updatedPermissions:[]}}});
 }};
 const wait=async(check,label)=>{const deadline=Date.now()+40000;while(!check()){if(Date.now()>deadline)throw Error('timeout '+label);await new Promise(r=>setTimeout(r,50));}};
 const send=async(channel,text)=>{channels.push(channel);await agent.launchClaude(channel,null,cwd,'sonnet','bypassPermissions','off');await agent.transportMessage(channel,{type:'user',message:{role:'user',content:text},session_id:'',parent_tool_use_id:null},false);await wait(()=>events.some(m=>m.channelId===channel&&m.message?.type==='result'),channel);const result=events.find(m=>m.channelId===channel&&m.message?.type==='result').message;assert.equal(result.is_error,false,JSON.stringify(result));return result;};
 try{
  await send('ambiguous','1');assert.equal(fs.existsSync(path.join(cwd,'ambiguous.txt')),false,'full access cannot turn 1 into a task');
  await send('generic-yes','KICAD_INTENT_QUESTION: Ask what task I want before doing anything.');assert.equal(fs.existsSync(path.join(cwd,'generic-yes.txt')),false,'generic Yes is not a question answer');
  await send('answered','KICAD_INTENT_ANSWERED: Ask what task I want before doing anything.');assert.equal(fs.readFileSync(path.join(cwd,'answered.txt'),'utf8'),'INTENT_OK');
  const compact=await send('compact','KICAD_INTENT_COMPACT: 创建 compact.txt 写入 INTENT_OK，然后完成剩余验证；不要布线。');
  assert.equal(fs.readFileSync(path.join(cwd,'compact.txt'),'utf8'),'INTENT_OK');
  const boundary=events.some(m=>m.channelId==='compact'&&m.message?.type==='system'&&m.message.subtype==='compact_boundary');assert.equal(boundary,true,'real CLI must compact automatically');
  const state=JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR,'kicad-task-state',compact.session_id,'checkpoint.json')));assert.match(state.requests[0].text,/不要布线/);assert.ok(fs.existsSync(state.archive));assert.ok(state.ledger.some(t=>t.name==='Write'));
  fs.writeFileSync(process.env.KICAD_INTENT_OUTPUT,JSON.stringify({ok:true,version:extension.packageJSON.version,fixture:'actual extension SDK/CLI + local controlled model',ambiguousToolBlocked:true,genericYesNotAnAnswer:true,actualAnswerAllowsTask:true,clearTaskWrites:true,automaticCompaction:boundary,checkpointPreservesRequestAndActions:true,sessionId:compact.session_id,prompts:prompts.map(m=>({channel:m.channelId,tool:m.request.toolName})),events:events.map(m=>({channel:m.channelId,type:m.message?.type,subtype:m.message?.subtype}))},null,2));
 }finally{for(const c of channels)agent.closeChannel(c,false);sdk.getMergedEnvironmentVariables=oldEnv;agent.transport.send=oldSend;}
};
