// Isolated native app-server + loopback model fixture; no real model or credentials.
// Run: bun tools/ai/audit/orchestration-2026-10-23/native-policy.ts
import {CodexClient,executable} from '../../membership/local.ts';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-native-policy-'));process.env.CODEX_HOME=tmp;
const requests:any[]=[];
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);let bytes=Buffer.concat(chunks);
 if(req.headers['content-encoding']==='gzip')bytes=zlib.gunzipSync(bytes);
 if(req.headers['content-encoding']==='zstd')bytes=zlib.zstdDecompressSync(bytes);
 if(!bytes.length){res.writeHead(200,{'content-type':'application/json'});res.end('{"models":[]}');return;}
 const body=JSON.parse(bytes.toString());requests.push(body);
 const item={type:'message',id:'msg_'+requests.length,role:'assistant',content:[{type:'output_text',text:'Fixture completed.',annotations:[]}]};
 res.writeHead(200,{'content-type':'text/event-stream'});
 const send=(type:string,data:any)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
 send('response.created',{response:{id:'r_'+requests.length,status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...item,content:[]}});
 send('response.output_item.done',{output_index:0,item});
 send('response.completed',{response:{id:'r_'+requests.length,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:3,total_tokens:13}}});res.end();
});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base={model:'fixture',modelProvider:'fixture',cwd:tmp,approvalPolicy:'never',sandbox:'read-only',config:{'model_providers.fixture':{name:'fixture',base_url:'http://127.0.0.1:'+((server.address() as any).port)+'/v1',wire_api:'responses',requires_openai_auth:false},'features.multi_agent_v2':false,mcp_servers:{},'skills.config':[]}};
let id='',client:any;
try{
 for(const authorized of [false,true,false]){
  client=await new CodexClient(tmp).init();
  const result=await client.call(id?'thread/resume':'thread/start',{...base,...(id?{threadId:id}:{}),config:{...base.config,'features.multi_agent':authorized,'features.multi_agent_v2':authorized,'agents.enabled':authorized}});id=result.thread.id;
  const completed=new Promise<void>((resolve,reject)=>{client.onEvent=(method:string,p:any)=>{if(method==='turn/completed'){p.turn.status==='completed'?resolve():reject(Error(JSON.stringify(p.turn.error)));}};});
  await client.call('turn/start',{threadId:id,input:[{type:'text',text:authorized?'Use a subagent to inspect the fixture.':'Read the fixture yourself.'}]});
  let timer:any; try { await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('fixture timeout')),20000);})]); } finally { clearTimeout(timer); } client.close();client=undefined;
 }
 const hasSpawn=(tools:any[]):boolean=>tools.some(t=>t.name==='spawn_agent'||Array.isArray(t.tools)&&hasSpawn(t.tools)); const enabled=requests.map(r=>hasSpawn(r.tools));
 assert.deepEqual(enabled,[false,true,false]);
 console.log(JSON.stringify({ok:true,nativeCli:execFileSync(executable('codex')!,['--version'],{encoding:'utf8'}).trim(),isolatedHome:true,requests:requests.length,sameThreadColdResumed:true,nativeSpawnOffOnOff:enabled,externalModelRequests:0}));
} catch(error) { console.error(error); process.exitCode=1; } finally{client?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fs.rm(tmp,{recursive:true,force:true});}
