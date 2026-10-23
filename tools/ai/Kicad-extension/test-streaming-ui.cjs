// Production webview while a turn runs: Claude Code 2.1.30x sends a stream_event and a
// system/thinking_tokens message per token, and tool calls keep appending records. The
// reader must be able to scroll up, select text and pick the next model meanwhile.
// Mock host; no model calls.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
(async()=>{
 const root=process.argv[2], output=path.join(__dirname,'audit');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'nonce-test'; connect-src 'self' https:; worker-src 'self' blob:;"><link href="/style.css" rel="stylesheet"><style>@font-face{font-family:codicon;src:url(/codicon.ttf) format('truetype')} .codicon{font-family:codicon!important}:root{color-scheme:dark;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-foreground:#ccc;--vscode-editor-background:#181818;--vscode-sideBar-background:#181818;--vscode-panel-border:#333;--vscode-descriptionForeground:#999;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-placeholderForeground:#777;--vscode-input-border:#444;--vscode-focusBorder:#007fd4;--vscode-dropdown-background:#252525;--vscode-dropdown-border:#555;--vscode-textLink-foreground:#3794ff}html,body{margin:0;background:#181818}</style><script nonce="test">window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'};window.previewMessages=[];window.turns=0;
const session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const receive=message=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message}}));
const io=(channelId,message)=>receive({type:'io_message',channelId,message});
const toolRound=(channelId,k)=>{
 io(channelId,{type:'assistant',session_id:session,uuid:'tool-a-'+k,message:{id:'msg-t'+k,role:'assistant',content:[{type:'tool_use',id:'toolu_'+k,name:'Bash',input:{command:'kicad-cli pcb drc board.kicad_pcb # step '+k,description:'Run DRC step '+k}}]}});
 io(channelId,{type:'user',session_id:session,uuid:'tool-r-'+k,message:{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_'+k,content:'{"violations":'+k+',"report":"'+'x'.repeat(400)+'"}'}]}});
};
// Token flood plus a tool call every 250 ms, as a working agent produces.
window.work=(channelId,ms)=>new Promise(resolve=>{
 let n=0,k=1000,last=0;const end=Date.now()+ms;
 io(channelId,{type:'system',subtype:'init',session_id:session,cwd:'/fixture',model:'claude-opus-5-5',tools:[],mcp_servers:[]});
 const timer=setInterval(()=>{
  for(let i=0;i<4;i++){n++;
   io(channelId,{type:'stream_event',session_id:session,event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'t'+n}}});
   io(channelId,{type:'system',subtype:'thinking_tokens',estimated_tokens:n*3,estimated_tokens_delta:3,session_id:session,uuid:'tt-'+n});
  }
  if(Date.now()-last>250){last=Date.now();toolRound(channelId,++k);
   // Claude Code adds a synthetic user turn after reading a large image.
   if(k===1001)io(channelId,{type:'user',session_id:session,uuid:'synthetic-'+k,isSynthetic:true,message:{role:'user',content:[{type:'text',text:'[Image: original 2362x1672, displayed at 2000x1416. Multiply coordinates by 1.18 to map to original image.]'}]}});}
  if(Date.now()>end){clearInterval(timer);window.floodEvents=n*2;resolve();}
 },8);
});
const answer='SELECTABLE ANSWER: the U1 regulator output is 3.3 V and R1 sets the LED current to about 2 mA. Nothing was modified.\\n\\n'+Array.from({length:12},(_,i)=>'## Check '+(i+1)+'\\n\\n- Net **VCC_3V3** clearance '+i+' mm\\n- \\x60R'+i+'\\x60 footprint 0402').join('\\n\\n');
window.acquireVsCodeApi=()=>({postMessage:m=>{
window.previewMessages.push(m);
if(m.type==='launch_claude'){window.chatChannel=m.channelId;return;}
if(m.type==='io_message'){
 const turn=++window.turns,channelId=m.channelId;
 const finish=text=>{io(channelId,{type:'assistant',session_id:session,uuid:'answer-'+turn,message:{id:'msg-'+turn,role:'assistant',content:[{type:'text',text}]}});io(channelId,{type:'result',subtype:'success',is_error:false,result:'done',session_id:session});};
 if(turn===1){setTimeout(()=>{io(channelId,{type:'system',subtype:'init',session_id:session,cwd:'/fixture',model:'claude-opus-5-5',tools:[],mcp_servers:[]});for(let k=1;k<=60;k++)toolRound(channelId,k);finish(answer);},50);return;}
 if(turn===2){window.working=true;window.work(channelId,window.workMs).then(()=>{window.working=false;finish('SECOND ANSWER finished.');});return;}
 setTimeout(()=>finish('THIRD ANSWER finished.'),50);return;
}
if(m.type!=='request')return;
const t=m.request.type;
let response={type:t+'_response',success:true};
if(t==='init')response.state={defaultCwd:'/fixture',openNewInTab:false,modelSetting:'deepseek-flash',platform:'darwin',thinkingLevel:'default_on'};
if(t==='get_claude_state')response.config={slashCommands:[],models:[],mcpServers:[]};
if(t==='get_extension_config')response.config={};
if(t==='sdk_probe'){response.data={supportedModels:[]};response.errors=[];}
if(t==='list_sessions_request'){response.type='list_sessions_response';response.sessions=[];}
if(t==='get_asset_uris')response.assetUris={};
setTimeout(()=>receive({type:'response',requestId:m.requestId,response}),0);
},getState:()=>undefined,setState:()=>{}});</script></head><body><div id="app"></div><script type="module" nonce="test" src="/main.js"></script></body></html>`;
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2'};res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:540,height:850}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.setItem('kicad.draftSuggestions','off');window.workMs=7000;});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const input=page.locator('[contenteditable="true"]');
  await input.fill('Check U1 and R1');await input.press('Enter');
  const text=page.locator('p',{hasText:'SELECTABLE ANSWER'}).first();await text.waitFor();
  await input.fill('Keep working');await input.press('Enter');
  await page.waitForFunction(()=>window.working);await page.waitForTimeout(300);

  // Main-thread lag while the flood runs.
  const lag=await page.evaluate(()=>new Promise(resolve=>{let worst=0,last=performance.now(),count=0;const tick=()=>{const now=performance.now();worst=Math.max(worst,now-last-50);last=now;if(++count<20)setTimeout(tick,50);else resolve(Math.round(worst));};setTimeout(tick,50);}));
  // The reader scrolls up to the earlier answer; new tool records must not pull it away.
  await page.mouse.move(270,300);
  for(let i=0;i<40&&!(await text.boundingBox().then(b=>b&&b.y>60&&b.y<500));i++){await page.mouse.wheel(0,-600);await page.waitForTimeout(30);}
  const before=await text.boundingBox();
  await page.waitForTimeout(900);
  const after=await text.boundingBox();
  const stayed=!!before&&!!after&&Math.abs(after.y-before.y)<4;
  // Drag-select along the first line and keep it while records keep arriving.
  const box=after||before;
  await page.mouse.move(box.x+100,box.y+10);await page.mouse.down();await page.mouse.move(box.x+300,box.y+10,{steps:8});await page.mouse.up();
  const selected=await page.evaluate(()=>getSelection().toString());
  await page.waitForTimeout(800);
  const kept=await page.evaluate(()=>getSelection().toString());
  // The next model can be chosen during the turn; it is queued, not applied mid-turn.
  const model=page.getByRole('button',{name:'选择模型'});
  const modelDisabled=await model.getAttribute('aria-disabled');
  let stagedDuringTurn=-1,savedDuringTurn=false;
  if(modelDisabled!=='true'){
   await model.click();await page.locator('.dropdown-menu-item',{hasText:'DeepSeek V4 Pro'}).click();
   await page.waitForFunction(()=>document.querySelector('[aria-label="选择模型"]').innerText.includes('DeepSeek V4 Pro'));
   stagedDuringTurn=await page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type==='set_model').length);
   savedDuringTurn=await page.evaluate(()=>window.previewMessages.some(m=>m.request?.type==='update_extension_config'&&m.request.value==='deepseek-v4-pro'));
  }
  const stillRunning=await page.evaluate(()=>window.working);
  await page.getByText('SECOND ANSWER',{exact:false}).waitFor({timeout:20000});
  await input.fill('Next request');await input.press('Enter');
  await page.getByText('THIRD ANSWER',{exact:false}).waitFor({timeout:20000});
  const bubbles=await page.locator('.user-message').count(),syntheticShown=(await page.locator('body').innerText()).includes('Multiply coordinates');
  const stagedBeforeNext=await page.evaluate(()=>{const i=window.previewMessages.findIndex(m=>m.type==='io_message'&&JSON.stringify(m.message).includes('Next request'));return window.previewMessages.slice(0,i).some(m=>m.request?.type==='set_model'&&m.request.model?.value==='deepseek-v4-pro');});
  const result={version,floodEventsPerSecond:Math.round(await page.evaluate(()=>window.floodEvents)/7),maxTimerLagMs:lag,scrolledAnswerStayed:stayed,selected,kept,modelDisabled,stagedDuringTurn,savedDuringTurn,stagedBeforeNext,bubbles,syntheticShown,measuredDuringTurn:stillRunning,errors};
  console.log(JSON.stringify(result));
  fs.writeFileSync(path.join(output,'streaming-ui.json'),JSON.stringify(result,null,1)+'\n');
  assert.ok(stillRunning,'measurements must happen while the turn is still running');
  assert.ok(stayed,'new records must not scroll the conversation while the reader is above the bottom');
  assert.match(selected,/SWER: the U1/,'text must be selectable while a turn is running');
  assert.equal(kept,selected,'selection must survive streaming updates');
  assert.ok(lag<150,'main thread blocked for '+lag+' ms');
  assert.notEqual(modelDisabled,'true','model selector must stay usable during a turn');
  assert.equal(stagedDuringTurn,0,'running turn must not be reconfigured');
  assert.ok(savedDuringTurn,'queued model choice is saved at once');
  assert.ok(stagedBeforeNext,'queued model is staged before the next request');
  assert.equal(syntheticShown,false,'synthetic CLI turns are not shown');assert.equal(bubbles,3,'only the three messages the user sent are user bubbles');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
