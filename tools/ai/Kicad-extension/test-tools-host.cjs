// Run all 20 tools through a real VS Code chat with isolated native documents.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{spawn}=require('./vscode-test-host.cjs');
(async()=>{
 const installed=path.resolve(process.argv[2]),binary=path.resolve(process.argv[3]),output=path.resolve(process.argv[4]);fs.mkdirSync(output,{recursive:true});
 const {frontendFixture}=await import(pathToFileURL(path.join(__dirname,'../direct/scripts/frontend-fixture.mjs')));
 const fixture=await frontendFixture(binary),received=new Map(),requests=[];
 const text=content=>typeof content==='string'?content:(content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');return res.end('{"input_tokens":10}')}
  for(const message of body.messages||[])if(Array.isArray(message.content))for(const block of message.content)if(block.type==='tool_result')received.set(block.tool_use_id,{isError:!!block.is_error,text:text(block.content)});
  requests.push({model:body.model,tools:(body.tools||[]).map(t=>t.name),resultCount:received.size});
  res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  send('message_start',{type:'message_start',message:{id:'msg_tools_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:1}}});
  if(received.size){send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'All fixture tools returned.'}});send('content_block_stop',{type:'content_block_stop',index:0});}
  else for(const [index,item] of fixture.cases.entries()){
   send('content_block_start',{type:'content_block_start',index,content_block:{type:'tool_use',id:'native_'+index,name:'mcp__kicad__'+item.name,input:{}}});
   send('content_block_delta',{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(item.args)}});send('content_block_stop',{type:'content_block_stop',index});
  }
  send('message_delta',{type:'message_delta',delta:{stop_reason:received.size?'end_turn':'tool_use',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{type:'message_stop'});res.end();
 });
 let child,log;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=path.join(fixture.root,'profile');fs.mkdirSync(path.join(profile,'User'),{recursive:true});
  fs.writeFileSync(path.join(profile,'User/settings.json'),JSON.stringify({'kicadAgent.kicadCli':binary,'kicadAgent.socket':fixture.env.KICAD_API_SOCKET,'kicadAgent.nodePath':'/nonexistent/native-tools-do-not-use-node'}));
  log=fs.openSync(path.join(output,'host.log'),'w');
  child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+installed,'--extensionTestsPath='+path.join(__dirname,'test-vscode-tools.cjs'),fixture.root],{env:{...fixture.env,KICAD_TOOL_MODEL_URL:'http://127.0.0.1:'+server.address().port,KICAD_TOOL_HOST_RESULT:path.join(output,'host.json')},stdio:['ignore',log,log]});
  const timer=setTimeout(()=>child.kill(),160000);let status;try{status=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)})}finally{clearTimeout(timer)}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status,requests,tools:fixture.cases.map((c,i)=>({...c,result:received.get('native_'+i)}))},null,2));
  assert.equal(status,0);assert.equal(received.size,20,'every registered tool must execute');
  for(const [id,result]of received){assert.equal(result.isError,false,id+': '+result.text);assert.equal(JSON.parse(result.text).ok,true,id+': '+result.text);}
  const readback=await fixture.verify();fs.writeFileSync(path.join(output,'readback.json'),JSON.stringify({ok:true,...readback},null,2));console.log(JSON.stringify({ok:true,toolCount:received.size,...readback}));
 }finally{child?.kill();server.close();if(log!==undefined)fs.closeSync(log);await fixture.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
