// Every reasoning level offered for every locally discovered model reaches the wire
// as the vendor expects. Uses the installed claude/codex CLIs against localhost
// fixtures with throwaway config homes: no credentials, no external model calls.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/shared/kicadReasoning.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
const {registerReasoningModels,reasoningOptions,applyReasoningEnvironment,codexReasoningEffort}=mod.exports;
const {discoverMembership,executable}=await import(path.join(root,'src/shared/kicadMembership.ts'));
const discovered=(await discoverMembership(os.tmpdir())).supportedModels;
registerReasoningModels(discovered);
const onlyDeepSeek=process.env.REASONING_ONLY==='deepseek',onlyPolicy=process.env.REASONING_ONLY==='codex-policy';
const claudeModels=onlyPolicy?[]:onlyDeepSeek?['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash'].map(value=>({value})):discovered.filter(m=>!m.value.startsWith('codex:')),codexModels=onlyDeepSeek?[]:discovered.filter(m=>onlyPolicy?m.value==='codex:gpt-6.1-sol':m.value.startsWith('codex:'));
assert.ok(claudeModels.length||codexModels.length,'no local Claude or Codex models discovered');
const report={claudeCli:executable('claude')&&execFileSync(executable('claude'),['--version'],{encoding:'utf8'}).trim(),codexCli:executable('codex')&&execFileSync(executable('codex'),['--version'],{encoding:'utf8'}).trim(),cases:[]};
const levelsOf=model=>Array.from(reasoningOptions(model),o=>o.value);

