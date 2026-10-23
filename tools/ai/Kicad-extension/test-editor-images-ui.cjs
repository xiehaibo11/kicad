// Production webview with simulated tool events. Editor requests are asserted, not rendered as fake windows.
const assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','editor-images-'+version);fs.mkdirSync(output,{recursive:true});
 const existing=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');let html=existing.slice(existing.indexOf(' const html=`')+13,existing.indexOf('`;\n const server='));
 html=html.replace("if(m.type==='io_message'){","if(m.type==='io_message'){return;");
 html=html.replace('const t=m.request.type;',"const t=m.request.type;if(t==='open_file'&&window.failImage){receive({type:'response',requestId:m.requestId,response:{type:'error',error:'Image file no longer exists'}});return;}");
 html=html.replace('<div id="app"></div>','<div style="position:fixed;top:2px;right:4px;z-index:99999;background:#294252;color:#fff;padding:2px 5px;font:10px monospace;pointer-events:none">UI TEST · simulated events · no model</div><div id="app"></div>');
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()};res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:620,height:900},deviceScaleFactor:2}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('kicad.draftSuggestions','off'));
 const emit=async event=>page.evaluate(event=>window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'io_message',channelId:window.chatChannel,message:event}}})),event);
 const assistant=content=>({type:'assistant',message:{role:'assistant',content}}),result=(id,content,is_error=false)=>({type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:id,content,is_error}]}});
 const filePath='/private/tmp/Kicad 图片 exports/cleared PCB.png',image={type:'image',source:{type:'base64',media_type:'image/png',data:fs.readFileSync(path.join(__dirname,'overlay/kicad-logo.png')).toString('base64')}};
 const openRequests=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type==='open_file').map(m=>m.request));
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const input=page.locator('[contenteditable="true"]');await input.fill('查看这两张图片，不要修改项目。');await input.press('Enter');await emit({type:'system',subtype:'init',session_id:'image-fixture'});
  await emit(assistant([{type:'tool_use',id:'image',name:'Read',input:{file_path:filePath}}]));
  const step=page.locator('.exec-step-tool').first(),header=step.locator('.exec-tool-file');await header.waitFor();assert.equal(await header.innerText(),'cleared PCB.png');
  assert.equal(await step.locator('.exec-io-image').count(),0,'pending reads never claim an image result');assert.deepEqual(await openRequests(),[]);
  await emit(result('image',[image,{type:'text',text:'Read image successfully'}]));await step.locator('.exec-io-image').waitFor();
  assert.deepEqual(await openRequests(),[],'tool events never open the editor automatically');assert.doesNotMatch(await step.innerText(),/\[图片\]|iVBOR/);
  assert.match(await step.innerText(),/Read image successfully/,'mixed text/image results retain their text');
  await header.click();await page.waitForFunction(()=>window.previewMessages.filter(m=>m.request?.type==='open_file').length===1);assert.equal((await openRequests())[0].filePath,filePath);
  assert.equal(await page.getByRole('dialog').count(),0,'no image modal is created');assert.equal(page.context().pages().length,1,'no browser popup');
  const view=step.locator('.exec-image-link');await view.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.previewMessages.filter(m=>m.request?.type==='open_file').length===2);
  await header.focus();await page.keyboard.press('Space');await page.waitForFunction(()=>window.previewMessages.filter(m=>m.request?.type==='open_file').length===3);
  assert.ok((await openRequests()).every(r=>r.filePath===filePath),'all activations preserve the original Unicode/space path');
  await page.screenshot({path:path.join(output,'clickable-read.png'),fullPage:true});
  await page.evaluate(()=>window.failImage=true);await view.click();await step.getByRole('alert').waitFor();assert.match(await step.getByRole('alert').innerText(),/Image file no longer exists/);
  await page.evaluate(()=>window.failImage=false);await view.click();await step.getByRole('alert').waitFor({state:'detached'});
  await emit(assistant([{type:'tool_use',id:'legacy',name:'Read',input:{file_path:'/tmp/old image.svg'}}]));await emit(result('legacy','[图片]'));
  await page.locator('.exec-step-tool').nth(1).locator('.exec-image-link').waitFor();assert.doesNotMatch(await page.locator('.exec-step-tool').nth(1).innerText(),/\[图片\]/,'history placeholders get a useful link too');
  await emit(assistant([{type:'tool_use',id:'missing',name:'Read',input:{file_path:'/tmp/missing.png'}}]));await emit(result('missing','File does not exist',true));
  const failed=page.locator('.exec-step-tool').nth(2);assert.match(await failed.locator('.exec-io-err').innerText(),/File does not exist/);assert.equal(await failed.locator('.exec-io-image').count(),0);
  await emit(assistant([{type:'tool_use',id:'continue',name:'Bash',input:{command:'git status --short',description:'Continue checking the project'}}]));await emit(result('continue','working tree preserved'));
  assert.match(await page.locator('.exec-step-tool').last().innerText(),/working tree preserved/,'image clicks do not stop or reset the running conversation');
  await page.setViewportSize({width:320,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'narrow-320.png'),fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({ok:true,version,provenance:'production bundle; simulated SDK events and host responses; no model calls',checks:['filename click','OUT image Enter','filename Space','no automatic open','no modal or popup','original paths preserved','mixed text/image','legacy placeholder','failed Read remains ERR','host open failure and retry','stream continues','320px layout'],openRequests:await openRequests(),pageErrors:errors},null,2)+'\n');
  console.log('Editor image UI passed: explicit click/keyboard requests, no modal/popups, errors, continuing stream and narrow layout.');
 }catch(error){await page.screenshot({path:path.join(output,'ui-failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-3000));throw error;}finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
