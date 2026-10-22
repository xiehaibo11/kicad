const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('./vscode-test-host.cjs');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','execution-'+version);fs.mkdirSync(output,{recursive:true});
 fs.rmSync(path.join(output,'pause-sdk-verification.json'),{force:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-pause-workspace-')),profile=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-pause-profile-')),requests=[],pending=new Set();let childPending=false;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture-state')return res.end(JSON.stringify({childPending}));
  let raw='';for await(const p of req)raw+=p;let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
  if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));if(!body.messages){res.writeHead(400);return res.end()}
  const texts=body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:m.content?.filter(b=>b.type==='text').map(b=>b.text)||[]),resend=texts.some(s=>s.startsWith('KICAD_RESEND')),main=texts.some(s=>s.startsWith('KICAD_PAUSE_MAIN')),delegate=main&&!resend,tools=body.tools?.map(t=>t.name)||[];
  const continued=body.messages.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='tool_result'&&b.tool_use_id==='tool_continue_write'));
  requests.push({model:body.model,main,resend,delegate,continued});res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('message_start',{message:{id:'msg_pause_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  if(delegate){send('content_block_start',{index:0,content_block:{type:'tool_use',id:'tool_pause_task',name:tools.includes('Agent')?'Agent':'Task',input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({description:'暂停与重发测试',prompt:'KICAD_PAUSE_CHILD: Wait for the fixture response.',subagent_type:'general-purpose'})}});}
  else if(resend&&!continued){assert.ok(tools.includes('Write'),'resumed task must have Write available');send('content_block_start',{index:0,content_block:{type:'tool_use',id:'tool_continue_write',name:'Write',input:{}}});send('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({file_path:path.join(workspace,'continuation-proof.txt'),content:'CONTINUED_WITH_WRITE'})}});}
  else{send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:resend?'RESEND_OK':'CHILD_WAITING'}});}
  if(!main&&!resend){childPending=true;pending.add(res);res.on('close',()=>pending.delete(res));return;}
  send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:delegate||resend&&!continued?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:12}});send('message_stop',{});res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const log=fs.openSync(path.join(output,'pause-host.log'),'w');
 const child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(__dirname,'test-vscode-lifecycle.cjs'),workspace],{env:{...process.env,CLAUDE_CONFIG_DIR:path.join(profile,'claude'),KICAD_LIFECYCLE_URL:'http://127.0.0.1:'+server.address().port,KICAD_LIFECYCLE_OUTPUT:path.join(output,'pause-sdk-verification.json')},stdio:['ignore',log,log]});
 let poll,timer,status;try{status=await new Promise((resolve,reject)=>{
  const complete=()=>{const file=path.join(output,'pause-sdk-verification.json');if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file)).ok)resolve('verified');};
  poll=setInterval(complete,100);timer=setTimeout(()=>reject(Error('SDK test did not write successful verification')),60000);
  child.on('error',reject);child.on('exit',code=>{complete();if(code!==0)reject(Error('test host exited '+code));});
 });}finally{clearInterval(poll);clearTimeout(timer);if(child.exitCode===null)child.kill();for(const res of pending)res.destroy();server.closeAllConnections();server.close();fs.closeSync(log)}
 fs.writeFileSync(path.join(output,'pause-host-requests.json'),JSON.stringify({status,requests,fixture:'Actual VS Code extension and pinned SDK/CLI against localhost Messages API; no external model'},null,2));assert.equal(status,'verified','host failed: '+output);assert.equal(JSON.parse(fs.readFileSync(path.join(output,'pause-sdk-verification.json'))).ok,true);assert.equal(requests.filter(r=>r.resend&&!r.continued).length,1,'one explicit resend begins exactly one continued turn');assert.equal(requests.filter(r=>r.resend&&r.continued).length,1,'the continued turn must execute Write and return its result');console.log('Real SDK pause/resend passed with continued file write and persisted host preference: '+output);
})().catch(e=>{console.error(e);process.exit(1)});
