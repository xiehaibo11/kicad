// KiCad tools on demand in the chat: real SDK registration, the packaged CLI over a localhost model
// fixture, the relaunch that attaches the tools to an ongoing conversation, and the evidence that keeps
// stored conversations loaded. No external model or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]),require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
const settings={directPath:path.join(root,'resources/kicad/kicad-direct.mjs')};
// TypeScript emits the runtime's dynamic import as require(); hand it the real ES module.
const directUrl=pathToFileURL(settings.directPath).href,direct=await import(directUrl);
const vscode={Uri:{file:fsPath=>({fsPath})},extensions:{getExtension:()=>undefined},
  workspace:{getConfiguration:()=>({get:(key,fallback)=>settings[key]??fallback})},
  window:{showErrorMessage(){},showWarningMessage(){},showInformationMessage(){}}};
function load(relative,overrides={}){
  const file=path.join(root,relative);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,process,console,Buffer,URL,setTimeout,clearTimeout,
    require:name=>name==='vscode'?vscode:name==='@anthropic-ai/claude-agent-sdk'?sdk:name===directUrl?direct:overrides[name]??require(name)},{filename:file});
  return module.exports;
}
const policy=load('src/kicadToolsPolicy.ts'),runtime=load('src/kicadRuntime.ts',{'./shared/kicadDemand':load('src/shared/kicadDemand.ts'), './shared/kicadLocalTools':load('src/shared/kicadLocalTools.ts',{'./kicadHistory':load('src/shared/kicadHistory.ts')}), './shared/kicadDiagnostics':load('src/shared/kicadDiagnostics.ts'),'./kicadToolsPolicy':policy});
const config=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-lazy-tools-')),cwd=path.join(config,'lazy project');
fs.mkdirSync(cwd);process.env.CLAUDE_CONFIG_DIR=config;
try{
  // 0. Tools that never prompt only read: every action read-only and local, per the shared definitions.
  for(const name of runtime.READ_ONLY_EDA_TOOLS.map(item=>item.replace(/^mcp__kicad__/,'')).filter(item=>!['kicad_load','runtime_diagnostics','context7','session_history','local_memory'].includes(item))){
    const definition=direct.toolsList().find(item=>item.name===name);
    assert.ok(definition?.annotations.readOnlyHint&&!definition.annotations.openWorldHint,name+' must be read-only and local');
  }
  assert.ok(runtime.READ_ONLY_EDA_TOOLS.includes('mcp__kicad__kicad_reference'),'the references the guide calls first never prompt');

  // Discovery alone registers two tools and never connects configured servers.
  const lazy=await runtime.getKiCadSdkServers(cwd,{unused:{command:'must-not-start'}},{tools:false});
  const expected=['capability_search','capability_call'];
  assert.deepEqual(Object.keys(lazy.kicad.instance._registeredTools),expected);
  const search=async args=>JSON.parse((await lazy.kicad.instance._registeredTools.capability_search.handler(args,{})).content[0].text);
  const call=async(id,args)=>JSON.parse((await lazy.kicad.instance._registeredTools.capability_call.handler({id,arguments:args},{})).content[0].text);
  // Built-in ids stay callable in later turns without a new search; unknown ids never execute.
  await assert.rejects(()=>call('tool:no_such_tool',{}),/Unknown capability id/);
  assert.equal((await call('tool:kicad_board',{})).error.code,'INVALID_ARGUMENTS','the tool itself validates a direct call');
  await assert.rejects(()=>call('mcp:unused:anything',{}),/Search/);
  const found=await search({query:'runtime_diagnostics',kind:'tool'});assert.equal(found.results.length,1);
  const drc=await search({query:'drc'});assert.equal(drc.results[0].name,'kicad_board','kind defaults to tool; task words reach the action');
  assert.equal(drc.results[0].matchedActions[0].name,'board.drc.run');assert.ok(drc.results[0].matchedActions[0].inputs.includes('input'));
  const diagnostic=await call(found.results[0].id,{});assert.equal(diagnostic.events,0);
  const ref=await search({query:'kicad_reference',kind:'tool'});
  assert.equal(ref.results[0].name,'kicad_reference');
  sameSchema(direct.toolsList().find(t=>t.name==='kicad_reference').inputSchema,ref.results[0].inputSchema,'selected reference');
  assert.equal((await call(ref.results[0].id,{action:'reference.plan',payload:{query:'power'}})).ok,true);
  assert.equal(Object.keys(lazy.kicad.instance._registeredTools).length,2,'discovery never expands registration');
  const full=await runtime.getKiCadSdkServers(cwd,{},{tools:true});
  assert.deepEqual(Object.keys(full.kicad.instance._registeredTools),expected,'legacy options cannot expand registration');

  // 2. Which user messages load the tools.
  const user=content=>({type:'user',message:{role:'user',content},parent_tool_use_id:null,session_id:''});
  assert.equal(runtime.wantsKiCadTools(user('跑一下 DRC，看看这块 PCB')),true);
  assert.equal(runtime.wantsKiCadTools(user([{type:'text',text:'<ide_selection>(kicad_sch (version 20250114)</ide_selection>\n解释一下'}])),true);
  assert.equal(runtime.wantsKiCadTools(user('写一个 Python 脚本整理日志')),false);
  assert.equal(runtime.wantsKiCadTools(user([{type:'tool_result',tool_use_id:'x',content:'kicad_board DRC 原理图'}])),false,'tool output never loads the tools');

  // 3. Stored conversations keep the tools when they already used them.
  const projects=path.join(config,'projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));fs.mkdirSync(projects,{recursive:true});
  const line=value=>JSON.stringify(value)+'\n';
  const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
  fs.writeFileSync(path.join(projects,ids[0]+'.jsonl'),line({type:'user',message:{role:'user',content:'check this'}})+line({type:'assistant',message:{content:[{type:'tool_use',id:'t',name:'mcp__kicad__kicad_board',input:{}}]}}));
  fs.writeFileSync(path.join(projects,ids[1]+'.jsonl'),line({type:'user',message:{role:'user',content:'summarize the folder'}})+line({type:'assistant',message:{content:[{type:'tool_use',id:'t',name:'mcp__kicad__kicad_load',input:{}}]}}));
  fs.writeFileSync(path.join(projects,ids[2]+'.jsonl'),line({type:'user',message:{role:'user',content:'检查一下原理图的电源'}})+'{"type":"user","message":');
  assert.equal(await runtime.sessionUsedKiCad(ids[0],cwd),true);
  assert.equal(await runtime.sessionUsedKiCad(ids[1],cwd),false,'a pending loader call alone is not KiCad use');
  assert.equal(await runtime.sessionUsedKiCad(ids[2],cwd),true,'a KiCad request counts; a partial last line is ignored');
  assert.equal(await runtime.sessionUsedKiCad(ids[3],cwd),false);
  assert.equal(await runtime.sessionUsedKiCad('../escape',cwd),false);
  runtime.rememberKiCadSession(ids[3]);assert.equal(await runtime.sessionUsedKiCad(ids[3],cwd),true);

  // 4. The packaged CLI shows the model only what the process registered.
  const requests=[];let sequence=-1;
  const steps=[['capability_search',{kind:'tool',query:'runtime_diagnostics'}],['capability_call',{id:'tool:runtime_diagnostics',arguments:{}}],['capability_search',{kind:'skill',query:'fixture-specialist'}],['capability_call',{id:'skill:fixture',arguments:{}}],['capability_search',{kind:'tool',query:'echo',server:'selected'}],['capability_call',{id:'mcp:selected:echo',arguments:{}}]];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw)}catch{}
    if(req.url.includes('count_tokens'))return res.end('{"input_tokens":10}');
    const kicad=(body.tools||[]).filter(t=>t.name.startsWith('mcp__kicad__'));
    if(!body.messages){res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');return;}
    requests.push({tools:kicad.map(t=>t.name),schemas:Object.fromEntries(kicad.map(t=>[t.name,t])),messages:(body.messages||[]).length,payload:body});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
    send('message_start',{message:{id:'msg_lazy_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
    if(sequence>=0&&sequence<steps.length){const [name,input]=steps[sequence++];send('content_block_start',{index:0,content_block:{type:'tool_use',id:'demand_'+sequence,name:'mcp__kicad__'+name,input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});res.end();return;}
    send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'LAZY_FIXTURE_OK'}});
    send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}});send('message_stop',{});res.end();
  });
  function sameSchema(want,got,at){
    if(want.enum)assert.deepEqual(got.enum,want.enum,at+' enum');
    if(want.type)assert.equal(got.type,want.type,at+' type');
    if(want.minimum!==undefined)assert.equal(got.minimum,want.minimum,at+' minimum');
    if(want.type==='array')sameSchema(want.items,got.items??{},at+'[]');
    if(want.type!=='object')return;
    assert.deepEqual(new Set(got.required??[]),new Set(want.required??[]),at+' required');
    assert.deepEqual(new Set(Object.keys(got.properties??{})),new Set(Object.keys(want.properties??{})),at+' properties');
    for(const [key,sub] of Object.entries(want.properties??{}))sameSchema(sub,got.properties[key],at+'.'+key);
    if(want.additionalProperties===true)assert.notEqual(got.additionalProperties,false,at+' accepts any payload field');
  }
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
  for(const name of ['ANTHROPIC_MODEL','CLAUDE_CODE_EXTRA_BODY','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_SMALL_FAST_MODEL'])delete env[name];
  const options=servers=>({cwd,model:'sonnet',env,pathToClaudeCodeExecutable:path.join(root,'resources/claude-code/cli.js'),mcpServers:servers,strictMcpConfig:true,settingSources:[],extraArgs:{'disable-slash-commands':null},disallowedTools:['Skill'],hooks:{},plugins:[],stderr:()=>{}});
  try{
    for(const [servers,expectFull] of [[lazy,false],[full,true]]){
      const before=requests.length,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
      const run=sdk.query({prompt:'Reply LAZY_FIXTURE_OK.',options:{...options(servers),persistSession:false,maxTurns:1,abortController:controller}});
      try{let result;for await(const message of run)if(message.type==='result')result=message;assert.equal(result?.is_error,false,JSON.stringify(result));}
      finally{clearTimeout(timer);run.close?.()}
      const request=requests.slice(before).find(item=>item.tools.length),seen=request?.tools;
      assert.ok(seen,'the model request lists the KiCad MCP tools');
      assert.deepEqual(seen,['mcp__kicad__capability_call','mcp__kicad__capability_search']);
    }

    // Real CLI executes search -> call in one query, including an external MCP and a skill.
    const skillDir=path.join(cwd,'.claude/skills/fixture');fs.mkdirSync(skillDir,{recursive:true});
    fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: fixture\ndescription: fixture-specialist\n---\nSKILL_BODY_ONLY_ON_DEMAND');
    const marker=path.join(config,'selected-started'),unused=path.join(config,'unused-started'),fixture=path.join(config,'mcp.cjs');
    fs.writeFileSync(fixture,`const fs=require('node:fs');fs.writeFileSync(process.argv[2],'started');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:r.method==='tools/list'?{tools:[{name:'echo',description:'fixture echo',inputSchema:{type:'object',properties:{}}}]}:r.method==='tools/call'?{content:[{type:'text',text:'MCP_DEMAND_OK'}]}:{};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`);
    const servers=await runtime.getKiCadSdkServers(cwd,{selected:{command:process.execPath,args:[fixture,marker]},unused:{command:process.execPath,args:[fixture,unused]}});
    assert.equal(fs.existsSync(marker),false);sequence=0;const beforeSequence=requests.length;
    const run=sdk.query({prompt:'Inspect runtime diagnostics, load fixture specialist skill and call selected MCP echo. No design changes.',options:{...options(servers),persistSession:false,maxTurns:8,permissionMode:'bypassPermissions',allowDangerouslySkipPermissions:true}});
    let result;try{for await(const message of run)if(message.type==='result')result=message;}finally{run.close?.();sequence=-1;}
    assert.equal(result?.is_error,false);const observed=requests.slice(beforeSequence);assert.equal(observed.length,7);
    assert.ok(observed.every(request=>request.tools.length===2));
    assert.ok(!JSON.stringify(observed[0].payload).includes('The following skills are available'));
    assert.ok(!JSON.stringify(observed[3].payload).includes('SKILL_BODY_ONLY_ON_DEMAND'));
    assert.ok(JSON.stringify(observed[4].payload).includes('SKILL_BODY_ONLY_ON_DEMAND'));
    assert.ok(JSON.stringify(observed[6].payload).includes('MCP_DEMAND_OK'));
    assert.ok(fs.existsSync(marker));assert.equal(fs.existsSync(unused),false);

    // 5. Like the chat: a streamed conversation without the tools, then relaunched on the same session
    // with them. History is kept and the stored conversation (under the real project path) counts as KiCad work.
    async function converse(servers,resume,text){
      const items=[];let wake,ended=false;
      const input={async*[Symbol.asyncIterator](){for(;;){while(items.length)yield items.shift();if(ended)return;await new Promise(resolve=>wake=resolve);}}};
      const before=requests.length,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
      const run=sdk.query({prompt:input,options:{...options(servers),...(resume?{resume}:{}),abortController:controller}});
      items.push({type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:''});wake?.();
      let session,result;
      try{for await(const message of run){session??=message.session_id;if(message.type==='result'){result=message;break;}}}
      finally{clearTimeout(timer);ended=true;wake?.();run.close?.()}
      assert.equal(result?.is_error,false,JSON.stringify(result));
      return {session,request:requests.slice(before).find(request=>request.tools.length)};
    }
    // The CLI writes the transcript under the real path; it may land just after the process is closed.
    async function stored(session,text){
      const file=path.join(config,'projects',fs.realpathSync(cwd).replace(/[^a-zA-Z0-9]/g,'-'),session+'.jsonl');
      for(let i=0;i<100;i++){try{if(fs.readFileSync(file,'utf8').includes(text))return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
      throw Error('transcript not written: '+text);
    }
    const first=await converse(await runtime.getKiCadSdkServers(cwd,{},{tools:false}),undefined,'Summarize what is in this folder.');
    assert.deepEqual(first.request.tools,['mcp__kicad__capability_call','mcp__kicad__capability_search']);
    await stored(first.session,'Summarize what is in this folder.');
    assert.equal(await runtime.sessionUsedKiCad(first.session,cwd),false);
    const second=await converse(await runtime.getKiCadSdkServers(cwd,{},{tools:true}),first.session,'Run DRC on this PCB.');
    assert.equal(second.session,first.session,'the relaunch continues the same conversation');
    assert.equal(second.request.tools.length,2);assert.ok(second.request.messages>=3,'earlier messages are kept: '+second.request.messages);
    await stored(first.session,'Run DRC on this PCB.');
    assert.equal(await runtime.sessionUsedKiCad(first.session,cwd),true,'the stored conversation is found and counts as KiCad work');
  }finally{server.close()}
  console.log('Lazy KiCad tools passed: read-only tools without prompts, two stable discovery tools, selected schema and direct execution, message intent, stored-session evidence, the packaged CLI tool lists and a same-session relaunch that keeps history.');
}finally{runtime.closeKiCadRuntimes();fs.rmSync(config,{recursive:true,force:true});}
