import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DemandCatalog,demandDefinitions} from '../demand.ts';

test('startup is inert, discovery bounded, only selected MCP starts, denied/unknown targets never execute',async()=>{
 let built=0,connections=[],executed=[],closed=0;
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],servers:{alpha:{},beta:{},disabled:{enabled:false}},builtins:async()=>{built++;return Array.from({length:8},(_,i)=>({name:'tool'+i,description:'board fixture',inputSchema:{type:'object',properties:{x:{type:'number'}}},execute:async args=>{executed.push(args);return {ok:true};}}));},connect:async name=>{connections.push(name);return {list:async()=>[{name:'remote',description:'remote fixture',inputSchema:{type:'object'}}],call:async(name,args)=>({name,args}),close:async()=>{closed++;}};}});
 assert.equal(demandDefinitions.length,2);assert.equal(built,0);assert.deepEqual(connections,[]);
 assert.equal((await catalog.search({kind:'server',query:''})).results.length,2);assert.equal(built,0);assert.deepEqual(connections,[]);
 await assert.rejects(()=>catalog.call('mcp:alpha:remote',{}),/Search/);await assert.rejects(()=>catalog.call('skill:any',{}),/Search/);
 assert.equal(built,0);assert.deepEqual(connections,[]);
 const tools=await catalog.search({kind:'tool',query:'board'});assert.equal(tools.results.length,5);assert.equal(tools.nextOffset,5);assert.equal(built,1);
 assert.equal((await catalog.search({kind:'tool',query:'board',offset:5})).results.length,3);assert.equal(built,1);
 assert.equal((await catalog.call(tools.results[0].id,{x:1})).ok,true);assert.equal(executed.length,1);
 // Built-in ids are stable: a later turn may call one it did not just search; unknown ids never execute.
 assert.equal((await catalog.call('tool:tool7',{x:3})).ok,true);assert.equal(executed.length,2);assert.equal(built,1);
 await assert.rejects(()=>catalog.call('tool:missing',{}),/Unknown capability id/);assert.equal(executed.length,2);
 assert.equal((await catalog.search({kind:'tool',query:'remote',server:'alpha'})).results.length,1);assert.deepEqual(connections,['alpha']);
 await catalog.search({kind:'tool',query:'remote',server:'alpha'});assert.deepEqual(connections,['alpha']);
 await assert.rejects(()=>catalog.search({kind:'tool',query:'',server:'disabled'}),/disabled/);
 assert.deepEqual(await catalog.call('mcp:alpha:remote',{x:2}),{name:'remote',args:{x:2}});
 await catalog.close();assert.equal(closed,1);
});
test('skill search excludes bodies and loads only the exact selected skill, with project precedence',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-demand-'));
 try{
 for(const name of ['pcb','python']){await fs.mkdir(path.join(tmp,name));await fs.writeFile(path.join(tmp,name,'SKILL.md'),`---\nname: ${name}\ndescription: >\n  ${name} specialist instructions\n---\nBODY_${name}_SECRET`);}
 const catalog=new DemandCatalog({cwd:tmp,skillRoots:[tmp],builtins:async()=>[]});
 const found=await catalog.search({kind:'skill',query:'pcb'});assert.equal(found.results.length,1);assert.match(found.results[0].description,/specialist/);assert.doesNotMatch(JSON.stringify(found),/BODY|SECRET|python/);
 await assert.rejects(()=>catalog.call('skill:python',{}),/Search/);
 // Reading occurs at invocation, not discovery: edits are reflected immediately.
 await fs.appendFile(path.join(tmp,'pcb','SKILL.md'),'\nUPDATED');
 assert.match((await catalog.call('skill:pcb',{})).content,/UPDATED/);
 const next=new DemandCatalog({cwd:tmp,skillRoots:[tmp],builtins:async()=>[]});await assert.rejects(()=>next.call('skill:pcb',{}),/Search/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('skill discovery honors invocation restrictions without preloading tools or skill bodies',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-skill-policy-'));let built=0;
 try{
 for(const [name,flags] of [['manual','disable-model-invocation: true # user only'],['background','user-invocable: false'],['off',''],['changed','']]){await fs.mkdir(path.join(tmp,name));await fs.writeFile(path.join(tmp,name,'SKILL.md'),`---\nname: ${name}\ndescription: specialist\n${flags}\n---\nBODY_SENTINEL`);}
 const catalog=new DemandCatalog({cwd:tmp,skillRoots:[tmp],disabledSkills:['off'],builtins:async()=>{built++;return [];}});
 const search=await catalog.search({query:'specialist',kind:'skill'});
 assert.deepEqual(search.results.map(x=>x.name).sort(),['background','changed']);assert.equal(built,0);
 assert.doesNotMatch(JSON.stringify(search),/BODY_SENTINEL|SKILL.md/);
 await assert.rejects(()=>catalog.call('skill:manual',{}),/Search/);
 assert.match((await catalog.call('skill:background',{})).content,/BODY_SENTINEL/);
 await fs.writeFile(path.join(tmp,'changed','SKILL.md'),'---\nname: changed\ndescription: specialist\ndisable-model-invocation: true\n---\nBODY_SENTINEL');
 await assert.rejects(()=>catalog.call('skill:changed',{}),/no longer permits/);
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('tool search ranks name matches first and compacts oversized enums',async()=>{
 const tool=(name,description,inputSchema={type:'object'})=>({name,description,inputSchema,execute:async()=>name});
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],builtins:async()=>[tool('kicad_actions','Discover kicad actions'),tool('kicad_call','Invoke a kicad action',{type:'object',properties:{action:{type:'string',enum:Array.from({length:50},(_,i)=>'a'+i)}}}),tool('kicad_health','Check CLI and IPC health')]});
 const found=await catalog.search({kind:'tool',query:'kicad health'});
 assert.equal(found.results[0].name,'kicad_health');assert.equal(found.total,3);
 const call=(await catalog.search({kind:'tool',query:'call'})).results[0];
 assert.equal(call.inputSchema.properties.action.enum,undefined);assert.match(call.inputSchema.properties.action.description,/One of 50 values/);
 assert.equal(await catalog.call('tool:kicad_call',{}),'kicad_call');
});

test('task words find the tool that runs a matching action; kind defaults to tool',async()=>{
 const tool=(name,description,actions)=>({name,description,inputSchema:{type:'object'},actions,execute:async()=>name});
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],builtins:async()=>[
  tool('kicad_call','Invoke a typed action'),
  tool('kicad_document','Run a typed document action',[{name:'document.save_copy',keywords:['save as'],text:'save a copy (used for live drc/erc of unsaved edits).'}]),
  tool('kicad_schematic','Run a typed schematic action',[{name:'schematic.erc.run',keywords:['erc','电气规则'],text:'run electrical rules checks'}]),
  tool('kicad_board','Run a typed board action',[{name:'board.stackup.read',keywords:['叠层','stackup'],text:'read the board stackup'},{name:'board.check.unified',keywords:['检查pcb'],text:'one report from native drc plus dfm'},{name:'board.drc.run',mutates:false,inputs:['input','format report|json'],keywords:['drc','设计规则检查'],text:'run design rule checks'},{name:'board.drc.live',text:'live checks in the open editor'}])]});
 const drc=await catalog.search({query:'drc'});
 assert.equal(drc.total,2);assert.equal(drc.results[0].name,'kicad_board','a name segment or keyword outranks a passing mention');
 const names=result=>result.matchedActions.map(action=>action.name);
 assert.deepEqual(names(drc.results[0]),['board.drc.run','board.drc.live','board.check.unified']);assert.deepEqual(names(drc.results[1]),['document.save_copy']);
 assert.deepEqual(drc.results[0].matchedActions[0],{name:'board.drc.run',mutates:false,inputs:['input','format report|json']},'the first call needs no extra lookup');
 assert.equal((await catalog.search({query:'board.drc.live'})).results[0].matchedActions[0].name,'board.drc.live');
 assert.doesNotMatch(JSON.stringify(drc),/design rule checks|设计规则检查/,'action search text is never sent');
 assert.deepEqual(names((await catalog.search({query:'叠层',kind:'tool'})).results[0]),['board.stackup.read']);
 assert.equal((await catalog.search({query:'erc'})).results[0].name,'kicad_schematic','erc keyword beats the drc/erc mention in document.save_copy');
 assert.equal((await catalog.search({query:'typed action'})).results[0].name,'kicad_call','name and description matches still rank');
 await assert.rejects(()=>catalog.search({query:'drc',kind:'tools'}),/kind must be/);
});
