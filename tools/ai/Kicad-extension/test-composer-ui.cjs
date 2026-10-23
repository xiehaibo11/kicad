// Installed production UI checks with mock host responses; no model calls.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
(async()=>{
 const root=process.argv[2], output=path.join(__dirname,'audit');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const fixture=JSON.parse(fs.readFileSync(path.join(output,'prompt-optimizer-inline-live.json'),'utf8'));
 const html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'nonce-test'; connect-src 'self' https:; worker-src 'self' blob:;"><link href="/style.css" rel="stylesheet"><style>@font-face{font-family:codicon;src:url(/codicon.ttf) format('truetype')} .codicon{font-family:codicon!important}:root{color-scheme:dark;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-foreground:#ccc;--vscode-editor-background:#181818;--vscode-sideBar-background:#181818;--vscode-panel-border:#333;--vscode-descriptionForeground:#999;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-placeholderForeground:#777;--vscode-input-border:#444;--vscode-focusBorder:#007fd4;--vscode-dropdown-background:#252525;--vscode-dropdown-border:#555;--vscode-textLink-foreground:#3794ff}html,body{margin:0;background:#181818}</style><script nonce="test">window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'};window.previewMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{
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
setTimeout(()=>receive({type:'response',requestId:m.requestId,response:{type:'predict_draft_response',text:'请解释 U1 和 R1 的检查结果，不要修改文件或布线。',model:m.request.model}}),100);return;
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
if(t==='set_thinking_level' && window.failReasoning){receive({type:'response',requestId:m.requestId,response:{type:'error',error:'推理强度切换测试失败'}});return;}
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
 await page.addInitScript(()=>localStorage.setItem('kicad.draftSuggestions','off'));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);

 await page.evaluate(fixture=>window.toolFixture=fixture,JSON.parse(fs.readFileSync(path.join(output,'composer-tools.json'),'utf8')));
 const input=page.locator('[contenteditable="true"]');
 const sent=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 const mode=page.locator('.mode-dropdown .dropdown-label');
 await mode.waitFor();assert.equal(await mode.innerText(),'Agent');
 const effort=page.getByRole('button',{name:'Select reasoning effort',exact:true});
 assert.match(await effort.innerText(),/Auto/);await effort.click();
 const effortMenu=page.locator('.dropdown-menu-item .file-info-container');
 assert.deepEqual(await effortMenu.allTextContents(),['Auto','None','Low','High','Max']);
 await page.screenshot({path:path.join(output,`reasoning-menu-${version}.png`)});
 await effortMenu.getByText('Max',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Select reasoning effort"]').innerText.includes('Max'));assert.match(await effort.innerText(),/Max/);assert.equal(await sent(),0);

 await page.locator('.full-input-box').screenshot({path:path.join(output,`composer-agent-${version}.png`)});
 await mode.click();
 const menu=page.locator('.dropdown-menu-item .file-info-container');
 assert.deepEqual(await menu.allTextContents(),['Agent','Default','Plan','最高权限']);
 await page.screenshot({path:path.join(output,`composer-permissions-menu-${version}.png`)});
 await menu.getByText('最高权限',{exact:true}).click();assert.equal(await mode.innerText(),'最高权限');
 await page.locator('.full-input-box').screenshot({path:path.join(output,`composer-full-access-${version}.png`)});
 await mode.click();
 await menu.getByText('Plan',{exact:true}).click();assert.equal(await mode.innerText(),'Plan');
 await mode.click();await menu.getByText('Default',{exact:true}).click();assert.equal(await mode.innerText(),'Default');
 await mode.click();await menu.getByText('Agent',{exact:true}).click();assert.equal(await mode.innerText(),'Agent');
 assert.equal(await sent(),0);
 await input.click();await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await input.innerText(),'');
 await input.fill('正在编辑的草稿');await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await input.innerText(),'正在编辑的草稿');assert.equal(await sent(),0);
 await input.fill('只检查 U1 和 R1（10 kΩ），不要修改文件，也不要布线。');
 await input.press('Enter');
 await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await sent(),1);
 await page.waitForFunction(()=>document.querySelector('[contenteditable="true"]')?.getAttribute('data-placeholder')?.includes('请解释 U1'));
 assert.equal(await sent(),1);assert.equal(await input.innerText(),'');
 const launchMode=await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='launch_claude').at(-1).permissionMode);
 assert.equal(launchMode,'acceptEdits');
 assert.ok(await page.evaluate(()=>window.previewMessages.some(m=>(m.type==='launch_claude'&&m.thinkingLevel==='max')||(m.request?.type==='set_thinking_level'&&m.request.thinkingLevel==='max'))),'selected effort must reach host before send');
 await effort.click();await effortMenu.getByText('Low',{exact:true}).click();
 await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='set_thinking_level'&&m.request.thinkingLevel==='low'));
 await page.waitForFunction(()=>document.querySelector('[aria-label="Select reasoning effort"]').innerText.includes('Low'));
 assert.equal(await sent(),1);
 await page.evaluate(()=>window.failReasoning=true);await effort.click();await effortMenu.getByText('High',{exact:true}).click();
 await page.getByRole('alert').getByText('推理强度切换测试失败',{exact:true}).waitFor();assert.match(await effort.innerText(),/Low/);
 assert.equal(await sent(),1);await page.evaluate(()=>window.failReasoning=false);
 await effort.click();await effortMenu.getByText('Max',{exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Select reasoning effort"]').innerText.includes('Max'));
 assert.equal(await page.getByRole('alert').count(),0);

 await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'request',requestId:'pending-bash',channelId:window.chatChannel,request:{type:'tool_permission_request',toolName:'Bash',inputs:{command:'printf fixture'},suggestions:[]}}}})));
 await page.locator('[data-permission-panel]').waitFor();
 await mode.click();await menu.getByText('最高权限',{exact:true}).click();
 await page.waitForFunction(()=>window.previewMessages.some(m=>m.type==='response'&&m.requestId==='pending-bash'),null,{timeout:5000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>({messages:window.previewMessages.slice(-10),body:document.body.innerText}))),errors);throw error});
 const approval=await page.evaluate(()=>window.previewMessages.find(m=>m.type==='response'&&m.requestId==='pending-bash').response.result);
 assert.equal(approval.behavior,'allow');assert.deepEqual(approval.updatedPermissions,[]);
 assert.equal(await page.locator('[data-permission-panel]').count(),0);assert.equal(await sent(),1);
 assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type==='set_permission_mode').at(-1).request.mode),'bypassPermissions');
 await mode.click();await menu.getByText('Agent',{exact:true}).click();
 assert.match(await input.getAttribute('data-placeholder'),/U1.*R1/);
 const composer=page.locator('.full-input-box');
 assert.equal(await composer.locator('.kicad-composer-tools,.kicad-prediction-status').count(),0);
 assert.equal(await composer.getByRole('button',{name:'工具参考',exact:true}).count(),0);
 assert.equal(await composer.getByRole('checkbox',{name:'下一句建议',exact:true}).count(),0);
 assert.equal(await composer.getByRole('button',{name:'接受建议',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.predictions.at(-1).request.model),'deepseek-flash');
 const history=await page.evaluate(()=>window.predictions.at(-1).request.history);
 assert.equal(history[0].role,'user');assert.match(history[0].text,/10 kΩ/);assert.equal(history.at(-1).role,'assistant');
 await composer.screenshot({path:path.join(output,`composer-suggestion-${version}.png`)});
 await input.press('ArrowRight');assert.equal(await input.innerText(),'');assert.equal(await sent(),1);
 await input.press('Enter');assert.equal(await input.innerText(),'');assert.equal(await sent(),1);
 await input.press('Tab');assert.equal(await input.innerText(),'请解释 U1 和 R1 的检查结果，不要修改文件或布线。');assert.equal(await sent(),1);
 await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await sent(),1);
 await composer.screenshot({path:path.join(output,`composer-accepted-${version}.png`)});
 await input.fill('我需要先自己编辑这个草稿');assert.doesNotMatch(await input.getAttribute('data-placeholder'),/请解释 U1/);
 await page.evaluate(()=>window.predictionPending=true);await input.fill('继续解释检查结果，仍不要修改。');await input.press('Enter');
 await page.waitForFunction(()=>window.predictions.length===2);
 const pending=await page.evaluate(()=>window.predictions.at(-1));await input.fill('已经开始编辑的新草稿');
 await page.evaluate(m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response:{type:'predict_draft_response',text:'过期建议',model:m.request.model}}}})),pending);
 await page.waitForTimeout(80);assert.equal(await input.innerText(),'已经开始编辑的新草稿');assert.doesNotMatch(await input.getAttribute('data-placeholder'),/过期建议/);
 await page.evaluate(()=>window.predictionPending=false);
 await input.press('Enter');await page.waitForFunction(()=>document.querySelector('[contenteditable="true"]')?.getAttribute('data-placeholder')?.includes('请解释 U1'));
 await input.press('Escape');assert.equal(await input.innerText(),'');assert.doesNotMatch(await input.getAttribute('data-placeholder'),/请解释 U1/);assert.equal(await sent(),3);
 assert.deepEqual(errors,[]);
 await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);assert.equal(await sent(),3);
 const result={version,initialMode:'Agent',menuOrder:['Agent','Default','Plan','最高权限'],launchPermissionMode:launchMode,checks:['reasoning options follow DeepSeek capabilities','effort selection never sends','selected max effort reaches host before send','live change sends low to host','failed change keeps previous effort and shows inline error','new chat defaults to Agent','highest permission selectable without sending','Plan and Default remain selectable','selected Agent mode forwarded to chat backend','live full access resolves pending Bash without Yes or persistent rules','switch back to Agent','Tab without suggestion keeps focus for empty and nonempty drafts','second Tab after acceptance keeps focus','completed turn triggers prediction','current selected model and actual conversation forwarded','only ghost text, no tool reference button/checkbox/status/accept buttons','Tab accepts without sending','Enter and Right do not accept ghost text','Escape dismisses','editing invalidates late result'],explicitMessages:await sent(),automaticMessages:0,pageErrors:errors};
 fs.writeFileSync(path.join(output,'composer-ui.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 await browser.close();server.close();
})().catch(error=>{console.error(error);process.exit(1)});
