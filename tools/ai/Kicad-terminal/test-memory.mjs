import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {KicadSessionRuntime} from './dist/session-runtime.mjs';
import {MemoryStore} from '../composer/memory.ts';
import {writeMemorySetting} from '../composer/settings.ts';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'ki-terminal-memory-')),previous={...process.env};
process.env.KICAD_AUTO_CONNECT='0';process.env.KICAD_LOCAL_MEMBERSHIP='0';process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'diagnostics');process.env.XDG_STATE_HOME=path.join(tmp,'state');
let messages=[],child=false,hooks;
try{
 hooks=await KicadSessionRuntime({directory:tmp,client:{session:{messages:async()=>({data:messages}),get:async()=>({data:{parentID:child?'parent':undefined}})}}});
 for(const model of ['claude','deepseek-flash','openai-compatible','other-text-model']){
  await hooks['chat.params']({sessionID:'root',model:{id:model}});
  const message={id:model,role:'user'},parts=[{type:'text',text:'以后请用中文回复。'}];
  await hooks['chat.message']({sessionID:'root'},{message,parts});messages=[{info:message,parts}];
  const output={system:[]};await hooks['experimental.chat.system.transform']({sessionID:'root'},output);assert.match(output.system.join('\n'),/用户偏好使用中文回复/);
 }
 child=true;await hooks['chat.message']({sessionID:'child'},{message:{id:'child-input',role:'user'},parts:[{type:'text',text:'From now on reply in English.'}]});child=false;
 assert.match((await new MemoryStore(tmp).entries('global'))[0].text,/中文/);
 // A transformed/system prompt alone must not import an old conversation.
 messages=[{info:{id:'old',role:'user'},parts:[{type:'text',text:'From now on reply in English.'}]}];
 await hooks['experimental.chat.system.transform']({sessionID:'root'},{system:[]});
 assert.match((await new MemoryStore(tmp).entries('global'))[0].text,/中文/);
 writeMemorySetting('globalEnabled',false);
 const off={system:[]};await hooks['experimental.chat.system.transform']({sessionID:'root'},off);assert.doesNotMatch(off.system.join('\n'),/用户偏好使用中文回复/);
 writeMemorySetting('autoLearn',false);writeMemorySetting('globalEnabled',true);
 await hooks['chat.message']({sessionID:'root'},{message:{id:'no-learning',role:'user'},parts:[{type:'text',text:'以后请详细回答。'}]});
 assert.equal((await new MemoryStore(tmp).entries('global')).length,1);
 console.log('Terminal memory passed: four model profiles, real input hook, child isolation, no historical import and live extension-compatible switches. No live model calls.');
}finally{
 await hooks?.event({event:{type:'server.instance.disposed'}});
 for(const key of ['KICAD_AUTO_CONNECT','KICAD_LOCAL_MEMBERSHIP','KICAD_HISTORY_DIR','KICAD_DIAGNOSTICS_DIR','XDG_STATE_HOME'])previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];
 await fs.rm(tmp,{recursive:true,force:true});
}