// One SSE fixture serves both Anthropic Messages and OpenAI Responses requests.
let seen=[];
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const data of req)raw+=data;let body={};try{body=JSON.parse(raw)}catch{}
 if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));
 const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 if(req.url.includes('/messages')){
  seen.push({model:body.model,effort:body.output_config?.effort,thinking:body.thinking?.type});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  send('message_start',{message:{id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK'}});
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});send('message_stop',{});return res.end();
 }
 if(req.url.includes('/responses')){
  // The latest multi-agent mode message in the thread decides whether delegation is on.
  const modes=JSON.stringify(body.input??'').match(/<multi_agent_mode>.*?<\/multi_agent_mode>/g)??[];
  seen.push({model:body.model,effort:body.reasoning?.effort,delegation:/delegation is active/.test(modes.at(-1)??''),...(onlyPolicy?{delegateTools:(body.tools||[]).map(t=>t.name).filter(n=>/spawn_agent|send_input|wait_agent|resume_agent/.test(n||''))}:{})});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  send('response.created',{response:{id:'resp_fixture'}});
  send('response.output_item.done',{item:{type:'message',role:'assistant',id:'msg_fixture',content:[{type:'output_text',text:'OK'}]}});
  send('response.completed',{response:{id:'resp_fixture',usage:{input_tokens:1,input_tokens_details:null,output_tokens:1,output_tokens_details:null,total_tokens:2}}});return res.end();
 }
 res.writeHead(404);res.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-reasoning-local-'));
try{
 for(const {value:model} of claudeModels){
  if(!onlyDeepSeek)assert.ok(!levelsOf(model).includes('off'),model+' keeps adaptive thinking on; None must not be offered');
  for(const level of levelsOf(model)){
   const env={...process.env,ANTHROPIC_BASE_URL:base,ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CONFIG_DIR:temp,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
   for(const name of ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','CLAUDE_CODE_EXTRA_BODY','CLAUDE_CODE_EFFORT_LEVEL','ANTHROPIC_MODEL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX'])delete env[name];
   applyReasoningEnvironment(model,level,env);
   seen=[];
   const code=await new Promise(resolve=>{const child=spawn(executable('claude'),['-p','Reply OK','--model',model,'--output-format','json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}'],{cwd:temp,env,stdio:['ignore','ignore','ignore']});const timer=setTimeout(()=>child.kill(),60000);child.on('exit',c=>{clearTimeout(timer);resolve(c)})});
   const request=seen.find(r=>r.model===model);
   assert.equal(code,0,model+' '+level+' CLI failed');assert.ok(request,model+' '+level+' must reach HTTP');
   // Auto leaves Claude Code's own default (settings, else its per-model default) in charge.
   if(level==='off')assert.equal(request.thinking,'disabled');
   else if(level==='default_on')assert.ok(request.effort===undefined||levelsOf(model).includes(request.effort),model+' Auto sent '+request.effort);
   else assert.equal(request.effort,level,model+' '+level+' wire effort');
   report.cases.push({provider:onlyDeepSeek?'deepseek':'claude',model,level,wire:request});console.log('claude',model,level,'=>',JSON.stringify(request));
  }
 }
 if(codexModels.length){
  const home=path.join(temp,'codex');fs.mkdirSync(home);
  const env={...process.env,CODEX_HOME:home,FIXTURE_KEY:'fixture-only'};delete env.OPENAI_API_KEY;
  const child=spawn(executable('codex'),['app-server','-c','model_provider="fixture"','-c','model_providers.fixture.name="fixture"','-c',`model_providers.fixture.base_url="${base}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.env_key="FIXTURE_KEY"'],{cwd:temp,env,stdio:['pipe','pipe','ignore']});
  let id=0;const pending=new Map(),events=[];
  createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}
   if(m.method&&m.id!==undefined)return child.stdin.write(JSON.stringify({id:m.id,result:{decision:'decline'}})+'\n');
   if(m.method)return events.push(m);
   pending.get(m.id)?.(m);pending.delete(m.id);
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>reject(Error('codex '+method+' timeout')),30000);pending.set(n,m=>{clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m.result)});child.stdin.write(JSON.stringify({id:n,method,params})+'\n')});
  try{
   await call('initialize',{clientInfo:{name:'kicad',title:'KiCad',version:'test'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
   for(const entry of codexModels){
    const model=entry.value;
    const known=['none','minimal','low','medium','high','xhigh','max','ultra'];
    assert.deepEqual(levelsOf(model).filter(l=>l!=='default_on').map(l=>l==='off'?'none':l).sort(),entry.reasoningEfforts.filter(e=>known.includes(e)).sort(),model+' must offer exactly the advertised tiers');
    const {thread}=await call('thread/start',{model:model.slice(6),cwd:temp,approvalPolicy:'never',sandbox:'read-only',...(onlyPolicy?{config:{'agents.enabled':false,'features.multi_agent':false,'features.multi_agent_v2':false}}:{})});
    for(const level of (onlyPolicy?['ultra']:levelsOf(model))){
     const effort=codexReasoningEffort(model,level);
     assert.ok(level==='default_on'?effort===undefined:entry.reasoningEfforts.includes(effort),model+' '+level+' maps to advertised effort '+effort);
     seen=[];events.length=0;
     await call('turn/start',{threadId:thread.id,input:[{type:'text',text:'Reply OK'}],...(effort?{effort}:{})});
     const until=Date.now()+30000;while(!events.some(e=>e.method==='turn/completed')&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
     const turn=events.find(e=>e.method==='turn/completed')?.params.turn,request=seen.at(-1);
     assert.equal(turn?.status,'completed',model+' '+level+' turn');assert.ok(request,model+' '+level+' must reach HTTP');
     // Raw installed Codex CLI behavior, without KiCad host policy overrides.
     // test-membership covers our independent explicit-request delegation gate.
     if(level==='ultra'){assert.ok(['xhigh','max'].includes(request.effort));assert.equal(request.delegation,!onlyPolicy);if(onlyPolicy)assert.deepEqual(request.delegateTools,[],'Host policy must remove native delegation tools even at Ultra');}
     else if(effort){assert.equal(request.effort,effort,model+' '+level+' wire effort');assert.equal(request.delegation,false);}
     report.cases.push({provider:'codex',model,level,effort,wire:request});console.log('codex',model,level,'=>',JSON.stringify(request));
    }
   }
  }finally{child.kill();}
 }
 const out=path.join(path.dirname(new URL(import.meta.url).pathname),'audit',onlyDeepSeek?'reasoning-deepseek-local.json':onlyPolicy?'reasoning-codex-policy-local.json':'reasoning-local.json');
 fs.writeFileSync(out,JSON.stringify({ok:true,fixture:'installed CLIs + localhost HTTP; no external model',...report},null,1)+'\n');
 console.log('Reasoning local passed:',report.cases.length,'model/level cases across',claudeModels.length,'Claude and',codexModels.length,'Codex models.');
}finally{server.close();fs.rmSync(temp,{recursive:true,force:true});}
