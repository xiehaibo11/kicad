import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript'),cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);if(name==='./kicadRuntime')return {getKiCadMcpServer(){throw Error('Prediction must never touch MCP')}};const file=path.join(root,'src',name.replace('./','')+'.ts'),module={exports:{}};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(js,{module,exports:module.exports,require:load,AbortController,setTimeout,clearTimeout});cache.set(name,module.exports);return module.exports;}
const {predictDraft}=load('./kicadComposer'),{predictionContext,predictionText}=load('./kicadPrediction');
const history=[{role:'user',text:'只检查 U1 和 R1（10 kΩ），不要修改文件，也不要布线。'},{role:'assistant',text:'已完成只读检查，已列出需要你确认的问题。'}];
const request={type:'predict_draft',model:'deepseek-flash',history};
let count=0;
const run=({prompt,options})=>{count++;assert.equal(options.model,request.model);assert.equal(options.persistSession,false);assert.equal(options.tools.length,0);assert.equal(Object.keys(options.mcpServers).length,0);assert.equal(options.strictMcpConfig,true);assert.equal(options.settingSources.length,0);assert.match(options.systemPrompt,/USER/);assert.match(options.systemPrompt,/Never invent/);assert.deepEqual(JSON.parse(prompt),history);return {async *[Symbol.asyncIterator](){yield {type:'result',subtype:'success',result:'请解释 U1 和 R1 的检查结果，仍不要修改或布线。'}},async return(){}}};
const result=await predictDraft(request,{cwd:'/isolated',cliPath:'/cli',env:{}},new AbortController().signal,run);assert.equal(result.model,request.model);assert.match(result.text,/U1/);assert.equal(count,1);
const abstain=await predictDraft(request,{cwd:'/isolated',cliPath:'/cli',env:{}},new AbortController().signal,()=>({async *[Symbol.asyncIterator](){yield {type:'result',subtype:'success',result:'<NONE>'}},async return(){}}));assert.equal(abstain.text,'');
assert.equal(predictionText(' <NONE> '),'');assert.equal(JSON.parse(predictionContext(Array.from({length:30},()=>({role:'user',text:'x'.repeat(9000)})))).length,8);
console.log('Composer backend checks passed: current model, no tools/history writes, grounded prompt, abstention and bounded context.');
