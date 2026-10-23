// Production webview: the reasoning menu follows the discovered models' advertised tiers,
// uses English labels, and the chosen tier reaches the host. Mock host; no model calls.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
(async()=>{
 const root=process.argv[2], output=path.join(__dirname,'audit');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const {supportedModels}=JSON.parse(fs.readFileSync(path.join(output,'reasoning-models.json'),'utf8'));
 const LABELS={none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Max',ultra:'Ultra'};
 const expected=m=>['Auto',...(m.thinkingOff?['None']:[]),...m.reasoningEfforts.map(e=>LABELS[e])];
 const html=`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'nonce-test'; connect-src 'self' https:; worker-src 'self' blob:;"><link href="/style.css" rel="stylesheet"><style>@font-face{font-family:codicon;src:url(/codicon.ttf) format('truetype')} .codicon{font-family:codicon!important}:root{color-scheme:dark;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-foreground:#ccc;--vscode-editor-background:#181818;--vscode-sideBar-background:#181818;--vscode-panel-border:#333;--vscode-descriptionForeground:#999;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-placeholderForeground:#777;--vscode-input-border:#444;--vscode-focusBorder:#007fd4;--vscode-dropdown-background:#252525;--vscode-dropdown-border:#555;--vscode-textLink-foreground:#3794ff}html,body{margin:0;background:#181818}</style><script nonce="test">window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'};window.previewMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{
window.previewMessages.push(m);
if(m.type!=='request')return;
const t=m.request.type;
let response={type:t+'_response',success:true};
if(t==='init')response.state={defaultCwd:'/fixture',openNewInTab:false,modelSetting:window.fixtureModel,platform:'darwin',thinkingLevel:'default_on'};
if(t==='get_claude_state')response.config={slashCommands:[],models:[],mcpServers:[]};
if(t==='get_extension_config')response.config={};
if(t==='sdk_probe'){response.data={supportedModels:window.fixtureModels,accountInfo:{}};response.errors=[];}
if(t==='list_sessions_request'){response.type='list_sessions_response';response.sessions=[];}
if(t==='get_asset_uris')response.assetUris={};
setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response}}})),0);
},getState:()=>undefined,setState:()=>{}});</script></head><body><div id="app"></div><script type="module" nonce="test" src="/main.js"></script></body></html>`;
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2'};res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  for(const model of supportedModels){
   const page=await browser.newPage({viewport:{width:540,height:850},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.addInitScript(([id,models])=>{window.fixtureModel=id;window.fixtureModels=models;localStorage.setItem('kicad.draftSuggestions','off');},[model.value,supportedModels]);
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   const effort=page.getByRole('button',{name:'Select reasoning effort',exact:true});
   await effort.waitFor();assert.match(await effort.innerText(),/Auto/);
   // Discovered tiers replace the static fallback once the model probe answers.
   await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='sdk_probe'));
   await effort.click();
   const menu=page.locator('.dropdown-menu-item .file-info-container');
   const want=expected(model);
   await page.waitForFunction(n=>document.querySelectorAll('.dropdown-menu-item .file-info-container').length===n,want.length);
   assert.deepEqual(await menu.allTextContents(),want,model.value);
   assert.equal(await page.locator('.reasoning-heading').innerText(),'Reasoning effort\nLevels supported by the current model');
   const slug=model.value.replace(/[^a-z0-9.]+/gi,'-');
   if(['claude-opus-5-5','codex:gpt-6.1-sol','codex:gpt-6-luna'].includes(model.value))await page.screenshot({path:path.join(output,`reasoning-menu-${slug}-${version}.png`)});
   // The deepest tier the model offers must reach the host when the next turn launches.
   const deepest=want.at(-1),level=Object.keys(LABELS).find(k=>LABELS[k]===deepest);
   await menu.getByText(deepest,{exact:true}).click();
   await page.waitForFunction(label=>document.querySelector('[aria-label="Select reasoning effort"]').innerText.includes(label),deepest);
   const input=page.locator('[contenteditable="true"]');await input.fill('Reply OK');await input.press('Enter');
   await page.waitForFunction(level=>window.previewMessages.some(m=>(m.type==='launch_claude'&&m.thinkingLevel===level)||(m.request?.type==='set_thinking_level'&&m.request.thinkingLevel===level)),level);
   assert.deepEqual(errors,[]);
   results.push({model:model.value,menu:want,launched:level});console.log(model.value,'=>',want.join(' / '),'| launched',level);
   await page.close();
  }
  fs.writeFileSync(path.join(output,'reasoning-ui.json'),JSON.stringify({version,checks:['menu equals advertised tiers','English labels','deepest tier reaches host on send'],results},null,1)+'\n');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
