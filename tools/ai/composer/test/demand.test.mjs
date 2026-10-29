import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DemandCatalog,demandDefinitions} from '../demand.ts';

test('MCP configuration changes and list notifications invalidate selected tools and annotations',async()=>{
 let changed,closed=0,listed=0,called=0,readonly=true;
 const catalog=new DemandCatalog({cwd:'/fixture',servers:{docs:{command:'first'}},builtins:async()=>[],connect:async()=>({list:async()=>{listed++;return [{name:'lookup',description:'docs',annotations:{readOnlyHint:readonly}}];},call:async()=>{called++;return {};},close:async()=>{closed++;},onToolsChanged(listener){changed=listener;return ()=>{changed=undefined;};}})});
 await catalog.search({query:'',server:'docs'});assert.equal(await catalog.isReadOnly('mcp:docs:lookup'),true);
 readonly=false;changed();assert.equal(await catalog.isReadOnly('mcp:docs:lookup'),false);
 await assert.rejects(()=>catalog.call('mcp:docs:lookup',{}),/Search/);
 await catalog.search({query:'',server:'docs'});assert.equal(listed,2);assert.equal(await catalog.isReadOnly('mcp:docs:lookup'),false);
 catalog.setServers({docs:{command:'first',enabled:false}});
 await assert.rejects(()=>catalog.call('mcp:docs:lookup',{}),/Search|disabled/);assert.equal(called,0);
 catalog.setServers({docs:{command:'second'}});await catalog.search({query:'',server:'docs'});
 await catalog.close();await catalog.close();assert.equal(closed,2);assert.equal(changed,undefined);
 await assert.rejects(()=>catalog.search({query:''}),/closed/);
});
test('MCP connections invalidated while pending close exactly once and cannot publish stale schemas',async()=>{
 for(const cancel of ['config','close']){
  let resolve,closed=0;
  const pending=new Promise(r=>{resolve=r;});
  const catalog=new DemandCatalog({cwd:'/fixture',servers:{docs:{command:'first'}},builtins:async()=>[],connect:()=>pending});
  const search=catalog.search({query:'',server:'docs'});
  const rejected=assert.rejects(search,/changed|closed/);
  let closing;if(cancel==='config')catalog.setServers({});else closing=catalog.close();
  resolve({list:async()=>[{name:'stale'}],call:async()=>{},close:async()=>{closed++;}});
  await rejected;await closing;await catalog.close();assert.equal(closed,1,cancel);
 }
});

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
test('exact select, bounded results, bare ids and JSON-string arguments work across model styles',async()=>{
 const tool=(name)=>({name,description:name,inputSchema:{type:'object'},execute:async()=>name});
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],maxResults:2,builtins:async()=>[tool('a'),tool('b'),tool('c')]});
 const selected=await catalog.search({query:'select:c,a'});
 assert.deepEqual(selected.results.map(x=>x.name),['c','a']);
 assert.equal(await catalog.call('b',{x:1}),'b','a bare built-in id executes without a preceding search');
 assert.equal(await catalog.call('tool:b','{"x":1}'),'b','JSON-string arguments are normalized');
 await assert.rejects(()=>catalog.call('tool:c','not json'),/JSON object/);
 await assert.rejects(()=>catalog.call('tool:c',[]),/arguments must be an object/);
 await assert.rejects(()=>catalog.call('',{}),/id is required/);
});
test('MCP server instructions are returned with the tool discovery result',async()=>{
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],servers:{docs:{}},connect:async()=>({list:async()=>[{name:'lookup',description:'docs'}],call:async()=>({}),close:async()=>{},instructions:'Use lookup for documentation.'})});
 const result=await catalog.search({kind:'tool',query:'docs',server:'docs'});
 assert.equal(result.instructions,'Use lookup for documentation.');
 assert.equal(result.results[0].name,'lookup');
});

