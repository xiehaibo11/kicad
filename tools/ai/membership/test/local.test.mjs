import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {membershipEnvironment,claudeModels,discoverMembership,CodexClient,codexText} from '../local.ts';
test('membership environment and complete model IDs',()=>{
 const source={PATH:'/bin',ANTHROPIC_API_KEY:'fixture-secret',ANTHROPIC_BASE_URL:'https://fixture.invalid',OPENAI_API_KEY:'fixture-key',DEEPSEEK_API_KEY:'unchanged'};
 assert.deepEqual(membershipEnvironment(source),{PATH:'/bin',DEEPSEEK_API_KEY:'unchanged'});assert.equal(source.ANTHROPIC_API_KEY,'fixture-secret');
 const list=claudeModels([{value:'default',resolvedModel:'claude-fixture-1',description:'Fixture 1 · default'},{value:'opus',resolvedModel:'claude-fixture-1',description:'Fixture 1 · best'}]);
 assert.equal(list.length,1);assert.equal(list[0].value,'claude-fixture-1');assert.deepEqual(list[0].aliases,['default','opus']);assert.equal(list[0].displayName,'Fixture 1');
});
test('local CLI discovery paginates, sanitizes account details and does not infer membership from models',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-member-test-'));const old={codex:process.env.KICAD_CODEX_PATH,claude:process.env.KICAD_CLAUDE_PATH,home:process.env.CODEX_HOME};const previousFetch=globalThis.fetch;
 try{
  const codex=path.join(dir,'codex'),claude=path.join(dir,'claude');
  await fs.writeFile(codex,`#!/usr/bin/env node\nconst r=require('node:readline').createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);let result={};if(m.method==='account/read')result={account:{type:'chatgpt',planType:'fixture',email:'private@example.test',accessToken:'secret'}};if(m.method==='model/list')result=m.params.cursor?{data:[{model:'fixture-b',displayName:'B'}],nextCursor:null}:{data:[{model:'fixture-a',displayName:'A'}],nextCursor:'next'};if(m.id)console.log(JSON.stringify({id:m.id,result}));});`,{mode:0o700});
  await fs.writeFile(claude,`#!/usr/bin/env node\nconst assert=require('node:assert/strict'),args=process.argv.slice(2);for(const flag of ['--strict-mcp-config','--disable-slash-commands'])assert.ok(args.includes(flag));assert.equal(args[args.indexOf('--disallowedTools')+1],'Skill');assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config')+1]),{mcpServers:{}});\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({type:'control_response',response:{request_id:m.request_id,response:{models:[{value:'opus',resolvedModel:'claude-fixture',description:'Fixture · test'}],account:{subscriptionType:'Pro',apiProvider:'firstParty',email:'private@example.test',token:'secret'}}}}));});`,{mode:0o700});
  process.env.KICAD_CODEX_PATH=codex;process.env.KICAD_CLAUDE_PATH=claude;
  const result=await discoverMembership(dir);assert.equal(result.supportedModels.length,3);assert.equal(result.accounts.codex.type,'chatgpt');assert.doesNotMatch(JSON.stringify(result),/secret|private@example/);
  process.env.CODEX_HOME=dir;await fs.writeFile(path.join(dir,'auth.json'),JSON.stringify({tokens:{access_token:'fixture-only',account_id:'fixture-account'}}));
  let complete=true;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://chatgpt.com/backend-api/codex/responses');const body=JSON.parse(init.body);assert.equal(body.model,'fixture-a');assert.equal(body.tools.length,0);assert.equal(body.store,false);return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'fixture reply'})+'\n\n'+(complete?'data: '+JSON.stringify({type:'response.completed'})+'\n\n':''));};
  assert.equal(await codexText('codex:fixture-a','prompt','instructions',new AbortController().signal),'fixture reply');complete=false;await assert.rejects(codexText('codex:fixture-a','prompt','instructions',new AbortController().signal),/未收到完成确认/);
  const client=await new CodexClient(dir).init();client.close();await assert.rejects(client.call('anything',{},30),/closed/);
 }finally{globalThis.fetch=previousFetch;for(const [key,value] of [['KICAD_CODEX_PATH',old.codex],['KICAD_CLAUDE_PATH',old.claude],['CODEX_HOME',old.home]])value===undefined?delete process.env[key]:process.env[key]=value;await fs.rm(dir,{recursive:true,force:true});}
});
test('model discovery is shared, answers from the last result and carries effort tiers',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-member-cache-'));const old={codex:process.env.KICAD_CODEX_PATH,claude:process.env.KICAD_CLAUDE_PATH};
 try{
  const starts=path.join(dir,'starts'),codex=path.join(dir,'codex'),claude=path.join(dir,'claude');
  const count=`require('node:fs').appendFileSync(${JSON.stringify(starts)},'x');`;
  await fs.writeFile(codex,`#!/usr/bin/env node\n${count}require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result={};if(m.method==='account/read')result={account:{type:'chatgpt',planType:'fixture'}};if(m.method==='model/list')result={data:[{model:'gpt-fixture',displayName:'GPT-9-Fixture',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}]}],nextCursor:null};if(m.id)console.log(JSON.stringify({id:m.id,result}));});`,{mode:0o700});
  await fs.writeFile(claude,`#!/usr/bin/env node\n${count}require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({type:'control_response',response:{request_id:m.request_id,response:{models:[{value:'opus',resolvedModel:'claude-fixture',description:'Fixture · test',supportedEffortLevels:['low','max'],supportsThinkingOff:false}],account:{subscriptionType:'Pro'}}}}));});`,{mode:0o700});
  process.env.KICAD_CODEX_PATH=codex;process.env.KICAD_CLAUDE_PATH=claude;
  const {cachedMembership}=await import('../local.ts');
  const first=cachedMembership(dir),second=cachedMembership(dir);assert.equal(first,second,'concurrent callers share one discovery');
  const result=await first;assert.equal((await fs.readFile(starts,'utf8')).length,2);
  assert.deepEqual(result.supportedModels.map(m=>[m.value,m.reasoningEfforts,m.thinkingOff]),[['claude-fixture',['low','max'],false],['codex:gpt-fixture',['low','ultra'],undefined]]);
  assert.equal(await cachedMembership(dir),result,'fresh result is reused');
  assert.equal(await cachedMembership(dir,0),result,'stale result answers at once while refreshing');
  for(let i=0;i<100&&(await fs.readFile(starts,'utf8')).length<4;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal((await fs.readFile(starts,'utf8')).length,4,'one background refresh');
 }finally{for(const [key,value] of [['KICAD_CODEX_PATH',old.codex],['KICAD_CLAUDE_PATH',old.claude]])value===undefined?delete process.env[key]:process.env[key]=value;await new Promise(r=>setTimeout(r,200));await fs.rm(dir,{recursive:true,force:true});}
});
