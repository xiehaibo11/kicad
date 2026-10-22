const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('./vscode-test-host.cjs');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','continuity-'+version);fs.mkdirSync(output,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-intent-workspace-')),profile=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-intent-profile-')),requests=[];
 const report=path.join(output,'sdk.json');fs.rmSync(report,{force:true});
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;let body;try{body=JSON.parse(raw)}catch{res.writeHead(400);return res.end()}
  if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));if(!body.messages){res.writeHead(400);return res.end()}
  const text=m=>typeof m.content==='string'?m.content:(m.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const userTexts=body.messages.filter(m=>m.role==='user').map(text),all=userTexts.join('\n'),last=userTexts.at(-1)||'';
  const name=(all.includes('KICAD_INTENT_COMPACT')||all.includes('KICAD_COMPACT_SUMMARY'))?'compact':all.includes('KICAD_INTENT_ANSWERED')?'answered':all.includes('KICAD_INTENT_QUESTION')?'generic-yes':'ambiguous';
  const toolResults=body.messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(b=>b.type==='tool_result'):[]),questionResult=toolResults.some(b=>b.tool_use_id==='question-'+name),writeResult=toolResults.some(b=>b.tool_use_id==='write-'+name);
  const summarizing=/Your task is to create a detailed summary|Summarize the conversation|[Cc]ontext.*summari/.test(last)&&body.messages.length>2;
  const wasCompacted=all.includes('KICAD_COMPACT_SUMMARY');
  requests.push({name,summarizing,wasCompacted,questionResult,writeResult,last:last.slice(0,350),containsCheckpoint:JSON.stringify(body).includes('Task checkpoint'),preservesRestriction:JSON.stringify(body).includes('不要布线'),model:body.model});
  res.writeHead(200,{'Content-Type':'text/event-stream'});const emit=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  emit('message_start',{message:{id:'msg_intent_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:name==='compact'&&!wasCompacted&&!summarizing?180000:10,output_tokens:1}}});
  let tool,input,response;
  if(summarizing)response='KICAD_COMPACT_SUMMARY: User asked to create compact.txt with INTENT_OK, then finish verification. Do not route. The Write action has already completed; verify the file and report, do not repeat the write.';
  else if(name==='compact'&&wasCompacted)response='任务已完成，保留不要布线的限制。';
  else if(['generic-yes','answered'].includes(name)&&!questionResult){tool='AskUserQuestion';input={questions:[{question:'你想执行什么任务？',header:'需求',options:[{label:'创建测试文件',description:'在临时测试目录创建文件'},{label:'解释操作',description:'仅说明用途'}],multiSelect:false}]};}
  else if(!writeResult&&(name==='ambiguous'||name==='compact'||name==='answered'||name==='generic-yes'&&toolResults.some(b=>b.content&&JSON.stringify(b.content).includes('创建测试文件')))){tool='Write';input={file_path:path.join(workspace,name+'.txt'),content:'INTENT_OK'};}
  else response='请说明具体需要执行什么任务。';
  if(tool){emit('content_block_start',{index:0,content_block:{type:'tool_use',id:(tool==='Write'?'write-':'question-')+name,name:tool,input:{}}});emit('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(input)}});}
  else{emit('content_block_start',{index:0,content_block:{type:'text',text:''}});emit('content_block_delta',{index:0,delta:{type:'text_delta',text:response}});}
  emit('content_block_stop',{index:0});emit('message_delta',{delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}});emit('message_stop',{});res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const log=fs.openSync(path.join(output,'host.log'),'w');
 const child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(__dirname,'test-vscode-intent.cjs'),workspace],{env:{...process.env,CLAUDE_CONFIG_DIR:path.join(profile,'claude'),KICAD_INTENT_URL:'http://127.0.0.1:'+server.address().port,KICAD_INTENT_OUTPUT:report},stdio:['ignore',log,log]});
 let timer,poll;try{await new Promise((resolve,reject)=>{poll=setInterval(()=>{if(fs.existsSync(report)&&JSON.parse(fs.readFileSync(report)).ok)resolve();},100);timer=setTimeout(()=>reject(Error('intent SDK test timed out; '+profile)),60000);child.on('error',reject);child.on('exit',code=>{if(code)reject(Error('test exited '+code));});});}finally{clearTimeout(timer);clearInterval(poll);child.kill();server.closeAllConnections();server.close();fs.closeSync(log);fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify({workspace,profile,requests},null,2));}
 assert.equal(JSON.parse(fs.readFileSync(report)).ok,true);assert.ok(requests.some(r=>r.wasCompacted&&r.containsCheckpoint&&r.preservesRestriction),'post-compaction request must include checkpoint and exact restriction');console.log('Real SDK intent/compaction passed: '+output);
})().catch(e=>{console.error(e);process.exit(1)});
