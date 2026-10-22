// Real SDK and packaged CLI over HTTP; local fixture only, no external model.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const {query}=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/shared/kicadReasoning.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
const requests=[],temp=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-effort-http-'));
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const data of req)raw+=data;let body={};try{body=JSON.parse(raw)}catch{}
 if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));
 requests.push({model:body.model,effort:body.output_config?.effort,thinking:body.thinking,path:req.url});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 send('message_start',{message:{id:'msg_effort_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
 send('content_block_start',{index:0,content_block:{type:'text',text:''}});
 send('content_block_delta',{index:0,delta:{type:'text_delta',text:'FIXTURE_OK'}});
 send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}});send('message_stop',{});res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 for(const [model,levels] of [['deepseek-flash',['low','high','max','off','default_on']],['deepseek-v4-pro',['max']],['sonnet',['low','medium','high']],['opus',['max']]])for(const level of levels){
  const env={...process.env,ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.address().port,ANTHROPIC_API_KEY:'fixture-only',ANTHROPIC_AUTH_TOKEN:'fixture-only',CLAUDE_CONFIG_DIR:temp,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
  delete env.CLAUDE_CODE_EXTRA_BODY;delete env.ANTHROPIC_MODEL;
  for(const name of ['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_SMALL_FAST_MODEL'])delete env[name];
  mod.exports.applyReasoningEnvironment(model,level,env);
  const before=requests.length;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  const run=query({prompt:'KICAD_EFFORT_FIXTURE. Reply FIXTURE_OK.',options:{cwd:temp,model,env,pathToClaudeCodeExecutable:path.join(root,'resources/claude-code/cli.js'),tools:[],mcpServers:{},strictMcpConfig:true,settingSources:[],persistSession:false,hooks:{},plugins:[],maxTurns:1,maxThinkingTokens:level==='off'?0:31999,abortController:controller,stderr:()=>{}}});
  try{let result;for await(const message of run)if(message.type==='result')result=message;assert.equal(result?.is_error,false,JSON.stringify(result));}finally{clearTimeout(timer);run.close?.()}
  const request=requests.slice(before).find(r=>r.path.includes('/messages'));
  assert.ok(request,'request must reach HTTP transport');
  if(!['default_on','off'].includes(level))assert.equal(request.effort,level,model+' '+level+' must reach provider unchanged');
  if(level==='off')assert.ok(!request.thinking||request.thinking.type==='disabled');
  console.log(model,level,'=>',JSON.stringify(request));
 }
 const out=path.join(path.dirname(new URL(import.meta.url).pathname),'audit','reasoning-http.json');
 fs.writeFileSync(out,JSON.stringify({ok:true,fixture:'real SDK/CLI + localhost HTTP; no external model',cases:requests},null,2)+'\n');
}finally{server.close()}
