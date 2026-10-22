process.env.KICAD_LOCAL_MEMBERSHIP='0';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {KicadSessionRuntime} from './dist/session-runtime.mjs';
process.env.KICAD_AUTO_CONNECT='0';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'Kicad-terminal-state-')),old=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=tmp;
try{
 let messages=[];const hooks=await KicadSessionRuntime({client:{session:{messages:async()=>({data:messages})}}}),input={sessionID:'fixture',tool:'bash'};
 const defaults={};await hooks.config(defaults);assert.deepEqual(defaults.compaction,{auto:true,prune:false});
 const inherited={mcp:{kicad:{command:['old-go']},easyeda:{command:['old-connector']},other:{enabled:false}}};await hooks.config(inherited);assert.deepEqual(inherited.mcp,{});
 const explicit={compaction:{auto:false,prune:true,reserved:8000}};await hooks.config(explicit);assert.deepEqual(explicit.compaction,{auto:false,prune:true,reserved:8000});
 assert.deepEqual(Object.keys(defaults.command).sort(),['kicad-drc','kicad-fab','kicad-history','kicad-route','kicad-schematic','kicad-step']);assert.ok(Object.values(defaults.command).every(item=>item.description&&item.template.includes('$ARGUMENTS')));
 const own={command:{'kicad-drc':{template:'my own'}}};await hooks.config(own);assert.equal(own.command['kicad-drc'].template,'my own');assert.ok(own.command['kicad-fab']);
 await assert.rejects(hooks['tool.execute.before'](input),/用户尚未提供明确任务/);
 messages=[{info:{id:'u1',role:'user'},parts:[{type:'text',text:'1'}]}];
 await assert.rejects(hooks['tool.execute.before'](input));await hooks['tool.execute.before']({...input,tool:'question'});
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[[]]}});await assert.rejects(hooks['tool.execute.before'](input));
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[['只读查看 U1']]}});await hooks['tool.execute.before'](input);
 messages.push({info:{id:'u2',role:'user'},parts:[{type:'text',text:'2'}]});await assert.rejects(hooks['tool.execute.before'](input),'new ambiguous input cannot inherit an old answer');
 messages.push({info:{id:'u3',role:'user'},parts:[{type:'text',text:'修改 R1 为 10 kΩ，验证 DRC，不要布线。'}]},{info:{id:'a3',role:'assistant'},parts:[{type:'tool',callID:'write1',tool:'edit',state:{status:'completed',input:{path:'board.kicad_pcb'},output:'changed'}}]});await hooks['tool.execute.before'](input);
 if(process.platform==='darwin'){
   await assert.rejects(hooks['tool.execute.before']({...input,callID:'archive'},{args:{command:'unzip -q "中文.epro2" -d /tmp/new'}}),/ditto/);
   await hooks['tool.execute.before']({...input,callID:'archive-fixed'},{args:{command:'ditto -x -k "中文.epro2" /tmp/new'}});
 }
 const compact={context:[]};await hooks['experimental.session.compacting'](input,compact);assert.match(compact.context[0],/Full execution history/);
 const dir=path.join(tmp,'opencode/kicad-task-state/fixture'),state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.deepEqual(JSON.parse(await fs.readFile(state.archive,'utf8')),messages);assert.equal(state.actions[0].id,'write1');
 const system={system:[]};await hooks['experimental.chat.system.transform'](input,system);assert.match(system.system.join("\n"),/不要布线/);assert.match(system.system.join("\n"),/write1/);assert.match(system.system.join("\n"),/never repeat completed mutations/);
 assert.equal((await fs.stat(state.archive)).mode&0o777,0o600);
 const request={sessionID:'fixture',tool:'kicad_board',callID:'fail',args:{action:'board.items.get'}};
 for(let i=0;i<3;i++){
   await hooks['tool.execute.before'](request,{args:request.args});
   await hooks['tool.execute.after']({...request,callID:'fail'+i},{output:'{"ok":false,"error":{"code":"IPC_UNAVAILABLE"}}',metadata:{}});
 }
 await assert.rejects(hooks['tool.execute.before'](request,{args:request.args}),/three times/);
 await hooks['tool.execute.before'](request,{args:{action:'board.items.list'}});
 // Errors thrown by native tools bypass the after hook, but remain in host history.
 messages.push({info:{id:'native-user',role:'user'},parts:[{type:'text',text:'读取指定文件并解释内容。'}]});
 for(let i=0;i<3;i++)messages.push({info:{id:'native'+i,role:'assistant'},parts:[{type:'tool',callID:'native'+i,tool:'read',state:{status:'error',input:{filePath:'/missing'},error:'ENOENT'}}]});
 await assert.rejects(hooks['tool.execute.before']({sessionID:'fixture',tool:'read'},{args:{filePath:'/missing'}}),/three times/);
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
 console.log('Terminal backend plugin passed: intent gate, explicit question answers, new-input isolation, complete archive and post-compaction task state.');
}finally{if(old===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=old;await fs.rm(tmp,{recursive:true,force:true});}
