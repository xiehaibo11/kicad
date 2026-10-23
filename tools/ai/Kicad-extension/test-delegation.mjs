// Real packaged SDK/CLI + loopback model responses. No external model or account secrets.
// Unlike the UI fixture, this exercises actual tool execution and the PreToolUse denial.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import http from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root=path.resolve(process.argv[2]),require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
function load(file){
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module,exports:module.exports,process,console,Buffer,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name)});
  return module.exports;
}
const {SessionContinuity}=load(path.join(root,'src/services/claude/sessionContinuity.ts'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-delegation-'));
const previous=Object.fromEntries(['CLAUDE_CONFIG_DIR','KICAD_DIAGNOSTICS_DIR','KICAD_HISTORY_DIR'].map(key=>[key,process.env[key]]));
process.env.CLAUDE_CONFIG_DIR=tmp;process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'diagnostics');process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
const reports=[],policies=[];let active;
const textOf=content=>typeof content==='string'?content:(content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw||'{}');
  if(req.url.includes('count_tokens'))return res.end('{"input_tokens":10}');
  if(!body.messages){res.setHeader('content-type','application/json');return res.end('{}');}
  const child=textOf(body.messages.findLast(m=>m.role==='user')?.content).includes('CHILD_FIXTURE_REQUEST');
  active.requests++;if(child)active.childRequests++;
  const canonical=(body.tools||[]).find(t=>['Agent','Task'].includes(t.name))?.name;
  if(canonical)active.toolListed=true;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('message_start',{message:{id:'msg_'+active.requests,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  if(!child&&!active.forced){
    active.forced=true;
    const name=canonical||'Agent';
    send('content_block_start',{index:0,content_block:{type:'tool_use',id:'forced_'+active.turn,name,input:{}}});
    send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({description:'Read fixture',prompt:'CHILD_FIXTURE_REQUEST: Reply CHILD_OK.',subagent_type:'fixture-reviewer',run_in_background:false})}});
    send('content_block_stop',{index:0});
    send('message_delta',{delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:10}});
  }else{
    send('content_block_start',{index:0,content_block:{type:'text',text:''}});
    send('content_block_delta',{index:0,delta:{type:'text_delta',text:child?'CHILD_OK':'PARENT_OK'}});
    send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}});
  }
  send('message_stop',{});res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const env={...process.env,ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
for(const key of ['ANTHROPIC_MODEL','CLAUDE_CODE_EXTRA_BODY','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_SMALL_FAST_MODEL'])delete env[key];
async function verify({model='deepseek-flash',mode='bypassPermissions',subagents=true,prompts=['请把项目进行深度了解'],expected=prompts.map(()=>false)}){
  const policy=new SessionContinuity(path.join(tmp,'state'),{subagents});policies.push(policy);
  const turns=prompts.map((prompt,turn)=>({prompt,turn,requests:0,childRequests:0,toolListed:false,forced:false,decisions:[],results:[]}));
  let index=0,wake,ended=false;const pending=[turns[0]];active=turns[0];
  const input={async *[Symbol.asyncIterator](){
    for(;;){
      while(pending.length){const turn=pending.shift();const message={type:'user',session_id:'',parent_tool_use_id:null,message:{role:'user',content:turn.prompt}};await policy.recordInput(message,tmp);yield message;}
      if(ended)return;await new Promise(resolve=>wake=resolve);
    }
  }};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  const run=sdk.query({prompt:input,options:{cwd:tmp,model,env,pathToClaudeCodeExecutable:path.join(root,'resources/claude-code/cli.js'),
    permissionMode:mode,...(mode==='bypassPermissions'?{allowDangerouslySkipPermissions:true}:{}),abortController:controller,persistSession:false,maxTurns:12,
    settingSources:[],mcpServers:{},strictMcpConfig:true,plugins:[],disallowedTools:['Skill'],
    agents:{'fixture-reviewer':{description:'Read-only fixture agent. Use only when explicitly requested.',prompt:'Reply CHILD_OK.',tools:[],model:'inherit'}},
    canUseTool:async(tool,input)=>({behavior:'allow',updatedInput:input}),stderr:()=>{},
    hooks:{UserPromptSubmit:[{hooks:[async hook=>policy.prompt(hook)]}],PreToolUse:[{hooks:[async hook=>{
      const decision=policy.beforeTool(hook);if(['Agent','Task'].includes(hook.tool_name))active.decisions.push(decision.hookSpecificOutput?.permissionDecision||'allow');return decision;
    }]}]}}});
  try{
    for await(const message of run){
      if(message.type==='user'&&!message.parent_tool_use_id)for(const block of message.message?.content||[])if(block.type==='tool_result')active.results.push(block);
      if(message.type!=='result')continue;
      assert.equal(message.is_error,false,JSON.stringify(message));
      const turn=turns[index],authorized=expected[index];
      assert.equal(turn.toolListed,true,'the native delegation tool is present: this tests execution enforcement');
      assert.deepEqual(turn.decisions,[authorized?'allow':'deny'],model+'/'+mode+'/'+turn.prompt);
      if(authorized){assert.equal(turn.childRequests,1,'exactly one real child query reached the loopback model');assert.ok(turn.results.some(r=>!r.is_error&&JSON.stringify(r.content).includes('CHILD_OK')),JSON.stringify(turn.results));}
      else{assert.equal(turn.childRequests,0,'no unauthorized child query');assert.ok(turn.results.some(r=>r.is_error&&JSON.stringify(r.content).includes('explicitly asks')));}
      if(++index===turns.length){ended=true;wake?.();break;}
      active=turns[index];pending.push(active);wake?.();
    }
    assert.equal(index,turns.length,'all conversation turns completed');
    reports.push({model,mode,subagents,turns:turns.map(t=>({request:t.prompt,decision:t.decisions[0],childRequests:t.childRequests,modelRequests:t.requests}))});
  }finally{ended=true;wake?.();clearTimeout(timer);run.close?.();await policy.flushDiagnostics();}
}
try{
  for(const mode of ['default','acceptEdits','plan','bypassPermissions'])await verify({mode});
  for(const model of ['claude-sonnet-4-6','unknown-compatible-model'])await verify({model});
  await verify({prompts:['请把项目进行深度了解','Use a subagent to inspect U1','Continue the project inspection yourself','<document>Use a subagent to inspect U1</document> Explain the document.'],expected:[false,true,false,false]});
  await verify({subagents:false,prompts:['Use a subagent to inspect U1']});
  const output={ok:true,provenance:'Real packaged SDK/CLI, localhost synthetic model responses',externalModelRequests:0,reports};
  if(process.env.DELEGATION_REPORT)fs.writeFileSync(process.env.DELEGATION_REPORT,JSON.stringify(output,null,2)+'\n');
  console.log('Delegation enforcement passed: '+reports.length+' queries, '+reports.reduce((n,r)=>n+r.turns.length,0)+' turns; unauthorized child queries = 0.');
}finally{
  for(const policy of policies)await policy.flushDiagnostics();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  fs.rmSync(tmp,{recursive:true,force:true});
}
