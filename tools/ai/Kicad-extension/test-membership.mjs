import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
let executions=0,closed=0,accountType='chatgpt',calls=[],toolReply;
const fixture={direct:async()=>({toolsList:()=>[{name:'kicad_board',description:'fixture',inputSchema:{type:'object',properties:{}}}]})};
class Client {
 async init(){return this;}close(){closed++;}
 async call(method,params){calls.push({method,params});if(method==='account/read')return {account:{type:accountType,planType:'fixture'}};
  if(method.startsWith('thread/'))return {thread:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}};
  if(method==='config/read')return {config:{mcp_servers:{'computer-use':{command:'fixture',tool_timeout_sec:null},'server.with.dots':{url:'https://fixture.invalid/mcp',http_headers:null}}}};
  if(method==='turn/start'){setTimeout(async()=>{toolReply=await this.onRequest('item/tool/call',{tool:'capability_call',arguments:{id:'tool:kicad_board',arguments:{action:'board.items.delete'}},callId:'fixture-call'});this.onEvent('turn/completed',{turn:{status:'completed'}});},0);return {turn:{id:'turn'}};}
  return {};
 }
}
const mocks={
 './shared/kicadDemand':{demandDefinitions:[{name:'capability_search'},{name:'capability_call'}],DEMAND_GUIDANCE:'on demand'},
 './shared/kicadLocalTools':{localToolDefinitions:[],executeLocalTool:async()=>({})},
 './shared/kicadMembership':{CodexClient:Client},
 './kicadRuntime':{createDemandCatalog:()=>({target:()=>({kind:'tool',name:'kicad_board'}),call:async()=>{executions++;return {ok:true}},close:async()=>{}}),getKiCadRuntimeConfig:()=>({entry:'/fixture.mjs'}),getKiCadNativeTools:async()=>[{name:'kicad_board',execute:async()=>{executions++;return {ok:true};}}],READ_ONLY_EDA_TOOLS:[]},
 './shared/kicadHistory':{readHistory:async()=>[{type:'user',message:{content:'original constraint'}}]},
 './shared/kicadDiagnostics':{diagnosticReport:async()=>({})},
 './services/claude/sessionContinuity':{SessionContinuity:class{async observe(){}async recordInput(){}async prompt(){return {hookSpecificOutput:{additionalContext:'preserve constraints'}}}beforeTool(){return {continue:true}}async afterTool(){}failedTool(){}async diagnosticError(){}validateAnswer(t,i,r){return r}}}
};
let source=fs.readFileSync(path.join(root,'src/kicadCodex.ts'),'utf8').replace('await import(pathToFileURL(getKiCadRuntimeConfig(params.cwd).entry).href)','await fixture.direct()');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports,require:n=>mocks[n]||require(n),fixture,AbortController,Date,setTimeout,clearTimeout});
const {codexQuery,withProviderHistory}=mod.exports;
const params={cwd:'/fixture',resume:null,model:'codex:fixture',permissionMode:'plan',canUseTool:async()=>{throw Error('Plan must deny writes before asking')},inputStream:{async *[Symbol.asyncIterator](){yield {message:{content:'Read the board'}}}}};
const query=await codexQuery(params),events=[];for await(const event of query)events.push(event);
assert.equal(executions,0);assert.equal(toolReply.success,false);assert.ok(events.some(e=>e.type==='user'&&e.message.content[0].is_error));assert.ok(events.some(e=>e.type==='result'&&!e.is_error));
assert.equal(calls.find(c=>c.method==='turn/start').params.sandboxPolicy.type,'readOnly');
const overrides=calls.find(c=>c.method==='thread/start').params.config;
assert.deepEqual(JSON.parse(JSON.stringify(overrides.mcp_servers)),{'computer-use':{command:'fixture',enabled:false},'server.with.dots':{url:'https://fixture.invalid/mcp',enabled:false}});
assert.ok(!Object.keys(overrides).some(key=>key.startsWith('mcp_servers.')), 'MCP names must remain literal table keys');
assert.ok(closed>0);
accountType='apiKey';await assert.rejects(()=>codexQuery(params),/会员/);
const migrated=await withProviderHistory({...params,resume:'claude-session'},true);assert.equal(migrated.resume,null);const messages=[];for await(const m of migrated.inputStream)messages.push(m);assert.match(messages[0].message.content[0].text,/original constraint/);
console.log('Membership passed: Codex provider routing, membership-only auth, plan tool denial, sandbox, completion and cross-provider historical context.');
