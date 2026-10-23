process.env.KICAD_LOCAL_MEMBERSHIP='0';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {KicadSessionRuntime} from './dist/session-runtime.mjs';
process.env.KICAD_AUTO_CONNECT='0';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'Kicad-terminal-state-')),old=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=tmp;
try{
 let messages=[];const hooks=await KicadSessionRuntime({directory:tmp,client:{session:{messages:async()=>({data:messages})}}}),input={sessionID:'fixture',tool:'bash'};
 const defaults={};await hooks.config(defaults);assert.deepEqual(defaults.compaction,{auto:true,prune:true});
 assert.equal(defaults.permission.edit,'allow');assert.equal(defaults.permission['*'],'ask');
 await fs.mkdir(path.join(tmp,'.kicad'));await fs.writeFile(path.join(tmp,'.kicad/settings.json'),JSON.stringify({deniedModels:['blocked-*'],maxEffortLevel:'low',autoMode:false}));
 await assert.rejects(()=>hooks['chat.params']({model:{id:'blocked-model'}}),/blocked/);
 const capped={options:{reasoningEffort:'max'}};await hooks['chat.params']({model:{id:'fixture',variants:{high:{reasoningEffort:'high'},low:{reasoningEffort:'low'}}}},capped);assert.equal(capped.options.reasoningEffort,'low');
 const manual={};await hooks.config(manual);assert.deepEqual(manual.permission,{'*':'ask'});
 const audit=JSON.parse(await hooks.tool.capability_call.execute({id:'tool:prompt_audit',arguments:{}},{}));assert.equal(audit.readOnly,true);assert.equal(audit.settings.maxEffortLevel,'low');
 await fs.rm(path.join(tmp,'.kicad/settings.json'));
 const inherited={mcp:{kicad:{command:['old-go']},easyeda:{command:['old-connector']},other:{enabled:false}}};await hooks.config(inherited);assert.deepEqual(inherited.mcp,{});
 const explicit={compaction:{auto:false,prune:true,reserved:8000}};await hooks.config(explicit);assert.deepEqual(explicit.compaction,{auto:false,prune:true,reserved:8000});
 assert.deepEqual(Object.keys(defaults.command).sort(),['doctor','kicad-drc','kicad-fab','kicad-history','kicad-route','kicad-schematic','kicad-step']);assert.ok(Object.values(defaults.command).every(item=>item.description&&item.template.includes('$ARGUMENTS')));
 const own={command:{'kicad-drc':{template:'my own'}}};await hooks.config(own);assert.equal(own.command['kicad-drc'].template,'my own');assert.ok(own.command['kicad-fab']);
 // Hooks record execution. The model, not the hook, decides whether a tool runs.
 await hooks['tool.execute.before'](input);
 for(const text of ['谢谢','好的','你是谁？','不要调用工具，只解释刚才的结果','Answer from this chat without tools']){
   messages=[{info:{id:'conversation-'+text,role:'user'},parts:[{type:'text',text}]}];
   for(const tool of ['bash','read','capability_search','question'])await hooks['tool.execute.before']({...input,tool});
   // Sub-agents need an explicit request in the latest message.
   await assert.rejects(()=>hooks['tool.execute.before']({...input,tool:'task'}),/explicitly asks for sub-agents/);
 }
 messages=[{info:{id:'delegate',role:'user'},parts:[{type:'text',text:'用两个子代理并行检查电源和接口'}]}];
 await hooks['tool.execute.before']({...input,tool:'task'});
 // The harness deny list holds in every mode; ordinary commands pass through.
 await assert.rejects(()=>hooks['tool.execute.before']({...input,tool:'bash'},{args:{command:'sudo rm -rf /'}}),/deny list/);
 await hooks['tool.execute.before']({...input,tool:'bash'},{args:{command:'ls -la'}});
 messages=[{info:{id:'u1',role:'user'},parts:[{type:'text',text:'1'}]}];
 await hooks['tool.execute.before'](input);await hooks['tool.execute.before']({...input,tool:'question'});
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[[]]}});await hooks['tool.execute.before'](input);
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[['只读查看 U1']]}});await hooks['tool.execute.before'](input);
 messages.push({info:{id:'u2',role:'user'},parts:[{type:'text',text:'2'}]});await hooks['tool.execute.before'](input);
 messages.push({info:{id:'u3',role:'user'},parts:[{type:'text',text:'修改 R1 为 10 kΩ，验证 DRC，不要布线。'}]},{info:{id:'a3',role:'assistant'},parts:[{type:'tool',callID:'write1',tool:'edit',state:{status:'completed',input:{path:'board.kicad_pcb'},output:'changed'}}]});await hooks['tool.execute.before'](input);
 if(process.platform==='darwin'){
   await hooks['tool.execute.before']({...input,callID:'archive'},{args:{command:'unzip -q "中文.epro2" -d /tmp/new'}});
   await hooks['tool.execute.before']({...input,callID:'archive-fixed'},{args:{command:'ditto -x -k "中文.epro2" /tmp/new'}});
   const archive={output:'Exit code 50\nwrite error (disk full?)',metadata:{}};
   await hooks['tool.execute.after']({...input,callID:'archive-fail'},archive);assert.match(archive.output,/ditto/);
 }
 const compact={context:[]};await hooks['experimental.session.compacting'](input,compact);assert.match(compact.context[0],/Full execution history/);
 const dir=path.join(tmp,'opencode/kicad-task-state/fixture'),state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.deepEqual(JSON.parse(await fs.readFile(state.archive,'utf8')),messages);assert.equal(state.actions[0].id,'write1');
 const system={system:[]};await hooks['experimental.chat.system.transform'](input,system);assert.match(system.system.join("\n"),/不要布线/);assert.match(system.system.join("\n"),/write1/);assert.match(system.system.join("\n"),/never repeat completed mutations/);
 assert.equal((await fs.stat(state.archive)).mode&0o777,0o600);
 const request={sessionID:'fixture',tool:'kicad_board',callID:'fail',args:{action:'board.items.get'}};
 let last;
 for(let i=0;i<3;i++){
   await hooks['tool.execute.before'](request,{args:request.args});
   last={output:'{"ok":false,"error":{"code":"IPC_UNAVAILABLE"}}',metadata:{}};
   await hooks['tool.execute.after']({...request,callID:'fail'+i},last);
 }
 assert.match(last.output,/three times/,'repeated failure is advice appended to the result');
 await hooks['tool.execute.before'](request,{args:request.args});
 await hooks['tool.execute.before'](request,{args:{action:'board.items.list'}});
 // Errors thrown by native tools bypass the after hook, but remain in host history.
 messages.push({info:{id:'native-user',role:'user'},parts:[{type:'text',text:'读取指定文件并解释内容。'}]});
 for(let i=0;i<3;i++)messages.push({info:{id:'native'+i,role:'assistant'},parts:[{type:'tool',callID:'native'+i,tool:'read',state:{status:'error',input:{filePath:'/missing'},error:'ENOENT'}}]});
 await hooks['tool.execute.before']({sessionID:'fixture',tool:'read'},{args:{filePath:'/missing'}});
 await hooks['tool.execute.before']({sessionID:'fixture',tool:'read'},{args:{filePath:'/other'}});
 const large={output:'测'.repeat(100000),metadata:{source:'test'}};
 await hooks['tool.execute.after']({...request,tool:'read',args:{},callID:'large'},large);
 assert.equal(await fs.readFile(large.metadata.kicadArchive,'utf8'),'测'.repeat(100000));
 assert.ok(large.output.length<10000);assert.equal(large.metadata.source,'test');
 await hooks.event({event:{type:'session.error',properties:{sessionID:'fixture',error:{message:'429 rate limit'}}}});
 await hooks.tool.capability_search.execute({query:'runtime_diagnostics',kind:'tool'},{});
 const diagnostic=JSON.parse(await hooks.tool.capability_call.execute({id:'tool:runtime_diagnostics',arguments:{}},{}));assert.ok(diagnostic.issues.some(i=>i.kind==='rate_limit'));assert.ok(diagnostic.issues.some(i=>i.kind==='connection'));
 // Task words reach the KiCad action a tool runs; kind defaults to tool; a bad call gets the binding's short error, not Zod's action list.
 const drc=JSON.parse(await hooks.tool.capability_search.execute({query:'drc'},{}));assert.equal(drc.results[0].name,'kicad_board');assert.equal(drc.results[0].matchedActions[0].name,'board.drc.run');
 const invalid=JSON.parse(await hooks.tool.capability_call.execute({id:'tool:kicad_board',arguments:{action:'library.list'}},{}));assert.equal(invalid.error.code,'INVALID_ARGUMENTS');assert.ok(invalid.error.message.length<200,invalid.error.message.length);
 console.log('Terminal backend plugin passed: model-owned tool choice, explicit-request sub-agents, deny list, post-failure advice, complete archive and post-compaction task state.');
}finally{if(old===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=old;await fs.rm(tmp,{recursive:true,force:true});}
