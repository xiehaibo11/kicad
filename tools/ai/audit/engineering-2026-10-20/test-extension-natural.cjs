const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate(),instantiation=api.getInstantiationService();
 const serviceId=[...instantiation._services._entries.keys()].find(key=>String(key)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(serviceId)),channelId='kicad-engineering-reference-acceptance',messages=[];
 const originalSend=agent.transport.send.bind(agent.transport);
 agent.transport.send=message=>{
  if(message.channelId!==channelId)return originalSend(message);
  messages.push(message);
  if(message.type==='request'&&message.request.type==='tool_permission_request'){
   const r=message.request,allow=['mcp__kicad__kicad_reference','mcp__kicad__kicad_actions'].includes(r.toolName)||r.toolName==='Skill';
   agent.handleResponse({type:'response',requestId:message.requestId,response:{type:'tool_permission_response',result:allow?{behavior:'allow',updatedInput:r.inputs,updatedPermissions:[]}:{behavior:'deny',message:'Read-only engineering reference/catalog acceptance test only'}}});
  }
 };
 const prompt='请为 KiCad 的原理图设计和封装选型列出必须遵守的工程规范，并查找原生设计示例供后续参考。只读，不修改工程，不调用任何写入工具。请自动查阅已有规范后给出缺失输入和验证证据，不要把参考示例当作可投产设计。';
 try{
  await agent.launchClaude(channelId,null,vscode.workspace.workspaceFolders[0].uri.fsPath,'deepseek-flash','default','off');
  agent.transportMessage(channelId,{type:'user',message:{role:'user',content:prompt},parent_tool_use_id:null,session_id:''},false);
  const deadline=Date.now()+180000;
  while(!messages.some(m=>m.type==='io_message'&&m.message.type==='result')){if(Date.now()>deadline)throw Error('Natural-language reference test timed out');await new Promise(r=>setTimeout(r,200))}
  const result=messages.find(m=>m.type==='io_message'&&m.message.type==='result').message;
  const tools=messages.flatMap(m=>m.message?.message?.content||[]).filter(p=>p.type==='tool_use');
  const actions=tools.filter(t=>t.name==='mcp__kicad__kicad_reference').map(t=>t.input.action);
  const ok=!result.is_error&&actions.includes('reference.plan')&&actions.includes('reference.examples');
  fs.writeFileSync(path.join(__dirname,'extension-natural.json'),JSON.stringify({ok,version:extension.packageJSON.version,prompt,fixture:'Installed VS Code extension, bundled SDK, actual configured DeepSeek model and real MCP, plain Chinese prompt; only read-only reference/catalog permissions allowed',actions,tools,result},null,2));
  assert.ok(ok,'Automatic reference.plan and reference.examples must run from a plain request');
 }finally{agent.closeChannel(channelId,false);agent.transport.send=originalSend}
};
