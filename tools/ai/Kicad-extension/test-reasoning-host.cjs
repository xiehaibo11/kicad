const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const output=path.join(__dirname,'audit','reasoning-'+version);fs.mkdirSync(output,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-effort-workspace-')),profile=fs.mkdtempSync(path.join(os.tmpdir(),'Kicad-effort-profile-')),requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;let body={};try{body=JSON.parse(raw)}catch{}
  if(req.url.includes('count_tokens'))return res.end(JSON.stringify({input_tokens:10}));
  if(!body.messages){res.writeHead(400);return res.end()}
  const texts=body.messages.flatMap(m=>typeof m.content==='string'?[m.content]:m.content.map(p=>p.text||'')).join('\n');
  const matches=[...texts.matchAll(/KICAD_REASONING_CASE ([a-z]+)/g)],name=matches.at(-1)?.[1];
  requests.push({model:body.model,name,effort:body.output_config?.effort,thinking:body.thinking});
  res.writeHead(200,{'Content-Type':'text/event-stream'});const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
  send('message_start',{message:{id:'msg_effort_'+requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}});
  send('content_block_start',{index:0,content_block:{type:'text',text:''}});send('content_block_delta',{index:0,delta:{type:'text_delta',text:'FIXTURE_OK'}});send('content_block_stop',{index:0});send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}});send('message_stop',{});res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const log=fs.openSync(path.join(output,'host.log'),'w');
 const child=spawn('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',['--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(__dirname,'test-vscode-reasoning.cjs'),workspace],{env:{...process.env,KICAD_REASONING_URL:'http://127.0.0.1:'+server.address().port,KICAD_REASONING_RESULT:path.join(output,'host.json')},stdio:['ignore',log,log]});
 const timer=setTimeout(()=>child.kill(),160000);let status;try{status=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)})}finally{clearTimeout(timer);server.close();fs.closeSync(log)}
 fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify({status,requests},null,2)+'\n');
 assert.equal(status,0,'VS Code host test failed; see '+output);
 for(const level of ['low','max','high'])assert.equal(requests.find(r=>r.name===level)?.effort,level);
 assert.equal(requests.find(r=>r.name==='off')?.thinking?.type,'disabled');
 console.log(JSON.stringify({ok:true,status,requests}));
})().catch(error=>{console.error(error);process.exit(1)});
