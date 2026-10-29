// Built webview + real temporary memory storage. VS Code messaging is bridged over localhost.
// No production user data, model calls, external MCP or screen control.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=process.argv[2],output=path.join(__dirname,'audit','memory');fs.mkdirSync(output,{recursive:true});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ki-memory-ui-')),cwd=path.join(tmp,'KiCad Control'),other=path.join(tmp,'Driver Example');fs.mkdirSync(cwd);fs.mkdirSync(other);
 const previous=process.env.KICAD_HISTORY_DIR;process.env.KICAD_HISTORY_DIR=path.join(tmp,'history');
 const {MemoryStore,memoryInventory}=await import('../composer/memory.ts'),{readSettings,writeMemorySetting}=await import('../composer/settings.ts');
 const memory=new MemoryStore(cwd);await memory.observe({text:'以后请用中文回复，回答简短一点。',sessionId:'fixture',messageId:'human'});
 await memory.operate({operation:'append',text:'Verified R1 = 10k; checked against the schematic.',kind:'semantic'},'user');
 await memory.operate({operation:'append',text:'Export STEP, then inspect component collisions.',kind:'procedural'},'user');
 await new MemoryStore(other).operate({operation:'append',text:'Driver fixture project uses TypeScript.'},'user');
 const status=async()=>({settings:readSettings(cwd).settings.memory,stores:await memoryInventory(cwd),hasWorkspace:true,reloadRequired:false});
 const exported=[];
 async function action(request){
  if(request.type==='kicad_memory_status')return {status:await status()};
  const {action,value={}}=request;
  if(action==='setting'){writeMemorySetting(value.key,value.enabled);return {status:await status()};}
  const target=(await memoryInventory(cwd)).find(s=>s.id===value.store);if(!target)throw Error('Invalid store');
  const store=new MemoryStore(target.cwd||cwd),scope=target.scope;
  if(action==='list')return {records:await store.operate({operation:'list',scope,query:value.query,offset:value.offset,limit:50},'user')};
  if(action==='save')await store.operate({...value,operation:value.id?'replace':'append',scope},'user');
  if(action==='delete')await store.operate({...value,operation:'delete',scope},'user');
  if(action==='clear')await store.clear(scope);
  if(action==='export')exported.push(await store.entries(scope));
  return {status:await status()};
 }
 const source=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=source.slice(source.indexOf(' const html=`')+13,source.indexOf('`;\n const server='));
 html=html.replace("window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'}","window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'settings'}");
 html=html.replace('--vscode-focusBorder:','--vscode-charts-green:#73c991;--vscode-contrastBorder:transparent;--vscode-focusBorder:');
 html=html.replace('const t=m.request.type;',`const t=m.request.type;
if(t==='kicad_memory_status'||t==='kicad_memory_action'){fetch('/__memory',{method:'POST',body:JSON.stringify(m.request)}).then(r=>r.json()).then(result=>{if(result.error){receive({type:'response',requestId:m.requestId,error:result.error});return;}receive({type:'response',requestId:m.requestId,response:{type:t+'_response',...result}});});return;}`);
 html=html.replace('<div id="app"></div>','<div style="position:fixed;top:2px;right:4px;z-index:99999;background:#294252;color:#fff;padding:2px 5px;font:10px monospace;pointer-events:none">UI TEST · real local memory · fixture data · no model</div><div id="app"></div>');
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/__memory'){let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');try{return res.end(JSON.stringify(await action(JSON.parse(body))));}catch(error){return res.end(JSON.stringify({error:String(error)}));}}
  if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}
  const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1180,height:1040},deviceScaleFactor:1.5}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('.cursor-settings-sidebar-cell-label',{hasText:/^Memory$/}).click();
  await page.getByText('Learn from Usage',{exact:true}).waitFor();await page.getByText('Driver Example',{exact:true}).waitFor();
  await page.waitForTimeout(250);await page.screenshot({path:path.join(output,'settings.png'),fullPage:true});
  const automatic=page.getByRole('switch',{name:'Learn from Usage'});assert.equal(await automatic.getAttribute('aria-checked'),'true');assert.equal(await automatic.getAttribute('data-state'),'checked');await automatic.click();
  await page.waitForFunction(()=>window.previewMessages.some(m=>m.request?.type==='kicad_memory_action'&&m.request.value?.key==='autoLearn'));
  await page.waitForTimeout(100);assert.equal(readSettings(cwd).settings.memory.autoLearn,false);assert.equal(await automatic.getAttribute('aria-checked'),'false');
  await automatic.click();await page.waitForTimeout(100);assert.equal(readSettings(cwd).settings.memory.autoLearn,true);
  const project=(await memoryInventory(cwd)).find(s=>s.current),card=page.locator('[data-store="'+project.id+'"]');await card.getByRole('button',{name:'View',exact:true}).click();
  await page.getByText('Verified R1 = 10k; checked against the schematic.',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Search memories'}).fill('R1');await page.getByText('1 matching memories',{exact:true}).waitFor();
  const entry=page.locator('.memory-entry').filter({hasText:'R1'});await entry.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('textbox',{name:'Memory text'}).fill('Verified R1 = 20k; read back after editing.');await page.getByRole('button',{name:'Save Memory',exact:true}).click();
  await page.getByText('Verified R1 = 20k; read back after editing.',{exact:true}).waitFor();assert.match((await memory.entries('project')).find(r=>r.text.includes('R1')).text,/20k/);
  await page.screenshot({path:path.join(output,'entries.png'),fullPage:true});
  await entry.getByRole('button',{name:'Delete',exact:true}).click();await page.getByText('0 matching memories',{exact:true}).waitFor();assert.ok(!(await memory.entries('project')).some(r=>r.text.includes('R1')));
  await page.getByRole('button',{name:'Add Memory',exact:true}).click();await page.getByRole('textbox',{name:'Memory text'}).fill('R1 review uses a concise checklist.');await page.getByRole('button',{name:'Save Memory',exact:true}).click();
  await page.getByText('R1 review uses a concise checklist.',{exact:true}).waitFor();
  await card.getByRole('button',{name:'Export',exact:true}).click();await page.waitForTimeout(100);assert.ok(exported.at(-1).some(r=>r.text.includes('checklist')));
  await card.getByRole('button',{name:'Delete All',exact:true}).click();await page.getByText('0 matching memories',{exact:true}).waitFor();assert.equal((await memory.entries('project')).length,0);
  // Switches remain usable at a narrow extension sidebar width.
  await page.setViewportSize({width:680,height:1000});await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
  const global=page.getByRole('switch',{name:'Global Memory'});await global.click();await page.waitForTimeout(100);assert.equal(await memory.context('中文'),'');
  assert.deepEqual(errors,[]);console.log('Memory production UI passed: switches, projects, search, edit/save, delete, add, export, clear and narrow layout. '+output);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));previous===undefined?delete process.env.KICAD_HISTORY_DIR:process.env.KICAD_HISTORY_DIR=previous;fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
