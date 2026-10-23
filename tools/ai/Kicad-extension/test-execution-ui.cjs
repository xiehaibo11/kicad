// Actual production webview bundle with deterministic host events; no external model.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','execution-'+version);fs.mkdirSync(output,{recursive:true});
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 html=html.replace("if(m.type==='io_message'){","if(m.type==='io_message'){if(window.holdExecution)return;");
 // Evidence images must identify their synthetic host data within the image.
 html=html.replace('<body>', '<body><div id="fixture-provenance" style="position:fixed;top:0;right:4px;z-index:99999;padding:3px 7px;background:#653c00;color:#fff;font:10px system-ui;pointer-events:none">UI TEST · simulated events · no model</div>');
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:620,height:900},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{localStorage.setItem('kicad.draftSuggestions','off');window.holdExecution=true});
 const emit=async(event,channel)=>page.evaluate(({event,channel})=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'io_message',channelId:channel||window.chatChannel,message:event}}})),{event,channel});
 const assistant=(content,parent)=>({type:'assistant',parent_tool_use_id:parent,message:{role:'assistant',content}}),text=s=>({type:'text',text:s});
 const sent=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');const input=page.locator('[contenteditable="true"]');
  await page.locator('#fixture-provenance').waitFor();
  await input.fill('请把项目进行深度了解');await input.press('Enter');
  await emit(assistant([{type:'tool_use',id:'ordinary-read',name:'Read',input:{file_path:'/fixture/README.md'}}]));
  await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'ordinary-read',content:'Fixture project architecture overview'}]}});
  await emit(assistant([text('正在根据项目文档梳理入口和模块关系。')]));
  assert.doesNotMatch(await page.locator('.execution-steps').first().innerText(),/Agent|Task|子代理/);
  assert.equal(await page.locator('.conversation-agent-activity').count(),0);
  await page.screenshot({path:path.join(output,'running-progressive.png')});
  await emit({type:'result',is_error:false,subtype:'success',result:'Fixture project inspection complete.'});
  await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.exec-step-tool').length===0);
  await page.evaluate(()=>window.previewMessages=[]);
  await input.fill('启动子代理检查 U1，不要修改文件或布线。');await input.press('Enter');
  await page.locator('.execution-waiting .exec-step-live').waitFor();assert.equal(await page.locator('.spinnerRow').count(),0,'one stream status, no duplicate branded spinner');
  await emit({type:'system',subtype:'init',session_id:'retained-conversation'});
  await emit(assistant([text('常规准备计划：先读取所有项目文件，再逐个分析。')]));
  await emit(assistant([{type:'thinking',thinking:'内部执行推理详情'},{type:'tool_use',id:'read',name:'Bash',input:{command:'kicad-agent health'}},{type:'tool_use',id:'agent',name:'Task',input:{description:'检查 U1',prompt:'只读检查 U1',subagent_type:'Explore'}}]));
  await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'read',content:'RAW_HEALTH_LOG_FULL'}]}});
  await emit(assistant([text('CHILD_VERBOSE_LOG')],'agent'));
  const steps=page.locator('.execution-steps').first();await steps.waitFor();
  assert.equal(await page.locator('.execution-toggle,.execution-count,.execution-output').count(),0,'no turn wrapper, counters or terminal shortcut');
  assert.match(await steps.innerText(),/常规准备计划/);assert.match(await steps.innerText(),/RAW_HEALTH_LOG_FULL/);assert.match(await steps.innerText(),/CHILD_VERBOSE_LOG/);
  assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type==='open_url').length),0,'tool calls never reveal a window');
  assert.equal(await sent(),1,'rendering execution steps never sends another task');assert.equal(await page.locator('.submit-button').getAttribute('data-variant'),'stop');
  const thought=steps.locator('.exec-thought').first();assert.equal(await thought.getAttribute('aria-expanded'),'false');
  await thought.focus();await page.keyboard.press('Space');assert.equal(await thought.getAttribute('aria-expanded'),'true');assert.match(await steps.innerText(),/内部执行推理详情/);
  await page.keyboard.press('Enter');assert.equal(await thought.getAttribute('aria-expanded'),'false');
  await page.screenshot({path:path.join(output,'running-explicit-delegation.png')});
  await emit({type:'result',parent_tool_use_id:'agent',is_error:false,result:'child finished'});assert.equal(await page.locator('.submit-button').getAttribute('data-variant'),'stop');
  await emit(assistant([text('【重要问题】DRC 发现未连接引脚，需要确认。')]));await page.getByText('【重要问题】DRC 发现未连接引脚，需要确认。',{exact:true}).waitFor();assert.equal(await page.locator('.execution-toggle').count(),0);
  await emit(assistant([{type:'tool_use',id:'error',name:'Bash',input:{command:'kicad-agent drc'}}]));
  await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'error',is_error:true,content:'DRC 检查失败\nERROR_FULL_DETAIL_ONLY_WHEN_EXPANDED'}]}});
  // Failure output stays on its own step, at its original position; no duplicate summary banner.
  const failed=steps.locator('.exec-step-tool.is-error');await failed.waitFor();assert.match(await failed.innerText(),/ERROR_FULL_DETAIL_ONLY_WHEN_EXPANDED/);
  assert.equal(await page.locator('.execution-failure,.execution-failed-count').count(),0);
  const ordered=await steps.locator(':scope > .exec-steps > .exec-step').allInnerTexts();
  assert.ok(ordered.findIndex(s=>s.includes('RAW_HEALTH_LOG_FULL'))<ordered.findIndex(s=>s.includes('【重要问题】')));
  assert.ok(ordered.findIndex(s=>s.includes('【重要问题】'))<ordered.findIndex(s=>s.includes('DRC 检查失败')));
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'request',requestId:'pending-test',channelId:window.chatChannel,request:{type:'tool_permission_request',toolName:'Bash',inputs:{command:'fixture'},suggestions:[]}}}})));
  await page.getByText('Do you want to proceed with Bash?',{exact:true}).waitFor();assert.equal(await page.locator('.exec-step-live').innerText(),'等待确认');await page.locator('.button-container .button.primary').click();
  await emit(assistant([text('正在整理检查结果。')]));await emit(assistant([text('检查完成：U1 存在一处连接问题；没有修改文件或布线。')]));await emit({type:'result',is_error:false,subtype:'success',result:'检查完成：U1 存在一处连接问题；没有修改文件或布线。'});
  await page.locator('.execution-answer').getByText('检查完成：U1 存在一处连接问题；没有修改文件或布线。',{exact:true}).waitFor();assert.match(await steps.innerText(),/正在整理检查结果/);assert.equal(await steps.locator('.exec-step-live').count(),0);assert.equal(await page.locator('.execution-toggle').count(),0);assert.equal(await sent(),1);
  await page.screenshot({path:path.join(output,'completed-progressive.png')});
  await page.setViewportSize({width:320,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'composer-320.png')});await page.setViewportSize({width:620,height:900});
  // Pause, resend immediately, then deliver the retired channel's late result and close.
  await input.fill('再次检查 U1');await input.press('Enter');await page.locator('.submit-button[data-variant="stop"]').waitFor();const oldChannel=await page.evaluate(()=>window.chatChannel);
  await emit(assistant([{type:'tool_use',id:'pending',name:'Bash',input:{command:'fixture waiting'}}]));await page.locator('.submit-button[data-variant="stop"]').click();await page.waitForFunction(()=>document.querySelector('.submit-button')?.dataset.variant!=='stop');
  await input.fill('继续执行刚才的任务');await input.press('Enter');const next=await page.evaluate(()=>window.chatChannel);assert.notEqual(next,oldChannel);
  const launch=await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='launch_claude').at(-1));assert.equal(launch.resume,'retained-conversation');
  await emit({type:'result',is_error:true,session_id:'stale-conversation'},oldChannel);await page.evaluate(old=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'close_channel',channelId:old}}})),oldChannel);
  assert.equal(await page.locator('.submit-button').getAttribute('data-variant'),'stop');
  await emit(assistant([{type:'tool_use',id:'continued-write',name:'Write',input:{file_path:'/fixture/continued-task.txt',content:'continued'}}]));await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'continued-write',content:'fixture write completed'}]}});await emit(assistant([text('已继续执行并完成验证文件写入。')]));await emit({type:'result',session_id:'retained-conversation',is_error:false,subtype:'success',result:'已继续执行并完成验证文件写入。'});await page.getByText('已继续执行并完成验证文件写入。',{exact:true}).waitFor();assert.equal(await sent(),3);assert.notEqual(await page.locator('.submit-button').getAttribute('data-variant'),'stop');
  assert.doesNotMatch(await page.locator('body').innerText(),/Interrupted|Tool interrupted|仍然保持只读|重新发送成功/);await page.screenshot({path:path.join(output,'pause-resend.png')});
  await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.exec-step-tool').length===0);assert.equal(await page.locator('.conversation-agent-activity').count(),0);
  await input.fill('你好');await input.press('Enter');await emit(assistant([text('你好！')]));await page.getByText('你好！',{exact:true}).waitFor();assert.equal(await page.locator('.execution-toggle').count(),0);await emit({type:'result',subtype:'success',is_error:false,result:'你好！'});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'production-ui-verification.json'),JSON.stringify({ok:true,version,provenance:'Production UI bundle with synthetic host events; no model requests; screenshots visibly labeled',checks:['ordinary project inspection displays no child or delegation step','explicit delegation has a separate labeled fixture','no aggregate wrapper, counters or automatic terminal reveal','one live stream status before the first event','progress, tool outputs and findings appear in event order','thought disclosure by mouse and keyboard','full tool outputs and child logs retained','child result never settles main turn','important findings visible','failed call output on its own ERR step','permission prompt available','final answer follows progressive steps','320px no horizontal overflow','pause and immediate resend restores session','late retired result and close cannot stop resend','one send per explicit message','new chat resets execution and agents','ordinary chat streams normally'],pageErrors:errors},null,2));console.log('Production execution and pause/resend UI passed: '+output);
 }catch(error){await page.screenshot({path:path.join(output,'ui-failure.png')});console.error((await page.locator('body').innerText()).slice(-3500));throw error;}finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
