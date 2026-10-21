const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','dashboard-'+version);fs.mkdirSync(output,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-dashboard-workspace-')),profile=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-dashboard-profile-')),requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
  if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));
  if(!body.messages){res.writeHead(400);return res.end()}
  const last=body.messages.at(-1),hasResult=Array.isArray(last?.content)&&last.content.some(b=>b.type==='tool_result'),tools=body.tools?.map(t=>t.name)||[];
  const isMain=body.messages.some(m=>typeof m.content==='string'?m.content.startsWith('KICAD_DASHBOARD_MAIN'):m.content?.some(b=>b.text?.startsWith('KICAD_DASHBOARD_MAIN')));
  const delegate=isMain&&!hasResult;
  requests.push({model:body.model,tools,delegate,isMain,hasResult});
  res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('message_start',{message:{id:'msg_dashboard_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  if(delegate){
   send('content_block_start',{index:0,content_block:{type:'tool_use',id:'tool_dashboard_task',name:tools.includes('Agent')?'Agent':'Task',input:{}}});
   send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({description:'验证真实子代理事件',prompt:'KICAD_DASHBOARD_CHILD: Reply CHILD_OK without tools.',subagent_type:'general-purpose'})}});
  }else{
   send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:isMain?'MAIN_OK':'CHILD_OK'}});
  }
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:delegate?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:12}});send('message_stop',{});res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const log=fs.openSync(path.join(output,'agent-host.log'),'w');
 const child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(__dirname,'test-vscode-dashboard.cjs'),workspace],{env:{...process.env,KICAD_DASHBOARD_URL:'http://127.0.0.1:'+server.address().port,KICAD_DASHBOARD_EVENTS:path.join(output,'actual-sdk-events.json')},stdio:['ignore',log,log]});
 const timer=setTimeout(()=>child.kill(),90000);let status;try{status=await new Promise((r,j)=>{child.on('exit',r);child.on('error',j)})}finally{clearTimeout(timer);server.close();fs.closeSync(log)}
 fs.writeFileSync(path.join(output,'agent-host-requests.json'),JSON.stringify({status,requests},null,2));assert.equal(status,0,'host failed: '+output);
 const {createRequire}=require('node:module'),dep=createRequire(path.join(process.argv[3]||root,'package.json')),ts=dep('typescript'),vm=require('node:vm'),mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(process.argv[3]||root,'src/shared/agentActivity.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
 const tracker=new mod.exports.AgentActivityIndex();for(const e of JSON.parse(fs.readFileSync(path.join(output,'actual-sdk-events.json'))))tracker.consume(e);
 const tasks=tracker.snapshot();assert.equal(tasks.length,1);assert.equal(tasks[0].status,'completed');assert.match(tasks[0].latest,/CHILD_OK/);
 fs.writeFileSync(path.join(output,'actual-sdk-verification.json'),JSON.stringify({ok:true,version,requests:requests.length,tasks,fixture:'real VS Code extension services and pinned SDK/CLI with localhost Messages API; no external model'},null,2));console.log('Real SDK subagent lifecycle passed: '+output);
})().catch(e=>{console.error(e);process.exit(1)});