test('settings gates, cached indexes, connected-server search and skill arguments',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-demand-opt-'));
 try{
  await fs.mkdir(path.join(tmp,'route'));
  await fs.writeFile(path.join(tmp,'route','SKILL.md'),'---\nname: route\ndescription: '+'x'.repeat(400)+'\nwhen_to_use: >\n  differential pairs and length tuning\nargument-hint: <net>\nallowed-tools: Read, Grep\n---\nRoute $ARGUMENTS carefully.');
  let lists=0,connects=0;
  const remote={list:async()=>{lists++;return [{name:'query_parts',description:'d'.repeat(3000),inputSchema:{type:'object'},annotations:{readOnlyHint:true}}];},call:async(name,args)=>({name,args}),close:async()=>{},instructions:'i'.repeat(5000)};
  const make=(extra={})=>new DemandCatalog({cwd:tmp,skillRoots:[tmp],servers:{parts:{},hidden:{}},disabledServers:['hidden'],connect:async()=>{connects++;return remote;},builtins:async()=>[],...extra});
  const catalog=make();
  // when_to_use participates in ranking; listing text is capped; bodies stay unread.
  const skill=(await catalog.search({kind:'skill',query:'length tuning'})).results[0];
  assert.equal(skill.name,'route');assert.equal(skill.description.length,250);assert.match(skill.whenToUse,/differential/);assert.equal(skill.argumentHint,'<net>');
  const loaded=await catalog.call('skill:route',{arguments:'USB_DP'});
  assert.equal(loaded.content.trim().split('\n').at(-1),'Route USB_DP carefully.');assert.equal(loaded.allowedTools,'Read, Grep');assert.equal(loaded.baseDirectory,path.join(tmp,'route'));
  // Metadata is cached briefly; a new skill appears after the index expires.
  await fs.mkdir(path.join(tmp,'late'));await fs.writeFile(path.join(tmp,'late','SKILL.md'),'---\nname: late\ndescription: late skill\n---\nbody');
  assert.equal((await catalog.search({kind:'skill',query:'late'})).total,0);
  assert.equal((await make({skillCacheMs:0}).search({kind:'skill',query:'late'})).total,1);
  // Disabled servers are invisible; one connection and one tools/list per session.
  assert.deepEqual((await catalog.search({kind:'server',query:''})).results.map(x=>x.name),['parts']);
  await assert.rejects(()=>catalog.search({kind:'tool',query:'',server:'hidden'}),/disabled/);
  const first=await catalog.search({kind:'tool',query:'parts',server:'parts'});
  assert.equal(first.instructions.length,2048);assert.equal(first.results[0].description.length,2048);assert.equal(first.results[0].readOnly,true);
  const again=await catalog.search({query:'query_parts'});
  assert.equal(again.results[0].id,'mcp:parts:query_parts','a connected server is searched without server=');
  assert.equal(connects,1);assert.equal(lists,1);
  assert.deepEqual(await catalog.call('mcp:parts:query_parts',{q:1}),{name:'query_parts',args:{q:1}});
  // Host settings turn sources off with an actionable message.
  await assert.rejects(()=>make({skills:false}).search({kind:'skill',query:''}),/kicadAgent\.skills\.mode/);
  await assert.rejects(()=>make({mcp:false}).search({kind:'server',query:''}),/kicadAgent\.mcp\.mode/);
  await assert.rejects(()=>make({mcp:false}).search({kind:'tool',query:'',server:'parts'}),/kicadAgent\.mcp\.mode/);
  await catalog.close();
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('read-only classification gates capability_inspect',async()=>{
 const executed=[];
 const tool=(name,annotations,actions)=>({name,description:name,inputSchema:{type:'object'},annotations,actions,execute:async args=>{executed.push(name);return {name,args};}});
 const catalog=new DemandCatalog({cwd:'/fixture',skillRoots:[],servers:{ext:{}},connect:async()=>({list:async()=>[{name:'lookup',description:'lookup',inputSchema:{type:'object'},annotations:{readOnlyHint:true}},{name:'write',description:'write',inputSchema:{type:'object'}}],call:async(name)=>({name}),close:async()=>{}}),builtins:async()=>[
  tool('kicad_health',{readOnlyHint:true}),
  tool('local_memory',{readOnlyHint:false}),
  tool('kicad_web',{readOnlyHint:true,openWorldHint:true}),
  tool('kicad_board',{readOnlyHint:false},[{name:'board.drc.run',mutates:false},{name:'board.items.update',mutates:true},{name:'board.unknown'}])]});
 assert.equal(await catalog.isReadOnly('tool:kicad_health',{}),true);
 for(const operation of ['list','read','search'])assert.equal(await catalog.isReadOnly('tool:local_memory',{operation}),true);
 for(const operation of ['append','replace','delete',undefined])assert.equal(await catalog.isReadOnly('tool:local_memory',{operation}),false);
 assert.equal(await catalog.isReadOnly('kicad_board',{action:'board.drc.run'}),true,'bare ids and read-only typed actions');
 for(const [id,args] of [['tool:kicad_board',{action:'board.items.update'}],['tool:kicad_board',{action:'board.unknown'}],['tool:kicad_board',{}],['tool:kicad_web',{}],['tool:missing',{}],['mcp:ext:lookup',{}],['',{}]])
  assert.equal(await catalog.isReadOnly(id,args),false,id+' '+JSON.stringify(args));
 await catalog.search({kind:'tool',query:'',server:'ext'});
 assert.equal(await catalog.isReadOnly('mcp:ext:lookup',{}),true);assert.equal(await catalog.isReadOnly('mcp:ext:write',{}),false);
 assert.deepEqual(await catalog.inspect('tool:kicad_board',{action:'board.drc.run'}),{name:'kicad_board',args:{action:'board.drc.run'}});
 await assert.rejects(()=>catalog.inspect('tool:kicad_board',{action:'board.items.update'}),/only read-only.*board\.items\.update/);
 await assert.rejects(()=>catalog.inspect('mcp:ext:write',{}),/only read-only/);
 assert.deepEqual(executed,['kicad_board']);
});


test('skill roots have deterministic precedence and symlink cycles do not repeat discovery',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-skill-roots-'));
 try{
  for(const root of ['plugin','project']){
   await fs.mkdir(path.join(tmp,root,'fixture'),{recursive:true});
   await fs.writeFile(path.join(tmp,root,'fixture/SKILL.md'),`---\nname: fixture\ndescription: ${root} specialist\n---\n${root} body`);
  }
  await fs.symlink(tmp,path.join(tmp,'plugin','cycle'));
  const catalog=new DemandCatalog({cwd:tmp,skillRoots:[path.join(tmp,'plugin'),path.join(tmp,'project')],builtins:async()=>[]});
  const found=await catalog.search({kind:'skill',query:'specialist'});assert.equal(found.total,1);assert.match(found.results[0].description,/project/);
  assert.match((await catalog.call('skill:fixture',{})).content,/project body/);await catalog.close();
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
