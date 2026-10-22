// Production webview: Claude Code style execution timeline and image attachment preview; no model calls.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','execution-steps-'+version);fs.mkdirSync(output,{recursive:true});
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 html=html.replace("if(m.type==='io_message'){","if(m.type==='io_message'){if(window.holdExecution)return;");
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:620,height:1100},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{localStorage.setItem('kicad.draftSuggestions','off');window.holdExecution=true});
 const emit=async event=>page.evaluate(event=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'io_message',channelId:window.chatChannel,message:event}}})),event);
 let clock=Date.now();const at=seconds=>(clock+=seconds*1000);
 const assistant=(content,seconds=1,parent)=>({type:'assistant',timestamp:at(seconds),parent_tool_use_id:parent,message:{role:'assistant',content}}),text=s=>({type:'text',text:s});
 const result=(id,content,isError=false,parent)=>({type:'user',timestamp:at(0),parent_tool_use_id:parent,message:{role:'user',content:[{type:'tool_result',tool_use_id:id,content,is_error:isError}]}});
 const png=fs.readFileSync(path.join(__dirname,'overlay','kicad-logo.png'));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  // 1. The composer chip of an attached image opens a preview; the close button still removes it.
  await page.locator('input[type="file"]').setInputFiles({name:'board-photo.png',mimeType:'image/png',buffer:png});
  const chip=page.locator('.attachment-item.previewable');await chip.waitFor();assert.equal(await chip.locator('img.attachment-thumb').count(),1);
  await chip.click();const dialog=page.getByRole('dialog',{name:'图片预览：board-photo.png'});await dialog.waitFor();
  assert.ok(await dialog.locator('img.image-preview-img').evaluate(img=>img.complete&&img.naturalWidth>0),'the attached image is displayed');
  await page.screenshot({path:path.join(output,'attachment-preview.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  await chip.focus();await page.keyboard.press('Enter');await dialog.waitFor();await dialog.getByRole('button',{name:'关闭预览'}).click();await dialog.waitFor({state:'detached'});
  // 2. Sending keeps the image visible and clickable in the user message.
  const input=page.locator('[contenteditable="true"]');await input.fill('检查这块板子的 DRC，不要修改文件。');await input.press('Enter');clock=Date.now();
  await emit({type:'system',subtype:'init',session_id:'timeline-fixture',timestamp:at(0)});
  const sentChip=page.locator('.message-attachment'),anyPreview=page.getByRole('dialog');await sentChip.waitFor();await sentChip.click();await anyPreview.waitFor();assert.ok(await anyPreview.locator('img').evaluate(img=>img.naturalWidth>0));await page.keyboard.press('Escape');await anyPreview.waitFor({state:'detached'});
  assert.equal(await page.locator('.user-message .edit-mode').count(),0,'previewing does not open message editing');
  // 3. A realistic turn: thinking, shell, read, KiCad capability, an edit, a subagent and a failure.
  const longOutput=Array.from({length:40},(_,i)=>'line '+(i+1)+' of the health report').join('\n');
  await emit(assistant([{type:'thinking',thinking:'先检查环境，再跑 DRC。'},{type:'tool_use',id:'bash',name:'Bash',input:{command:'git status --short | head; ls',description:'Check git status and list repo'}}],2));
  await emit(result('bash','3d-viewer\nAGENTS.md\nAUTHORS.txt\nCMakeLists.txt\nREADME.md'));
  await emit(assistant([{type:'tool_use',id:'read',name:'Read',input:{file_path:'/Users/mosc/Downloads/Kicad/tools/ai/composer/harness.ts',offset:1,limit:40}}],1));
  await emit(result('read','// Shared loop policy.\nimport * as fs from "node:fs/promises";'));
  await emit(assistant([{type:'tool_use',id:'kicad',name:'mcp__kicad__capability_call',input:{id:'tool:kicad_board',arguments:{action:'board.drc.run',payload:{input:'/p/board.kicad_pcb'}}}}],3));
  await emit(result('kicad',JSON.stringify({ok:true,action:'board.drc.run',data:{status:'violations',summary:{total:1180,bySeverity:{error:1067,warning:113}},log:longOutput}})));
  await emit(assistant([{type:'tool_use',id:'edit',name:'Edit',input:{file_path:'/p/notes.md',old_string:'old line',new_string:'new line'}}],1));
  await emit(result('edit','The file /p/notes.md has been updated.'));
  await emit(assistant([{type:'tool_use',id:'agent',name:'Task',input:{description:'检查 U1 供电',prompt:'只读检查 U1 的电源引脚',subagent_type:'Explore'}}],1));
  await emit(assistant([{type:'tool_use',id:'child-grep',name:'Grep',input:{pattern:'VDD_CORE',path:'/p'}}],1,'agent'));
  await emit(result('child-grep','board.kicad_sch:120: VDD_CORE',false,'agent'));
  await emit(result('agent','U1 供电正常。'));
  await emit(assistant([{type:'tool_use',id:'fail',name:'Bash',input:{command:'kicad-cli pcb export gerbers',description:'Export gerbers'}}],1));
  await emit(result('fail','Exit code 2\nERROR_FULL_DETAIL: output directory missing',true));
  await emit(assistant([{type:'thinking',thinking:'整理结论。'},{type:'tool_use',id:'pending',name:'Bash',input:{command:'sleep 30',description:'Wait for the long job'}}],4));
  const toggle=page.locator('.execution-toggle').first();await toggle.waitFor();
  assert.match(await toggle.innerText(),/运行中\s*8 次工具调用/);assert.match(await toggle.innerText(),/正在执行 Bash：Wait for the long job/);
  await page.screenshot({path:path.join(output,'running-collapsed.png')});
  await toggle.click();const details=page.getByRole('region',{name:'执行详情'});await details.waitFor();
  const rows=details.locator(':scope > .exec-steps > .exec-step');
  const heads=await details.locator(':scope > .exec-steps > .exec-step-tool > .exec-tool-head').allInnerTexts();
  assert.deepEqual(heads.map(h=>h.replace(/\s+/g,' ').trim()),['Bash Check git status and list repo','Read …/ai/composer/harness.ts · 1–40 行','kicad_board board.drc.run','Agent 检查 U1 供电 (Explore)','Bash Export gerbers','Bash Wait for the long job 执行中']);
  assert.match(await rows.first().innerText(),/思考了 2 秒/);
  const bash=details.locator('.exec-step-tool').first();assert.equal(await bash.locator('.exec-io-in .exec-io-text').innerText(),'git status --short | head; ls');assert.match(await bash.locator('.exec-io-out .exec-io-text').innerText(),/AGENTS\.md/);
  assert.ok(await bash.evaluate(el=>el.classList.contains('is-success')));
  const kicad=details.locator('.exec-step-tool').nth(2),out=kicad.locator('.exec-io-out .exec-io-text');
  const collapsedHeight=await out.evaluate(el=>el.clientHeight);assert.ok(collapsedHeight<90,'OUT previews a few lines: '+collapsedHeight);assert.match(await out.innerText(),/"status": "violations"/,'JSON results are indented');
  await out.click();const expandedHeight=await out.evaluate(el=>el.clientHeight);assert.ok(expandedHeight>collapsedHeight*2,'clicking OUT shows more: '+expandedHeight);
  await kicad.locator('.exec-io-in').hover();await kicad.locator('.exec-io-in .exec-io-copy').click();await kicad.locator('.exec-io-in .codicon-check').waitFor();
  assert.equal(await details.locator('.exec-rich .tool-label').first().innerText(),'Edit','edits keep their diff renderer');
  assert.match(await details.locator('.exec-step-tool').nth(4).innerText(),/子代理 · 1 次工具调用/);assert.match(await details.locator('.exec-steps.nested').innerText(),/Grep\s+"VDD_CORE"/);
  const failed=details.locator('.exec-step-tool.is-error');assert.equal(await failed.count(),1);assert.match(await failed.locator('.exec-io-err').innerText(),/ERROR_FULL_DETAIL/);
  assert.equal(await details.locator('.exec-step-tool.is-running').count(),1);assert.equal(await details.locator('.exec-step-live').count(),0,'a running tool replaces the thinking row');
  await page.screenshot({path:path.join(output,'running-expanded.png'),fullPage:true});
  await emit(result('pending','done'));await details.locator('.exec-step-live').waitFor();assert.match(await details.locator('.exec-step-live').innerText(),/思考中/);
  await emit(assistant([text('DRC 有 1180 项违规，导出 Gerber 失败：输出目录不存在。没有修改设计文件。')],2));await emit({type:'result',subtype:'success',is_error:false,result:'DRC 有 1180 项违规，导出 Gerber 失败：输出目录不存在。没有修改设计文件。'});
  await page.locator('.execution-answer').getByText(/DRC 有 1180 项违规/).waitFor();assert.match(await toggle.innerText(),/已完成\s*8 次工具调用/);assert.equal(await details.locator('.exec-step-live').count(),0);
  await page.screenshot({path:path.join(output,'completed-expanded.png'),fullPage:true});
  await details.getByRole('button',{name:/收起/}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await page.setViewportSize({width:320,height:900});await toggle.click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow at 320px');await page.screenshot({path:path.join(output,'narrow-320.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({ok:true,version,checks:['composer image chip shows a thumbnail and opens a preview by click or Enter; Escape and the close button dismiss it','sent message lists its images and previews them without entering edit mode','timeline rows: thought duration, tool name and summary, IN one line, OUT preview expands on click, copy','KiCad JSON results indented','edits keep the diff renderer','subagent calls nested under their Agent row','failed call marked with ERR output','running tool and thinking rows','collapse row','320px no horizontal overflow'],pageErrors:errors},null,2)+'\n');
  console.log('Execution timeline and image preview passed: Claude Code style rows, IN/OUT cards, nested subagents, failures, live state, composer and message image previews.');
 }catch(error){await page.screenshot({path:path.join(output,'ui-failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-3000));throw error;}finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
