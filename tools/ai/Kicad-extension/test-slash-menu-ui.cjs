// Production Vue bundle, mocked host protocol. No paid provider requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,out=path.join(__dirname,'audit','slash-menu-'+version);fs.mkdirSync(out,{recursive:true});
 const html=`<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/style.css"><style>:root{color-scheme:dark;--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-foreground:#ccc;--vscode-editor-foreground:#ccc;--vscode-editor-background:#181818;--vscode-sideBar-background:#181818;--vscode-panel-border:#444;--vscode-descriptionForeground:#999;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-input-placeholderForeground:#888;--vscode-input-border:#444;--vscode-focusBorder:#007fd4;--vscode-dropdown-background:#252525;--vscode-dropdown-border:#555;--vscode-textLink-foreground:#3794ff}body{margin:0;background:#181818}</style><script>
window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'};window.requests=[];
window.acquireVsCodeApi=()=>({getState:()=>undefined,setState(){},postMessage(m){
 window.requests.push(m);if(m.type!=='request')return;
 const t=m.request.type;let response={type:t+'_response',success:true};
 if(t==='init')response.state={defaultCwd:'/fixture',openNewInTab:false,modelSetting:new URL(location.href).searchParams.get('model'),platform:'darwin',thinkingLevel:'default_on'};
 if(t==='get_extension_config')response.config={};
 if(t==='get_claude_state')response.config={slashCommands:[],models:[]};
 if(t==='sdk_probe')response.data={supportedModels:[]};
 if(t==='get_asset_uris')response.assetUris={};
 if(t==='list_sessions_request'){response.type='list_sessions_response';response.sessions=[];}
 if(t==='slash_catalog'){
   const skill=m.request.kind==='skill',name=skill?'board-review':'kicad_reference';
   response={type:'slash_catalog_response',results:[{id:(skill?'skill:':'tool:')+name,name,description:skill?'Review a board using this skill':'Find engineering references'}],total:11,nextOffset:m.request.offset?null:10};
 }
 setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:m.requestId,response}}})),t==='get_claude_state'?1500:0);
}});</script></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>`;
 const server=http.createServer((req,res)=>{if(req.url.startsWith('/?')){res.setHeader('content-type','text/html');res.end(html);return;}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 const results=[];
 try{
  for(const model of ['claude-opus-4-6','deepseek-flash','codex:gpt-6.1-sol','custom-compatible-model']){
   const page=await browser.newPage({viewport:{width:600,height:900},deviceScaleFactor:1});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(String(error)));
   await page.addInitScript(()=>localStorage.setItem('kicad.draftSuggestions','off'));
   await page.goto('http://127.0.0.1:'+server.address().port+'/?model='+encodeURIComponent(model));
   const input=page.locator('[contenteditable="true"]');await input.waitFor();
   const select=async(label)=>{await page.locator('.dropdown-menu-item').filter({hasText:label}).first().click();};
   await input.fill('/');await input.press('End');await page.locator('.dropdown-menu-item').getByText('/tools',{exact:true}).waitFor();
   assert.equal(await page.getByText('No matches',{exact:true}).count(),0);
   assert.equal(await page.evaluate(()=>window.requests.filter(m=>m.request?.type==='slash_catalog').length),0,'bare slash is local');
   await page.screenshot({path:path.join(out,model.replace(/:/g,'-')+'-menu.png')});
   // The late empty Claude discovery response cannot erase local entries.
   await page.waitForTimeout(1600);await page.locator('.dropdown-menu-item').getByText('/skills',{exact:true}).waitFor();
   await select('/tools');await page.getByText('kicad_reference',{exact:true}).waitFor();
   await select('下一页');await page.waitForFunction(()=>window.requests.some(m=>m.request?.type==='slash_catalog'&&m.request.offset===10));
   await page.getByText('kicad_reference',{exact:true}).waitFor();await select('kicad_reference');
   assert.match(await input.innerText(),/Use the tool.*kicad_reference/);
   await page.mouse.move(5,5);await input.fill('/skills');await input.press('End');await page.locator('.dropdown-menu-item').getByText('/skills',{exact:true}).waitFor();await input.press('Enter');
   await page.getByText('board-review',{exact:true}).waitFor({timeout:5000}).catch(async error=>{console.error(await page.evaluate(()=>({draft:document.querySelector('[contenteditable]')?.innerText,requests:window.requests.slice(-8),body:document.body.innerText})));throw error;});await input.press('Enter');await page.waitForFunction(()=>/Use the skill.*board-review/.test(document.querySelector('[contenteditable]')?.innerText||''),null,{timeout:5000}).catch(async error=>{console.error(await page.evaluate(()=>({draft:document.querySelector('[contenteditable]')?.innerText,body:document.body.innerText,active:document.activeElement?.outerHTML?.slice(0,200),requests:window.requests.slice(-6)})));throw error;});assert.match(await input.innerText(),/Use the skill.*board-review/);
   await input.fill('/model');await input.press('End');await page.locator('.dropdown-menu-item').getByText('/model',{exact:true}).waitFor();await input.press('Enter');
   await page.getByPlaceholder('搜索模型…').waitFor();await page.getByPlaceholder('搜索模型…').press('Escape');await input.click();
   await input.fill('/effort');await input.press('End');await page.locator('.dropdown-menu-item').getByText('/effort',{exact:true}).waitFor();await input.press('Enter');
   await page.getByText('Levels supported by the current model',{exact:true}).waitFor();await page.locator('.dropdown-trigger-container-inner:visible').last().press('Escape');
   await input.fill('/status');await input.press('End');await page.locator('.dropdown-menu-item').getByText('/status',{exact:true}).waitFor();await input.press('Enter');
   await page.waitForFunction(()=>window.requests.some(m=>m.request?.type==='open_content'&&m.request.fileName==='KiCad session status.json'));
   await input.fill('/doctor prompt-audit');await input.press('End');await input.press('Enter');
   await page.waitForFunction(()=>window.requests.some(m=>m.request?.type==='local_slash'&&m.request.action==='doctor'));
   const sent=await page.evaluate(()=>window.requests.filter(m=>['launch_claude','io_message','interrupt_claude'].includes(m.type)));
   assert.deepEqual(sent,[],'menu browsing and local commands must not call a model or stop a turn');
   assert.deepEqual(errors,[]);
   await input.fill('/my-project-command');await input.press('End');await input.press('Enter');
   await page.waitForFunction(()=>window.requests.some(m=>m.type==='launch_claude'));
   results.push({model,localMenu:true,lateEmptyProbe:true,toolPagination:true,skillDraft:true,modelSelector:true,effortSelector:true,statusEditor:true,doctorArgs:true,unrecognizedSlashForwarded:true,browseModelRequests:0});await page.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({coverage:'Production UI with simulated host responses; no live model inference',results},null,2));console.log(JSON.stringify(results,null,2));
 }catch(error){for(const p of browser.contexts().flatMap(c=>c.pages()))console.error(await p.evaluate(()=>({body:document.body.innerText,requests:JSON.stringify(window.requests.slice(-8))})));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
