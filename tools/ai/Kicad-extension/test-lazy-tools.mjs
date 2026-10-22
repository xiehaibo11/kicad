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
const policy=load('src/kicadToolsPolicy.ts'),runtime=load('src/kicadRuntime.ts',{'./kicadToolsPolicy':policy});
const config=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-lazy-tools-')),cwd=path.join(config,'lazy project');
fs.mkdirSync(cwd);process.env.CLAUDE_CONFIG_DIR=config;
try{
  // 0. Tools that never prompt only read: every action read-only and local, per the shared definitions.
  for(const name of runtime.READ_ONLY_EDA_TOOLS.map(item=>item.replace(/^mcp__kicad__/,'')).filter(item=>item!=='kicad_load')){
    const definition=direct.toolsList().find(item=>item.name===name);
    assert.ok(definition?.annotations.readOnlyHint&&!definition.annotations.openWorldHint,name+' must be read-only and local');
  }
  assert.ok(runtime.READ_ONLY_EDA_TOOLS.includes('mcp__kicad__kicad_reference'),'the references the guide calls first never prompt');

  // 1. A conversation without KiCad work registers only the loader; the loader asks for the tools.
  let requested=0;
  const lazy=await runtime.getKiCadSdkServers(cwd,{},{tools:false,onLoad:()=>requested++});
  assert.deepEqual(Object.keys(lazy.kicad.instance._registeredTools),['kicad_load']);
  const pending=JSON.parse((await lazy.kicad.instance._registeredTools.kicad_load.handler({},{})).content[0].text);
  assert.equal(pending.data.pending,true);assert.equal(requested,1);
  const full=await runtime.getKiCadSdkServers(cwd,{},{tools:true});
  const names=Object.keys(full.kicad.instance._registeredTools);
  assert.equal(names.length,21);assert.equal(names[0],'kicad_load');assert.ok(names.includes('kicad_board')&&names.includes('kicad_health'));
  const already=JSON.parse((await full.kicad.instance._registeredTools.kicad_load.handler({},{})).content[0].text);
  assert.match(already.data.note,/already loaded/);
  assert.equal(Object.keys((await runtime.getKiCadSdkServers(cwd)).kicad.instance._registeredTools).length,21,'other callers keep the full set');

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
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw)}catch{}
    if(req.url.includes('count_tokens'))return res.end('{"input_tokens":10}');
    const kicad=(body.tools||[]).filter(t=>t.name.startsWith('mcp__kicad__'));
    requests.push({tools:kicad.map(t=>t.name),schemas:Object.fromEntries(kicad.map(t=>[t.name,t])),messages:(body.messages||[]).length});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
    send('message_start',{message:{id:'msg_lazy_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
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
  const options=servers=>({cwd,model:'sonnet',env,pathToClaudeCodeExecutable:path.join(root,'resources/claude-code/cli.js'),mcpServers:servers,strictMcpConfig:true,settingSources:[],hooks:{},plugins:[],stderr:()=>{}});
  try{
    for(const [servers,expectFull] of [[lazy,false],[full,true]]){
      const before=requests.length,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
      const run=sdk.query({prompt:'Reply LAZY_FIXTURE_OK.',options:{...options(servers),persistSession:false,maxTurns:1,abortController:controller}});
      try{let result;for await(const message of run)if(message.type==='result')result=message;assert.equal(result?.is_error,false,JSON.stringify(result));}
      finally{clearTimeout(timer);run.close?.()}
      const request=requests.slice(before).find(item=>item.tools.length),seen=request?.tools;
      assert.ok(seen,'the model request lists the KiCad MCP tools');
      if(expectFull){
        assert.ok(seen.includes('mcp__kicad__kicad_board')&&seen.includes('mcp__kicad__kicad_load'),JSON.stringify(seen));assert.equal(seen.length,21);
        // What the model sees means the same as the shared definitions.
        for(const definition of direct.toolsList()){
          const sent=request.schemas['mcp__kicad__'+definition.name];
          assert.equal(sent.description,definition.description,definition.name);
          sameSchema(definition.inputSchema,sent.input_schema,definition.name);
        }
      }
      else assert.deepEqual(seen,['mcp__kicad__kicad_load']);
    }

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
    assert.deepEqual(first.request.tools,['mcp__kicad__kicad_load']);
    await stored(first.session,'Summarize what is in this folder.');
    assert.equal(await runtime.sessionUsedKiCad(first.session,cwd),false);
    const second=await converse(await runtime.getKiCadSdkServers(cwd,{},{tools:true}),first.session,'Run DRC on this PCB.');
    assert.equal(second.session,first.session,'the relaunch continues the same conversation');
    assert.equal(second.request.tools.length,21);assert.ok(second.request.messages>=3,'earlier messages are kept: '+second.request.messages);
    await stored(first.session,'Run DRC on this PCB.');
    assert.equal(await runtime.sessionUsedKiCad(first.session,cwd),true,'the stored conversation is found and counts as KiCad work');
  }finally{server.close()}
  console.log('Lazy KiCad tools passed: read-only tools without prompts, loader-only registration, on-demand request, full set of 21 with the shared schemas, message intent, stored-session evidence, the packaged CLI tool lists and a same-session relaunch that keeps history.');
}finally{runtime.closeKiCadRuntimes();fs.rmSync(config,{recursive:true,force:true});}
