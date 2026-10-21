// Installed production UI checks with mock host responses; no model calls.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
(async()=>{
 const root=process.argv[2], output=path.join(__dirname,'audit');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const fixture=JSON.parse(fs.readFileSync(path.join(output,'prompt-optimizer-inline-live.json'),'utf8'));
 const html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'nonce-test'; connect-src 'self' https:; worker-src 'self' blob:;"><link href="/style.css" rel="stylesheet"><style>@font-face{font-family:codicon;src:url(/codicon.ttf) format('truetype')} .codicon{font-family:codicon!important}:root{color-scheme:dark;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-foreground:#ccc;--vscode-editor-background:#181818;--vscode-sideBar-background:#181818;--vscode-panel-border:#333;--vscode-descriptionForeground:#999;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-placeholderForeground:#777;--vscode-input-border:#444;--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff}html,body{margin:0;background:#181818}</style><script nonce="test">window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'};window.previewMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{
window.previewMessages.push(m);
const receive=message=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message}}));
if(m.type==='launch_claude'){window.chatChannel=m.channelId;return;}
if(m.type==='io_message'){
setTimeout(()=>{receive({type:'io_message',channelId:m.channelId,message:{type:'assistant',message:{role:'assistant',content:[{type:'text',text:'已完成 U1 和 R1 的只读检查，没有修改文件或布线。需要你确认是否进一步解释结果。'}]}}});receive({type:'io_message',channelId:m.channelId,message:{type:'result',subtype:'success',is_error:false,result:'已完成只读检查。'}});},180);return;
}
if(m.type!=='request')return;
if(m.request.type==='predict_draft'){
window.predictions=(window.predictions||[]).concat(m);
if(window.predictionPending)return;
setTimeout(()=>{window.predictionErrorDelivered=true;receive({type:'response',requestId:m.requestId,response:{type:'error',error:'429 REVIEW_PREDICTION_FAILURE'}})},100);return;
}
if(m.request.type==='tool_references'){
setTimeout(()=>receive({type:'response',requestId:m.requestId,response:{type:'tool_references_response',tools:window.toolFixture.tools}}),50);return;
}
const t=m.request.type;
if(t==='optimize_prompt'){
window.optimizerRequests=(window.optimizerRequests||[]).concat(m);
if(window.previewMode==='pending')return;
const response=window.previewMode==='error'?{type:'error',error:'401 测试错误，可重试'}:{type:'optimize_prompt_response',text:window.optimizerReply,model:m.request.model};
setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response}}})),60);return;
}
let response={type:t+'_response',success:true};
if(t==='init')response.state={defaultCwd:'/Users/mosc/Downloads/Kicad',openNewInTab:false,modelSetting:'deepseek-flash',platform:'darwin',thinkingLevel:'default_on'};
if(t==='get_claude_state')response.config={slashCommands:[],models:[],mcpServers:[]};
if(t==='get_extension_config')response.config={};
if(t==='sdk_probe'){response.data={};response.errors=[];}
if(t==='list_sessions_request'){response.type='list_sessions_response';response.sessions=[];}
if(t==='get_asset_uris')response.assetUris={};
setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response}}})),0);
},getState:()=>undefined,setState:()=>{}});</script></head><body><div id="app"></div><script type="module" nonce="test" src="/main.js"></script></body></html>`;
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}if(req.url==='/favicon.ico'){res.writeHead(204);return res.end()};const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2'};res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:540,height:850},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(reply=>window.optimizerReply=reply,fixture.optimized);
 await page.addInitScript(()=>localStorage.removeItem('kicad_draft_suggestions'));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);

 await page.evaluate(fixture=>window.toolFixture=fixture,JSON.parse(fs.readFileSync(path.join(output,'composer-tools.json'),'utf8')));
 const input=page.locator('[contenteditable="true"]');
 const sent=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 await input.fill('只检查，不修改。');await input.press('Enter');
 await page.waitForFunction(()=>window.predictionErrorDelivered===true);
 await page.waitForTimeout(250);
 const visibleError=(await page.locator('body').innerText()).includes('REVIEW_PREDICTION_FAILURE');
 const result={fixture:'installed production UI, controlled prediction error',errorResponseDelivered:true,errorVisible:visibleError,chatMessagesSent:await sent(),pageErrors:errors};
 console.log(JSON.stringify(result));fs.writeFileSync(path.join(output,'prediction-error-visible.json'),JSON.stringify(result,null,2));
 assert.equal(visibleError,true);assert.equal(await sent(),1);assert.deepEqual(errors,[]);await browser.close();server.close();
})().catch(error=>{console.error(error);process.exit(1)});