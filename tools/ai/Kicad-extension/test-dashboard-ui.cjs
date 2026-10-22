// Exercise the packaged production Vue app with SDK-shaped event fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
 const output=path.join(__dirname,'audit','dashboard-'+version);fs.mkdirSync(output,{recursive:true});
 // Share the established mock transport contract used by the composer regression.
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');
 let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 assert.ok(html.startsWith('<!doctype html>'));
 html=html.replace("if(t==='sdk_probe'){response.data={};response.errors=[];}","if(t==='sdk_probe'){if(window.probePending)return;response.data={supportedModels:[]};response.errors=[];}");
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:780},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 page.setDefaultTimeout(15000);
 try{
 await page.addInitScript(()=>{window.probePending=true;localStorage.setItem('kicad.draftSuggestions','off');});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const input=page.locator('[contenteditable=true]'),picker=page.getByRole('button',{name:'选择模型',exact:true}),pill=page.getByRole('button',{name:'打开子代理运行看板',exact:true});
 await input.waitFor();assert.equal(await pill.count(),0,'new conversation must not show an empty dashboard entry');
 assert.equal(await page.locator('.conversation-agent-activity').count(),0,'no empty activity row');await page.screenshot({path:path.join(output,'empty.png')});
 await input.fill('启动子代理，安排子代理检查 PCB。');assert.equal(await pill.count(),0,'draft keywords must not create a dashboard');
 await picker.click();await page.locator('.dropdown-trigger-popover').getByText('DeepSeek Flash',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='launch_claude').length),0,'opening model menu must not start a conversation');
 const start=Date.now();await page.locator('.dropdown-trigger-popover').getByText('DeepSeek V4 Pro',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.model-dropdown')?.textContent.includes('DeepSeek V4 Pro'));const latency=Date.now()-start;assert.ok(latency<1500,'selection blocked on SDK discovery: '+latency);
 assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='launch_claude'||m.type==='io_message').length),0,'choosing a model must not send or start a conversation');
 await picker.click();await page.getByPlaceholder('搜索模型…').fill('sonnet');assert.deepEqual(await page.locator('.dropdown-menu-item .file-info-container').allTextContents(),['Sonnet']);await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('.model-dropdown')?.textContent.includes('Sonnet'));
 await picker.click();await page.getByPlaceholder('搜索模型…').fill('deepseek-flash');await page.keyboard.press('Enter');
 await input.fill('只检查 PCB，不要修改。');await input.press('Enter');await page.waitForFunction(()=>window.previewMessages.some(m=>m.type==='io_message'));await page.waitForTimeout(350);
 assert.equal(await pill.count(),0,'ordinary chat must not create a dashboard');
 const push=async events=>page.evaluate(events=>{for(const message of events)window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'io_message',channelId:window.chatChannel,message}}}));},events);
 await push([
 {type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'shell',name:'Bash',input:{description:'等待构建完成',command:'make -j4',run_in_background:true}}]}},
 {type:'system',subtype:'task_started',task_id:'build',tool_use_id:'shell',task_type:'local_bash',description:'等待构建完成'},
 ]);
 assert.equal(await pill.count(),0,'background commands alone must not create a subagent entry');
 await input.fill('安排子代理检查 PCB 设计规则，并核对原理图网络。');await input.press('Enter');await page.waitForTimeout(350);assert.equal(await pill.count(),0,'sending a request must wait for actual task events');
 await push([
 {type:'assistant',message:{role:'assistant',content:[{type:'tool_use',id:'agent-a',name:'Task',input:{description:'检查 PCB 设计规则',prompt:'按照当前 DRC 规则只读检查，不修改 PCB。',subagent_type:'Explore',model:'sonnet'}},{type:'tool_use',id:'agent-b',name:'Agent',input:{description:'查找器件公开资料',prompt:'查阅官方数据手册。',run_in_background:true}},{type:'tool_use',id:'agent-c',name:'Task',input:{description:'核对原理图网络',prompt:'核对 U1 与 R1。'}}]}},
 {type:'system',subtype:'task_started',task_id:'task-a',tool_use_id:'agent-a',description:'检查 PCB 设计规则'},
 {type:'system',subtype:'task_progress',task_id:'task-a',usage:{total_tokens:234800,tool_uses:8,duration_ms:610000},summary:'正在核对最小间距'},
 {type:'system',subtype:'task_started',task_id:'task-b',tool_use_id:'agent-b',description:'查找器件公开资料'},
 {type:'system',subtype:'task_notification',task_id:'task-b',status:'completed',summary:'已找到官方数据手册',usage:{total_tokens:12000,tool_uses:3,duration_ms:45000}},
 ]);
 await pill.waitFor();assert.equal(await page.locator('.full-input-box .agent-dashboard-trigger').count(),0,'entry belongs below chat, outside the composer');
 const entryBounds=await pill.boundingBox(),inputBounds=await page.locator('.full-input-box').boundingBox();assert.ok(entryBounds.y+entryBounds.height<=inputBounds.y,'entry must appear above the input');
 assert.match(await pill.innerText(),/3 个子代理/);assert.match(await pill.innerText(),/1 后台/);
 await pill.click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:/检查 PCB 设计规则/}).click();await dialog.getByRole('region',{name:'任务详情'}).getByText('正在核对最小间距',{exact:true}).waitFor();assert.match(await dialog.innerText(),/234,800/);assert.match(await dialog.innerText(),/只读检查，不修改 PCB/);await page.screenshot({path:path.join(output,'dashboard-desktop.png')});
 await push([{type:'system',subtype:'task_notification',task_id:'task-a',status:'failed',summary:'DRC 检查中断'}]);await dialog.getByRole('region',{name:'任务详情'}).getByText('DRC 检查中断',{exact:true}).waitFor();
 await page.setViewportSize({width:380,height:760});await page.screenshot({path:path.join(output,'dashboard-narrow.png')});
 const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=380);assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 await dialog.getByRole('button',{name:'关闭子代理看板'}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'关闭子代理看板'}).evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await pill.evaluate(el=>document.activeElement===el),true);await input.click();await input.press('Tab');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
 for(const width of [320,380,540]){await page.setViewportSize({width,height:760});const composer=page.locator('.full-input-box');assert.equal(await composer.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'composer overflows at '+width);await composer.screenshot({path:path.join(output,'composer-'+width+'.png')});await page.screenshot({path:path.join(output,'conversation-'+width+'.png')});}
 await push([{type:'system',subtype:'task_notification',task_id:'agent-c',status:'completed',summary:'已完成核对'},{type:'system',subtype:'task_notification',task_id:'build',status:'completed',summary:'构建结束'}]);assert.equal(await pill.count(),1,'completed agents remain available for review');
 await pill.click();await dialog.waitFor();await page.keyboard.press('Escape');await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.agent-dashboard-trigger').length===0);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('.conversation-agent-activity').count(),0);await page.screenshot({path:path.join(output,'new-conversation.png')});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({ok:true,version,selectionLatencyMs:latency,checks:['dashboard hidden on launch, draft, ordinary chat and background-only tasks','dashboard appears only after actual subagent events','entry below chat and outside composer','completed agents available for review','new conversation hides entry again','local model selection while SDK probe blocked','no launch or send on selection','search and keyboard selection','live tasks correlated without duplicate','agent progress and failure update','background tasks separate','details','desktop and 320/380/540px layout','modal focus trap / Escape / focus restoration','composer Tab unchanged'],source:'production Vue bundle with SDK event fixtures; no external model call'},null,2));
 console.log('Dashboard UI passed. Model selection '+latency+'ms while SDK discovery was blocked. Evidence: '+output);
 }catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.error('Dashboard UI failure state:',await page.locator('body').innerText());console.error('Host requests:',await page.evaluate(()=>window.previewMessages.map(m=>({type:m.type,request:m.request?.type}))));throw error;}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
