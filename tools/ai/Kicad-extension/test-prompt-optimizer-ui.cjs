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
if(m.type!=='request')return;
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
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const logo=page.getByRole('img',{name:'Kicad',exact:true});await logo.waitFor();
 await page.waitForFunction(()=>{const img=document.querySelector('.kicad-wordmark-icon');return img?.complete&&img.naturalWidth>0});
 const input=page.locator('[contenteditable="true"]');
 const magic=page.getByRole('button',{name:'优化提示词',exact:true});
 const snapshot=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 const status=page.locator('.prompt-optimization-status [role="status"]');
 const expected=fixture.optimized;
 await page.waitForTimeout(150);
 assert.equal(await magic.isDisabled(),true);
 const draft=fixture.original;
 await input.fill(draft);await magic.click();
 await page.waitForFunction(()=>document.querySelector('.prompt-optimization-status')?.textContent.includes('已优化'));
 assert.equal(await input.innerText(),expected);assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.evaluate(()=>window.optimizerRequests.at(-1).request.model),'deepseek-flash');
 assert.equal(await snapshot(),0);
 await page.locator('.full-input-box').screenshot({path:path.join(output,`prompt-optimizer-inline-${version}.png`)});
 await page.getByRole('button',{name:'撤销优化'}).click();assert.equal(await input.innerText(),draft);
 await page.evaluate(()=>window.previewMode='pending');await magic.click();
 await page.getByRole('button',{name:'取消优化'}).waitFor();
 const cancelled=await page.evaluate(()=>window.optimizerRequests.at(-1));
 const submit=page.locator('.submit-button');assert.equal(await submit.isDisabled(),true);
 await input.press('Enter');assert.equal(await snapshot(),0);assert.equal(await input.innerText(),draft);
 await page.getByRole('button',{name:'取消优化'}).click();
 assert.equal(await page.evaluate(id=>window.previewMessages.some(m=>m.type==='cancel_request'&&m.targetRequestId===id),cancelled.requestId),true);
 await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response:{type:'optimize_prompt_response',text:'过期结果',model:'deepseek-flash'}}}})),cancelled);
 assert.equal(await input.innerText(),draft);
 await page.evaluate(()=>window.previewMode='error');await magic.click();await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/401/);assert.equal(await input.innerText(),draft);
 await page.evaluate(()=>window.previewMode='success');await magic.click();
 await page.waitForFunction(()=>document.querySelector('.prompt-optimization-status')?.textContent.includes('已优化'));
 assert.equal(await input.innerText(),expected);
 await input.fill('请使用当前模型优化这份新的草稿');
 await page.evaluate(()=>window.previewMode='pending');await magic.click();
 await page.getByRole('button',{name:'取消优化'}).waitFor();
 const pending=await page.evaluate(()=>window.optimizerRequests.at(-1));
 await input.fill('刚编辑的新草稿');
 await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response:{type:'optimize_prompt_response',text:'不应替换的旧结果',model:'deepseek-flash'}}}})),pending);
 await page.waitForFunction(()=>document.querySelector('.prompt-optimization-status')?.textContent.includes('草稿或会话已变化'));
 assert.equal(await input.innerText(),'刚编辑的新草稿');
 assert.equal(await snapshot(),0);assert.equal(errors.length,0);
 const result={version,fixture:'Installed production frontend, mock host responses',checks:['empty input disabled','selected model forwarded','direct input replacement','no preview dialog','undo restores original','no automatic send','Enter disabled during optimization','cancel and late result ignored','error preserves draft and can retry','concurrent edit protected'],chatMessagesSent:await snapshot(),pageErrors:errors};
 fs.writeFileSync(path.join(output,'prompt-optimizer-inline-ui.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await browser.close();server.close();
})();
