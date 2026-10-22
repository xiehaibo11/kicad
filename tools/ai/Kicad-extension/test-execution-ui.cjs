// Actual production webview bundle with deterministic host events; no external model.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','execution-'+version);fs.mkdirSync(output,{recursive:true});
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 html=html.replace("if(m.type==='io_message'){","if(m.type==='io_message'){if(window.holdExecution)return;");
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:620,height:900},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{localStorage.setItem('kicad.draftSuggestions','off');window.holdExecution=true});
 const emit=async(event,channel)=>page.evaluate(({event,channel})=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'io_message',channelId:channel||window.chatChannel,message:event}}})),{event,channel});
 const assistant=(content,parent)=>({type:'assistant',parent_tool_use_id:parent,message:{role:'assistant',content}}),text=s=>({type:'text',text:s});
 const sent=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');const input=page.locator('[contenteditable="true"]');await input.fill('启动子代理检查 U1，不要修改文件或布线。');await input.press('Enter');
  await emit({type:'system',subtype:'init',session_id:'retained-conversation'});
  await emit(assistant([text('常规准备计划：先读取所有项目文件，再逐个分析。')]));
  await emit(assistant([{type:'thinking',thinking:'内部执行推理详情'},{type:'tool_use',id:'read',name:'Bash',input:{command:'kicad-agent health'}},{type:'tool_use',id:'agent',name:'Task',input:{description:'检查 U1',prompt:'只读检查 U1',subagent_type:'Explore'}}]));
  await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'read',content:'RAW_HEALTH_LOG_FULL'}]}});
  await emit(assistant([text('CHILD_VERBOSE_LOG')],'agent'));
  const toggle=page.locator('.execution-toggle').first();await toggle.waitFor();assert.match(await toggle.innerText(),/运行中.*2 次工具调用/s);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.execution-details').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/常规准备计划|RAW_HEALTH_LOG_FULL|CHILD_VERBOSE_LOG/);
  await page.screenshot({path:path.join(output,'running-collapsed.png')});
  await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.getByRole('region',{name:'执行详情'}).getByText('CHILD_VERBOSE_LOG',{exact:true}).waitFor();assert.match(await page.locator('.execution-details').innerText(),/常规准备计划/);assert.match(await page.locator('.execution-details').innerText(),/RAW_HEALTH_LOG_FULL/);
  await page.screenshot({path:path.join(output,'running-expanded.png')});await toggle.focus();await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await emit({type:'result',parent_tool_use_id:'agent',is_error:false,result:'child finished'});assert.match(await toggle.innerText(),/运行中/);
  await emit(assistant([text('【重要问题】DRC 发现未连接引脚，需要确认。')]));await page.getByText('【重要问题】DRC 发现未连接引脚，需要确认。',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await emit(assistant([{type:'tool_use',id:'error',name:'Bash',input:{command:'kicad-agent drc'}}]));
  await emit({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'error',is_error:true,content:'DRC 检查失败\nERROR_FULL_DETAIL_ONLY_WHEN_EXPANDED'}]}});
  await page.locator('.execution-failure').getByText('Bash：DRC 检查失败',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/ERROR_FULL_DETAIL_ONLY_WHEN_EXPANDED/);
  await page.locator('.execution-failure').click();assert.match(await page.locator('.execution-details').innerText(),/ERROR_FULL_DETAIL_ONLY_WHEN_EXPANDED/);await toggle.click();
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'request',requestId:'pending-test',channelId:window.chatChannel,request:{type:'tool_permission_request',toolName:'Bash',inputs:{command:'fixture'},suggestions:[]}}}})));
  await page.getByText('Do you want to proceed with Bash?',{exact:true}).waitFor();assert.match(await toggle.innerText(),/等待确认/);await page.locator('.button-container .button.primary').click();
  await emit(assistant([text('正在整理检查结果。')]));await emit(assistant([text('检查完成：U1 存在一处连接问题；没有修改文件或布线。')]));await emit({type:'result',is_error:false,subtype:'success',result:'检查完成：U1 存在一处连接问题；没有修改文件或布线。'});
  await page.locator('.execution-answer').getByText('检查完成：U1 存在一处连接问题；没有修改文件或布线。',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/正在整理检查结果/);assert.match(await toggle.innerText(),/已完成/);assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await sent(),1);
  await page.screenshot({path:path.join(output,'completed-collapsed.png')});
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
  await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.execution-toggle').length===0);assert.equal(await page.locator('.conversation-agent-activity').count(),0);
  await input.fill('你好');await input.press('Enter');await emit(assistant([text('你好！')]));await page.getByText('你好！',{exact:true}).waitFor();assert.equal(await page.locator('.execution-toggle').count(),0);await emit({type:'result',subtype:'success',is_error:false,result:'你好！'});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'production-ui-verification.json'),JSON.stringify({ok:true,version,checks:['default collapsed per request','click and keyboard expand/collapse','full tool outputs and child logs retained','child result never settles main turn','important findings visible','error summary visible, raw error in details','permission prompt available','final only, no intermediate progress promotion','320px no horizontal overflow','pause and immediate resend restores session','late retired result and close cannot stop resend','one send per explicit message','new chat resets execution and agents','ordinary chat streams normally'],pageErrors:errors},null,2));console.log('Production execution and pause/resend UI passed: '+output);
 }catch(error){await page.screenshot({path:path.join(output,'ui-failure.png')});console.error((await page.locator('body').innerText()).slice(-3500));throw error;}finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
