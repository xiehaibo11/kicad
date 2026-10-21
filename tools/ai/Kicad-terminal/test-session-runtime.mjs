import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {KicadSessionRuntime} from './dist/session-runtime.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'Kicad-terminal-state-')),old=process.env.XDG_STATE_HOME;process.env.XDG_STATE_HOME=tmp;
try{
 let messages=[];const hooks=await KicadSessionRuntime({client:{session:{messages:async()=>({data:messages})}}}),input={sessionID:'fixture',tool:'bash'};
 const defaults={};await hooks.config(defaults);assert.deepEqual(defaults.compaction,{auto:true,prune:false});
 const explicit={compaction:{auto:false,prune:true,reserved:8000}};await hooks.config(explicit);assert.deepEqual(explicit.compaction,{auto:false,prune:true,reserved:8000});
 await assert.rejects(hooks['tool.execute.before'](input),/用户尚未提供明确任务/);
 messages=[{info:{id:'u1',role:'user'},parts:[{type:'text',text:'1'}]}];
 await assert.rejects(hooks['tool.execute.before'](input));await hooks['tool.execute.before']({...input,tool:'question'});
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[[]]}});await assert.rejects(hooks['tool.execute.before'](input));
 await hooks['tool.execute.after']({...input,tool:'question'},{metadata:{answers:[['只读查看 U1']]}});await hooks['tool.execute.before'](input);
 messages.push({info:{id:'u2',role:'user'},parts:[{type:'text',text:'2'}]});await assert.rejects(hooks['tool.execute.before'](input),'new ambiguous input cannot inherit an old answer');
 messages.push({info:{id:'u3',role:'user'},parts:[{type:'text',text:'修改 R1 为 10 kΩ，验证 DRC，不要布线。'}]},{info:{id:'a3',role:'assistant'},parts:[{type:'tool',callID:'write1',tool:'edit',state:{status:'completed',input:{path:'board.kicad_pcb'},output:'changed'}}]});await hooks['tool.execute.before'](input);
 const compact={context:[]};await hooks['experimental.session.compacting'](input,compact);assert.match(compact.context[0],/Full execution history/);
 const dir=path.join(tmp,'opencode/kicad-task-state/fixture'),state=JSON.parse(await fs.readFile(path.join(dir,'checkpoint.json'),'utf8'));assert.deepEqual(JSON.parse(await fs.readFile(state.archive,'utf8')),messages);assert.equal(state.actions[0].id,'write1');
 const system={system:[]};await hooks['experimental.chat.system.transform'](input,system);assert.match(system.system[0],/不要布线/);assert.match(system.system[0],/write1/);assert.match(system.system[0],/never repeat completed mutations/);
 assert.equal((await fs.stat(state.archive)).mode&0o777,0o600);
 console.log('Terminal backend plugin passed: intent gate, explicit question answers, new-input isolation, complete archive and post-compaction task state.');
}finally{if(old===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=old;await fs.rm(tmp,{recursive:true,force:true});}
