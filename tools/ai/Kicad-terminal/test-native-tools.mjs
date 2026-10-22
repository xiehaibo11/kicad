// Real native terminal server/model tool execution; no user's configuration/key.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {frontendFixture} from '../direct/scripts/frontend-fixture.mjs';
const binary=path.resolve(process.argv[2]),cli=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);fs.mkdirSync(output,{recursive:true});
const fixture=await frontendFixture(cli),results=new Map(),requests=[];
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
 for(const message of body.messages||[])if(message.role==='tool')results.set(message.tool_call_id,message.content);
 requests.push({tools:(body.tools||[]).map(t=>t.function?.name),results:results.size});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'native-tools',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');
 if(results.size){send({role:'assistant',content:'All fixture tools returned.'});send({},'stop');}
 else {send({role:'assistant',tool_calls:fixture.cases.map((item,index)=>({index,id:'native_'+index,type:'function',function:{name:item.name,arguments:JSON.stringify(item.args)}}))});send({},'tool_calls');}
 res.end('data: [DONE]\n\n');
});
let child,log;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env=Object.fromEntries(Object.entries(fixture.env).filter(([key])=>!key.startsWith('OPENCODE_')&&!/API_KEY|AUTH_TOKEN|ANTHROPIC_|CLAUDECODE|XDG_/.test(key)));
 for(const [key,dir]of Object.entries({HOME:'home',XDG_CONFIG_HOME:'config',XDG_DATA_HOME:'data',XDG_CACHE_HOME:'cache',XDG_STATE_HOME:'state'})){env[key]=path.join(fixture.root,dir);fs.mkdirSync(env[key],{recursive:true});}
 // Seed only verified package metadata/dependencies, never provider config/auth.
 // A cold isolated HOME must not make acceptance depend on an npm download.
 const seed=path.join(os.homedir(),'.config/opencode'),config=path.join(env.XDG_CONFIG_HOME,'opencode');fs.mkdirSync(config,{recursive:true});
 if(fs.existsSync(path.join(seed,'node_modules/@opencode-ai/plugin/package.json'))){
  assert.equal(JSON.parse(fs.readFileSync(path.join(seed,'node_modules/@opencode-ai/plugin/package.json'),'utf8')).version,'1.19.3');
  for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(seed,name),path.join(config,name));
  fs.symlinkSync(path.join(seed,'node_modules'),path.join(config,'node_modules'),'dir');
 }
 env.OPENCODE_DISABLE_MODELS_FETCH='1';env.OPENCODE_DISABLE_AUTOUPDATE='1';env.OPENCODE_DISABLE_PROJECT_CONFIG='1';
 env.OPENCODE_CONFIG_CONTENT=JSON.stringify({model:'regression/fixture',provider:{regression:{npm:'@ai-sdk/openai-compatible',options:{apiKey:'fixture-only',baseURL:'http://127.0.0.1:'+server.address().port+'/v1'},models:{fixture:{name:'Fixture',limit:{context:200000,output:16000}}}}},permission:{'*':'allow'},plugin:[new URL('./dist/session-runtime.mjs',import.meta.url).href],mcp:{renamed:{type:'local',command:['node','/nonexistent/easyeda-mcp.mjs']},oldGo:{type:'local',command:['/nonexistent/kicad-agent','mcp']}}});
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 log=fs.openSync(path.join(output,'server.log'),'w');child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:fixture.root,env,stdio:['ignore',log,log]});
 const request=async(route,body)=>{const response=await fetch('http://127.0.0.1:'+port+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
 for(let i=0;i<200;i++){try{await request('/global/health');break;}catch(error){if(child.exitCode!==null||i===199)throw error;await new Promise(r=>setTimeout(r,100));}}
 assert.deepEqual(await request('/mcp'),{},'renamed legacy connectors must not be started');
 const session=await request('/session',{});
 const turn=await request('/session/'+session.id+'/message',{model:{providerID:'regression',modelID:'fixture'},parts:[{type:'text',text:'Run all provided KiCad tools once on this temporary acceptance project: create the via, export the schematic netlist and persist the workflow/pipeline, then finish.'}]});
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({requests,tools:fixture.cases.map((c,i)=>({...c,result:results.get('native_'+i)})),turn},null,2));
 assert.equal(results.size,20,'every native tool must return to the model');
 for(const [id,raw]of results){const result=JSON.parse(raw);assert.equal(result.ok,true,id+': '+raw);}
 const readback=await fixture.verify();fs.writeFileSync(path.join(output,'readback.json'),JSON.stringify({ok:true,...readback},null,2));console.log(JSON.stringify({ok:true,tools:results.size,...readback}));
}finally{
 child?.kill('SIGTERM');if(child&&child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,3000))]);if(child&&child.exitCode===null)child.kill('SIGKILL');
 server.close();if(log!==undefined)fs.closeSync(log);await fixture.close();
}
