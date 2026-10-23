// Production settings bundle; fixture host, no model or OS actions.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{const root=process.argv[2],out=path.join(__dirname,'audit/shared-integrations-0.4.66');fs.mkdirSync(out,{recursive:true});
const old=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=old.slice(old.indexOf(' const html=`')+13,old.indexOf('`;\n const server='));
html=html.replace("window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'chat'}","window.CLAUDIX_BOOTSTRAP={host:'sidebar',page:'settings'}").replace('const t=m.request.type;',`const t=m.request.type;
if(t==='kicad_computer_status'||t==='kicad_computer_setting'){
const r=m.request,s=window.computer;if(r.action==='enabled'){s.enabled=r.value;s.running=r.value;s.permissions=r.value?{accessibility:true,screen_recording:true}:null;}
if(r.action==='anyApp')s.anyApp=r.value;if(r.action==='allowedApps')s.allowedApps=r.value;
receive({type:'response',requestId:m.requestId,response:{type:t+'_response',status:JSON.parse(JSON.stringify(s))}});return;}`);
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');return res.end(html);}const f=path.join(root,'dist/media',req.url);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:1100},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(()=>{window.computer={enabled:false,running:false,binary:'/Applications/CuaDriver.app/Contents/MacOS/cua-driver',socket:'/private/test/driver.sock',log:'/private/test/driver.log',platform:'darwin',anyApp:false,allowedApps:['org.kicad.kicad','org.kicad.pcbnew','org.kicad.eeschema']};});
const requests=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type.startsWith('kicad_computer')).map(m=>m.request));
try{await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.cursor-settings-sidebar-cell-label',{hasText:/^Computer Control$/}).click();await page.getByTestId('computer-status').getByText('Off',{exact:true}).waitFor();assert.ok((await requests()).every(r=>r.type==='kicad_computer_status'));
await page.getByTitle('Enable Computer Control',{exact:true}).click();await page.getByTestId('computer-status').getByText('Running in background').waitFor();await page.getByText('Accessibility: Granted · Screen Recording: Granted.',{exact:false}).waitFor();
const cell=label=>page.locator('.cursor-settings-cell').filter({has:page.locator('.cursor-settings-cell-label',{hasText:new RegExp('^'+label+'$')})});
await cell('Google Chrome').locator('[role="switch"]').click();await page.waitForFunction(()=>window.computer.allowedApps.includes('com.google.Chrome'));
await cell('Any App').locator('[role="switch"]').click();await page.waitForFunction(()=>window.computer.anyApp);
await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'View Log',exact:true}).click();
await page.getByText('Reuse Codex and Claude Integrations',{exact:true}).waitFor();
await cell('Locked-Screen Use').getByText('Unavailable.',{exact:false}).waitFor();assert.equal(await cell('Locked-Screen Use').getByRole('switch').count(),0,'no misleading control for an unsupported capability');
await page.screenshot({path:path.join(out,'settings-running.png'),fullPage:true});await page.getByTitle('Enable Computer Control',{exact:true}).click();await page.getByTestId('computer-status').getByText('Off',{exact:true}).waitFor();
await page.evaluate(()=>{window.computer.reloadRequired=true;window.computer.missingSettings=['allowedApps'];});
await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Reload Window',exact:true}).waitFor();
assert.equal(await page.getByTitle('Allow Any App',{exact:true}).isDisabled(),true,'schema mismatch disables changes until the user reloads');
assert.equal((await requests()).filter(r=>r.action==='reload').length,0,'schema mismatch never reloads a window automatically');
await page.screenshot({path:path.join(out,'settings-reload-required.png'),fullPage:true});
await page.getByRole('button',{name:'Reload Window',exact:true}).click();assert.equal((await requests()).filter(r=>r.action==='reload').length,1);
assert.equal((await requests()).filter(r=>r.action==='permissions').length,0);assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(out,'ui.json'),JSON.stringify({ok:true,provenance:'production bundle; simulated host; no live OS actions',checks:['independent off/on','service and TCC status','per-app allowlist','Any App','Restart','View Log in editor request','locked-screen unsupported','no permission request on load','off readback'],requests:await requests(),errors},null,2));console.log('Computer Control UI passed.');
}catch(e){await page.screenshot({path:path.join(out,'ui-failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-3000));throw e;}finally{await browser.close();server.closeAllConnections();server.close();}})().catch(e=>{console.error(e);process.exit(1);});
