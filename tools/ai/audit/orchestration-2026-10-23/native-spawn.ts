// Isolated native app-server + loopback model fixture; no real model or credentials.
// Run: bun tools/ai/audit/orchestration-2026-10-23/native-spawn.ts
import {CodexClient,executable} from '../../membership/local.ts';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-native-policy-'));process.env.CODEX_HOME=tmp;
const requests:any[]=[],events:any[]=[],dynamicReplies:any[]=[];let childCalled=false,childToolListed=false;
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);let bytes=Buffer.concat(chunks);
 if(req.headers['content-encoding']==='gzip')bytes=zlib.gunzipSync(bytes);
 if(req.headers['content-encoding']==='zstd')bytes=zlib.zstdDecompressSync(bytes);
 if(!bytes.length){res.writeHead(200,{'content-type':'application/json'});res.end('{"models":[]}');return;}
 const body=JSON.parse(bytes.toString());requests.push(body);
 const messageItem={type:'message',id:'msg_'+requests.length,role:'assistant',content:[{type:'output_text',text:'Fixture completed.',annotations:[]}]};
 const isChild=body.input.some((x:any)=>x.type==='agent_message'&&x.recipient==='/root/review_fixture');  if(isChild)childToolListed ||= body.tools.some((t:any)=>t.name==='capability_inspect');const item=isChild&&!childCalled?(childCalled=true,{type:'function_call',id:'fc_child',call_id:'child-inspect',name:'capability_inspect',arguments:'{}'}):requests.length===2?{type:'function_call',id:'fc_fixture',call_id:'fixture-spawn',name:'spawn_agent',namespace:'collaboration',arguments:JSON.stringify({task_name:'review_fixture',message:'Inspect the fixture and reply with completion. Do not call tools.'})}:messageItem;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const send=(type:string,data:any)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 send('response.created',{response:{id:'r_'+requests.length,status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...item,content:[]}});
 send('response.output_item.done',{output_index:0,item});
 send('response.completed',{response:{id:'r_'+requests.length,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:3,total_tokens:13}}});res.end();
});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base={model:'fixture',modelProvider:'fixture',cwd:tmp,approvalPolicy:'never',sandbox:'read-only',dynamicTools:[{name:'capability_inspect',description:'Read fixture data',inputSchema:{type:'object',properties:{}}}],config:{'model_providers.fixture':{name:'fixture',base_url:'http://127.0.0.1:'+((server.address() as any).port)+'/v1',wire_api:'responses',requires_openai_auth:false},'features.multi_agent_v2':false,mcp_servers:{},'skills.config':[]}};
let id='',client:any;
try{
 for(const authorized of [false,true,false]){
  client=await new CodexClient(tmp).init();client.onRequest=async(method,p)=>{dynamicReplies.push({method,threadId:p.threadId,tool:p.tool});return {contentItems:[{type:'inputText',text:'Fixture read-only result'}],success:true};};
  const result=await client.call(id?'thread/resume':'thread/start',{...base,...(id?{threadId:id}:{}),config:{...base.config,'features.multi_agent':authorized,'features.multi_agent_v2':authorized,'agents.enabled':authorized}});id=result.thread.id;
  let childResolve:any;const childDone=new Promise<void>(resolve=>childResolve=resolve);const completed=new Promise<void>((resolve,reject)=>{client.onEvent=(method:string,p:any)=>{if(method==='item/completed')events.push(p.item);if(method==='turn/completed'&&p.threadId!==id)childResolve();if(method==='turn/completed'&&p.threadId===id){p.turn.status==='completed'?resolve():reject(Error(JSON.stringify(p.turn.error)));}};});
  await client.call('turn/start',{threadId:id,input:[{type:'text',text:authorized?'Use a subagent to inspect the fixture.':'Read the fixture yourself.'}]});
  let timer:any; try { await Promise.race([completed.then(async()=>{if(authorized)await childDone;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture timeout')),20000);})]); } finally { clearTimeout(timer); } client.close();client=undefined;
 }
 const hasSpawn=(tools:any[]):boolean=>tools.some(t=>t.name==='spawn_agent'||Array.isArray(t.tools)&&hasSpawn(t.tools)); const enabled=requests.map(r=>hasSpawn(r.tools));
 assert.equal(enabled[0],false);assert.equal(enabled[1],true);assert.equal(enabled.at(-1),false);assert.ok(events.some(e=>e.type==='subAgentActivity'&&e.kind==='started'&&e.agentThreadId),'native child was launched');assert.ok(requests.some(r=>JSON.stringify(r.input).includes('Inspect the fixture and reply with completion. Do not call tools.')),'native child reached the local model fixture');assert.equal(childToolListed,true,'dynamic tool schema was available to the child');assert.ok(dynamicReplies.some(r=>r.tool==='capability_inspect'&&r.threadId!==id),'native child used the dynamic tool');
 console.log(JSON.stringify({ok:true,nativeCli:execFileSync(executable('codex')!,['--version'],{encoding:'utf8'}).trim(),isolatedHome:true,requests:requests.length,sameThreadColdResumed:true,nativeSpawnVisibility:enabled,nativeChildLaunched:true,childDynamicToolSchemaListed:childToolListed,dynamicReplies,externalModelRequests:0}));
} catch(error) { console.error(error); process.exitCode=1; } finally{client?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fs.rm(tmp,{recursive:true,force:true});}
