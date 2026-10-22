// Real installed extension: one isolated current-model prediction + MCP catalog read.
const assert=require('node:assert/strict'),fs=require('node:fs'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('kicad-agent.kicad'),api=await extension.activate();
 await vscode.commands.executeCommand('kicad.showChat');
 const until=Date.now()+20000;while(api.getWebviewReadiness().mounted<1&&Date.now()<until)await new Promise(r=>setTimeout(r,150));
 assert.ok(api.getWebviewReadiness().mounted>=1);
 const instantiation=api.getInstantiationService(),id=[...instantiation._services._entries.keys()].find(id=>String(id)==='claudeAgentService');
 const agent=instantiation.invokeFunction(accessor=>accessor.get(id));
 const call=request=>agent.processRequest({type:'request',requestId:request.type+'-live',request},new AbortController().signal);
 const tools=await call({type:'tool_references'});assert.equal(tools.type,'tool_references_response');assert.ok(tools.tools.some(tool=>tool.name==='mcp__kicad__kicad_health'));assert.ok(tools.tools.every(tool=>JSON.parse(tool.schema).type==='object'));
 const history=[{role:'user',text:'请只读检查 U1 和 R1（10 kΩ）的相关问题，不要修改文件，也不要布线。检查后解释发现的问题。'},{role:'assistant',text:'已完成只读检查，没有修改文件或布线。U1 的供电与 R1 的阻值有需要解释的地方，下一步可以分别说明这两个器件的检查结果。'}];
 const prediction=await call({type:'predict_draft',model:'deepseek-flash',history});fs.writeFileSync('/tmp/kicad-composer-live-response.json',JSON.stringify(prediction,null,2));assert.equal(prediction.type,'predict_draft_response');assert.equal(prediction.model,'deepseek-flash');assert.equal(typeof prediction.text,'string');
 const original='帮我只读检查 U1 和 R1（10 kΩ），不要修改文件，也不要布线，解释发现的问题。';
 const optimized=await call({type:'optimize_prompt',text:original,model:'deepseek-flash'});assert.equal(optimized.type,'optimize_prompt_response');assert.equal(optimized.model,'deepseek-flash');assert.match(optimized.text,/U1/);assert.match(optimized.text,/R1/);assert.match(optimized.text,/10\s*kΩ/);
 const result={fixture:'Synthetic text conversation; no actual PCB inspection',original,optimized:optimized.text,version:extension.packageJSON.version,webviews:api.getWebviewReadiness(),liveModel:prediction.model,history,suggestion:prediction.text,actualMcpToolCount:tools.tools.length,toolsCalled:0,chatMessagesSent:0};
 fs.writeFileSync(process.env.KICAD_COMPOSER_TEST_RESULT || __dirname+'/audit/composer-live-host.json',JSON.stringify(result,null,2)+'\n');console.log('Real extension composer check passed: '+JSON.stringify(result));
};
