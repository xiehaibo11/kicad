// Packaged production UI with a deterministic host; preferences survive reload
// through host storage, independently of the Vue application under test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=process.argv[2],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,output=path.join(__dirname,'audit','models-'+version);fs.mkdirSync(output,{recursive:true});
 const fixture=fs.readFileSync(path.join(__dirname,'test-composer-ui.cjs'),'utf8');
 let html=fixture.slice(fixture.indexOf(' const html=`')+13,fixture.indexOf('`;\n const server='));
 html=html.replaceAll('已完成 U1 和 R1 的只读检查，没有修改文件或布线。需要你确认是否进一步解释结果。','任务已完成。').replaceAll('已完成只读检查。','任务已完成。');
 html=html.replace("modelSetting:'deepseek-flash'", "modelSetting:localStorage.getItem('fixture.hostModel')||'deepseek-flash'");
 html=html.replace("const t=m.request.type;", `const t=m.request.type;
 if(t==='update_extension_config' && m.request.key==='selectedModel'){
   if(window.failSave){receive({type:'response',requestId:m.requestId,response:{type:'error',error:'保存模型失败测试'}});return;}
   localStorage.setItem('fixture.hostModel',m.request.value);
 }
 if(t==='sdk_probe' && window.probePending){window.pendingProbe=m;return;}`);
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html)}const file=path.join(root,'dist/media',req.url);if(!fs.existsSync(file)){res.writeHead(404);return res.end()}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:720,height:920},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{localStorage.setItem('kicad.draftSuggestions','off');window.probePending=true;});
 const picker=()=>page.getByRole('button',{name:'选择模型',exact:true}),input=()=>page.locator('.inputContainer [contenteditable=true]');
 const sent=()=>page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').length);
 async function select(name,target=picker().last()){
  await target.click();await page.locator('.dropdown-trigger-popover').getByText(name,{exact:true}).click();
  await page.waitForFunction(name=>[...document.querySelectorAll('.model-dropdown')].every(el=>el.textContent.includes(name)),name);
 }
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>document.querySelector('.model-dropdown')?.textContent.includes('DeepSeek Flash'));
  await select('DeepSeek V4 Pro');assert.equal(await sent(),0);assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='launch_claude').length),0);
  await page.evaluate(()=>{const p=window.pendingProbe;window.dispatchEvent(new MessageEvent('message',{data:{type:'from-extension',message:{type:'response',requestId:p.requestId,response:{type:'sdk_probe_response',data:{supportedModels:[{value:'default',displayName:'Default'}]},errors:[]}}}}));});
  assert.match(await picker().innerText(),/DeepSeek V4 Pro/,'late discovery must not choose Default');
  await input().fill('1');await input().press('Enter');await page.waitForFunction(()=>document.querySelector('.submit-button')?.dataset.variant!=='stop');
  assert.equal(await page.evaluate(()=>window.previewMessages.find(m=>m.type==='launch_claude').model),'deepseek-v4-pro');
  const mode=page.locator('.inputContainer .mode-dropdown');await mode.click();await page.locator('.dropdown-trigger-popover').getByText('最高权限',{exact:true}).click();
  await page.locator('.message-view').first().click();const edit=page.locator('.edit-mode');await edit.waitFor();
  assert.match(await edit.getByRole('button',{name:'选择模型',exact:true}).innerText(),/DeepSeek V4 Pro/);assert.match(await edit.locator('.mode-dropdown').innerText(),/最高权限/);
  await select('DeepSeek Flash',edit.getByRole('button',{name:'选择模型',exact:true}));assert.equal(await edit.count(),1,'selecting must not close the editor');assert.match(await picker().last().innerText(),/DeepSeek Flash/);assert.equal(await sent(),1);
  await page.screenshot({path:path.join(output,'edit-model-synchronized.png')});
  await edit.locator('[contenteditable=true]').fill('继续执行刚才的任务');await edit.locator('[contenteditable=true]').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.edit-mode').length===0);await page.waitForFunction(()=>document.querySelector('.submit-button')?.dataset.variant!=='stop');assert.equal(await sent(),2,'edited message sends exactly once');
  assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.request?.type==='set_model').at(-1).request.model.value),'deepseek-flash');assert.equal(await page.evaluate(()=>window.previewMessages.filter(m=>m.type==='io_message').at(-1).message.message.content.at(-1).text),'继续执行刚才的任务');
  assert.equal(await page.locator('.message-view').count(),1,'resend replaces the original user bubble');assert.equal(await page.locator('.message-view').innerText(),'继续执行刚才的任务');
  await page.locator('.message-view').click();await edit.waitFor();await edit.locator('[contenteditable=true]').fill('再次修改并继续执行');await edit.locator('[contenteditable=true]').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.edit-mode').length===0 && document.querySelector('.submit-button')?.dataset.variant!=='stop');assert.equal(await sent(),3);assert.equal(await page.locator('.message-view').count(),1);assert.equal(await page.locator('.message-view').innerText(),'再次修改并继续执行');assert.match(await picker().innerText(),/DeepSeek Flash/);
  await page.screenshot({path:path.join(output,'resend-one-message.png')});
  await input().fill('再次修改并继续执行');await input().press('Enter');await page.waitForFunction(()=>document.querySelector('.submit-button')?.dataset.variant!=='stop');assert.equal(await page.locator('.message-view').count(),2,'identical ordinary new messages stay independent');
  await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.message-view').length===0);assert.match(await picker().innerText(),/DeepSeek Flash/);
  await select('DeepSeek V4 Pro');await page.reload();await page.waitForFunction(()=>document.querySelector('.model-dropdown')?.textContent.includes('DeepSeek V4 Pro'));assert.equal(await sent(),0,'reload never automatically resends');
  await page.evaluate(()=>window.failSave=true);await picker().click();await page.locator('.dropdown-trigger-popover').getByText('Sonnet',{exact:true}).click();await page.getByRole('alert').getByText('保存模型失败测试',{exact:true}).waitFor();assert.match(await picker().innerText(),/DeepSeek V4 Pro/);
  await page.evaluate(()=>window.failSave=false);await select('Default');await page.reload();await page.waitForFunction(()=>document.querySelector('.model-dropdown')?.textContent.includes('Default'));assert.match(await picker().innerText(),/Default/,'explicit Default remains selected');
  await select('DeepSeek Flash');await input().fill('保持当前模型继续任务');await input().press('Enter');await page.waitForFunction(()=>document.querySelector('.submit-button')?.dataset.variant!=='stop');await page.getByTitle('新开对话',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.message-view').length===0);assert.match(await picker().innerText(),/DeepSeek Flash/);
  await page.screenshot({path:path.join(output,'new-conversation-model-retained.png')});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({ok:true,version,checks:['selection never starts or sends a chat','late SDK discovery never changes selection','historical editor and main input share model and permission','model selection works inside history editor','edited message really sends exactly once','new chat retains selected model','reload restores host preference without sending','failed save retains previous model','explicit Default retained','only explicit selection changes preference'],pageErrors:errors,source:'Production Vue bundle with deterministic host'},null,2));console.log('Production model selection UI passed: '+output);
 }catch(error){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('body').innerText());throw error;}finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
