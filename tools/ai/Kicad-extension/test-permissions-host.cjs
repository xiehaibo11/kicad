// Launch an isolated VS Code test profile and local Anthropic-compatible server.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('./vscode-test-host.cjs');
(async()=>{
 const installed=process.argv[2];if(!installed)throw Error('usage: node test-permissions-host.cjs <installed-extension>');
 const version=JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8')).version;
 const output=path.join(__dirname,'audit','permissions-'+version);fs.mkdirSync(output,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-permissions-workspace-'));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-permissions-profile-')),requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw||'{}')}catch{}
  if(req.url.includes('count_tokens')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({input_tokens:10}))}
  let name;for(const message of body.messages||[]){const blocks=typeof message.content==='string'?[{text:message.content}]:message.content||[];for(const block of blocks){const match=block.text?.match(/KICAD_PERMISSION_CASE ([a-z-]+)/);if(match)name=match[1]}}
  if(!['ordinary-agent','highest-live','ordinary-restored','pending-live','highest-startup','question-highest'].includes(name)){res.writeHead(400);return res.end('unexpected fixture input')}
  const last=body.messages.at(-1),toolResult=Array.isArray(last.content)&&last.content.some(block=>block.type==='tool_result');
  requests.push({path:req.url,model:body.model,name,toolResult});
  res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  send('message_start',{type:'message_start',message:{id:'msg_permission_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  if(toolResult){
   send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}});send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'FIXTURE_DONE'}});
  }else{
   const command="printf KICAD_PERMISSION_OK > '"+path.join(workspace,name+'.txt')+"'";
   const question=name==='question-highest',toolInput=question?{questions:[{question:'Which fixture option should be used?',header:'Fixture',options:[{label:'A',description:'Option A'},{label:'B',description:'Option B'}],multiSelect:false}]}:{command,description:'Write temporary permission test marker'};
   send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool_'+name,name:question?'AskUserQuestion':'Bash',input:{}}});
   send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(toolInput)}});
  }
  send('content_block_stop',{type:'content_block_stop',index:0});send('message_delta',{type:'message_delta',delta:{stop_reason:toolResult?'end_turn':'tool_use',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{type:'message_stop'});res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const log=fs.openSync(path.join(output,'vscode-host.log'),'w');
 const child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+installed,'--extensionTestsPath='+path.join(__dirname,'test-vscode-permissions.cjs'),workspace],{env:{...process.env,KICAD_PERMISSION_FIXTURE_URL:'http://127.0.0.1:'+server.address().port,KICAD_PERMISSION_HOST_RESULT:path.join(output,'host.json')},stdio:['ignore',log,log]});
 const timer=setTimeout(()=>child.kill(),160000);let status;
 try{status=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)})}finally{clearTimeout(timer);server.close();fs.closeSync(log)}
 const report={status,requests};fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(status!==0)process.exit(1);
})().catch(error=>{console.error(error);process.exit(1)});
