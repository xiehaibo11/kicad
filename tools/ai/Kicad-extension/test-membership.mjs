import assert from 'node:assert/strict';
import {resolveSettings,assertModelAllowed,capEffort} from '../composer/settings.ts';
import {autoDecision} from '../composer/permission-gates.ts';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
let executions=0,closed=0,accountType='chatgpt',calls=[],toolReply,denyPolicy=false,readOnly=false,nativeChildren=false,fixtureEffort;
let skills=[{name:'private',path:'/skills/private/SKILL.md',enabled:true},{name:'user-off',path:'/skills/off/SKILL.md',enabled:false},{name:'public',path:'/skills/public/SKILL.md',enabled:true}];
const fixture={direct:async()=>({toolsList:()=>[{name:'kicad_board',description:'fixture',inputSchema:{type:'object',properties:{}}}]})};
class Client {
 async init(){return this;}close(){closed++;}
 async call(method,params){calls.push({method,params});if(method==='account/read')return {account:{type:accountType,planType:'fixture'}};
  if(method.startsWith('thread/'))return {thread:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}};
  if(method==='skills/list')return {data:[{skills}]};
  if(method==='config/read')return {config:{mcp_servers:{'computer-use':{command:'fixture',tool_timeout_sec:null},'server.with.dots':{url:'https://fixture.invalid/mcp',http_headers:null}}}};
  if(method==='turn/start'){setTimeout(async()=>{
   if(nativeChildren){
    const child='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    this.onEvent('item/completed',{threadId:params.threadId,item:{type:'subAgentActivity',id:'spawn',kind:'started',agentThreadId:child,agentPath:'/root/review'}});
    const reply=await this.onRequest('item/tool/call',{threadId:child,tool:'capability_call',arguments:{id:'tool:kicad_board',arguments:{}},callId:'child-tool'});assert.equal(reply.success,true);
    this.onEvent('item/completed',{threadId:child,item:{type:'agentMessage',text:'CHILD_ONLY_OUTPUT'}});
    this.onEvent('turn/completed',{threadId:child,turn:{status:'completed'}});
    this.onEvent('item/completed',{threadId:params.threadId,item:{type:'agentMessage',text:'PARENT_FINAL_OUTPUT'}});
    this.onEvent('turn/completed',{threadId:params.threadId,turn:{status:'completed'}});return;
   }
   toolReply=await this.onRequest('item/tool/call',{tool:'capability_call',arguments:{id:'tool:kicad_board',arguments:{action:'board.items.delete'}},callId:'fixture-call'});this.onEvent('turn/completed',{turn:{status:'completed'}});},0);return {turn:{id:'turn'}};}
  return {};
 }
}
let fixtureSettings={mcpMode:'onDemand',disabledServers:[],skillsMode:'onDemand',disabledSkills:[],skillRoots:[],subagents:true,disabledSections:[]};
const mocks={
 './kicadSettings':{agentSettings:()=>({settings:resolveSettings([])})},
 './shared/kicadSettings':{assertModelAllowed,capEffort},
 './shared/kicadPermissionGates':{autoDecision},
 './shared/kicadModelProfile':{SEARCH_PAGE_SIZE:5},
 './shared/kicadPromptSections':{renderPromptSections:()=> 'fixture prompt sections'},
 './shared/kicadReasoning':{codexReasoningEffort:()=>fixtureEffort,reasoningOptions:()=>[{value:'default_on'}]},
 './shared/kicadIntent':{explicitDelegation:text=>/^Use a subagent/.test(text)&&!text.includes('<prior_conversation>')},
 './kicadToolOutput':{recordToolOutput(){}},
 './shared/kicadDemand':{normalizeCapabilityCall:(id,args)=>({id,args:typeof args==='string'?JSON.parse(args):args||{}}),inspectDefinition:{name:'capability_inspect'},demandDefinitions:[{name:'capability_search'},{name:'capability_call'}]},
 './shared/kicadLocalTools':{localToolDefinitions:[],executeLocalTool:async()=>({})},
 './shared/kicadMembership':{CodexClient:Client},
 './kicadRuntime':{withSyncedServers:async(cwd,servers)=>servers,createDemandCatalog:()=>({target:()=>({kind:'tool',name:'kicad_board'}),isReadOnly:async()=>readOnly,call:async()=>{executions++;return {ok:true}},close:async()=>{}}),getKiCadRuntimeConfig:()=>({entry:'/fixture.mjs'}),getKiCadNativeTools:async()=>[{name:'kicad_board',execute:async()=>{executions++;return {ok:true};}}],READ_ONLY_EDA_TOOLS:[],kicadToolSettings:()=>fixtureSettings,kicadPromptFeatures:()=>({}),kicadDemandGuidance:()=> 'on demand'},
 './shared/kicadHistory':{readHistory:async()=>[{type:'user',message:{content:'original constraint'}}]},
 './shared/kicadDiagnostics':{diagnosticReport:async()=>({})},
 './services/claude/sessionContinuity':{SessionContinuity:class{configure(){}async observe(){}async recordInput(message){this.request=message.message?.content||''}delegationRequested(){return fixtureSettings.subagents&&mocks['./shared/kicadIntent'].explicitDelegation(this.request)}async prompt(){return {hookSpecificOutput:{additionalContext:'preserve constraints'}}}beforeTool(){return denyPolicy?{continue:true,hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'fixture policy denial'}}:{continue:true}}async afterTool(){}failedTool(){}async diagnosticError(){}validateAnswer(t,i,r){return r}}}
};
let source=fs.readFileSync(path.join(root,'src/kicadCodex.ts'),'utf8').replace('await import(pathToFileURL(getKiCadRuntimeConfig(params.cwd).entry).href)','await fixture.direct()');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports,require:n=>mocks[n]||require(n),fixture,AbortController,Date,setTimeout,clearTimeout,process});
const {codexQuery,withProviderHistory}=mod.exports;
const params={cwd:'/fixture',resume:null,model:'codex:fixture',permissionMode:'plan',canUseTool:async()=>{throw Error('Plan must deny writes before asking')},inputStream:{async *[Symbol.asyncIterator](){yield {message:{content:'Read the board'}}}}};
const query=await codexQuery(params),events=[];for await(const event of query)events.push(event);
assert.equal(executions,0);assert.equal(toolReply.success,false);assert.ok(events.some(e=>e.type==='user'&&e.message.content[0].is_error));assert.ok(events.some(e=>e.type==='result'&&!e.is_error));
assert.equal(calls.find(c=>c.method==='turn/start').params.sandboxPolicy.type,'readOnly');
const overrides=calls.find(c=>c.method==='thread/start').params.config;
assert.deepEqual(JSON.parse(JSON.stringify(overrides.mcp_servers)),{'computer-use':{command:'fixture',tool_timeout_sec:null,enabled:false},'server.with.dots':{url:'https://fixture.invalid/mcp',http_headers:null,enabled:false}});
assert.ok(!Object.keys(overrides).some(key=>key.startsWith('mcp_servers.')), 'MCP names must remain literal table keys');
assert.match(calls.find(c=>c.method==='thread/start').params.developerInstructions,/^fixture prompt sections\n\non demand/,'Codex receives the same model-agnostic components');
assert.ok('skills.config' in overrides,'on-demand skills disable Codex\'s own skill loading');
// Direct MCP / native skills leave Codex's own loading on, except disabled servers.
fixtureSettings={...fixtureSettings,mcpMode:'direct',disabledServers:['computer-use'],skillsMode:'native',disabledSkills:['private']};calls.length=0;
for await(const event of await codexQuery(params))void event;
const direct=calls.find(c=>c.method==='thread/start').params.config;
assert.deepEqual(JSON.parse(JSON.stringify(direct.mcp_servers)),{'computer-use':{command:'fixture',tool_timeout_sec:null,enabled:false},'server.with.dots':{url:'https://fixture.invalid/mcp',http_headers:null,enabled:true}});assert.deepEqual(JSON.parse(JSON.stringify(direct['skills.config'])),[{path:'/skills/private/SKILL.md',enabled:false},{path:'/skills/off/SKILL.md',enabled:false}]);
assert.ok(closed>0);
// Read-only typed actions work in plan mode, and policy denials still apply in bypass.
readOnly=true;executions=0;
for await(const event of await codexQuery(params))void event;
assert.equal(executions,1);assert.equal(toolReply.success,true);
denyPolicy=true;executions=0;
for await(const event of await codexQuery({...params,permissionMode:'bypassPermissions'}))void event;
assert.equal(executions,0);assert.equal(toolReply.success,false);assert.match(toolReply.contentItems[0].text,/policy denial/);
denyPolicy=false;readOnly=false;

// Native collaboration is disabled for ordinary turns and enabled only for a
// current human request. A policy change cold-resumes the same native thread.
calls.length=0;
const turns={async *[Symbol.asyncIterator](){for(const text of ['Read the board','Use a subagent to review U1','Continue yourself'])yield {message:{content:text}};}};
for await(const event of await codexQuery({...params,inputStream:turns}))void event;
assert.deepEqual(calls.filter(c=>c.method==='thread/start'||c.method==='thread/resume').map(c=>c.params.config['features.multi_agent']),[false,true,false]);
assert.equal(new Set(calls.filter(c=>c.method==='thread/resume').map(c=>c.params.threadId)).size,1);
for(const key of ['agents.enabled','features.multi_agent_v2'])assert.deepEqual(calls.filter(c=>c.method==='thread/start'||c.method==='thread/resume').map(c=>c.params.config[key]),[false,true,false]);
fixtureEffort='ultra';calls.length=0;
for await(const event of await codexQuery({...params,reasoningLevel:'ultra'}))void event;
assert.equal(calls.find(c=>c.method==='thread/start').params.config['features.multi_agent_v2'],false,'Ultra cannot authorize delegation');
assert.equal(calls.find(c=>c.method==='turn/start').params.effort,'ultra');fixtureEffort=undefined;
fixtureSettings={...fixtureSettings,subagents:false};calls.length=0;
for await(const event of await codexQuery({...params,inputStream:{async *[Symbol.asyncIterator](){yield {message:{content:'Use a subagent to review U1'}};}}}))void event;
assert.equal(calls.find(c=>c.method==='thread/start').params.config['features.multi_agent'],false);

// V2 lifecycle notifications authorize only the announced child. Its dynamic
// calls use the same permissions, and its completion cannot finish the parent.
fixtureSettings={...fixtureSettings,subagents:true};nativeChildren=true;readOnly=true;
const childEvents=[];for await(const event of await codexQuery({...params,inputStream:{async *[Symbol.asyncIterator](){yield {message:{content:'Use a subagent to review U1'}};}}}))childEvents.push(event);
assert.equal(childEvents.filter(e=>e.type==='result').length,1);
assert.ok(childEvents.some(e=>e.type==='assistant'&&e.parent_tool_use_id&&e.message.content.some(b=>b.text==='CHILD_ONLY_OUTPUT')));
assert.ok(childEvents.some(e=>e.type==='assistant'&&!e.parent_tool_use_id&&e.message.content.some(b=>b.text==='PARENT_FINAL_OUTPUT')));
assert.ok(childEvents.some(e=>e.type==='assistant'&&e.parent_tool_use_id&&e.message.content.some(b=>b.id==='child-tool')));
nativeChildren=false;
accountType='apiKey';await assert.rejects(()=>codexQuery(params),/会员/);
const migrated=await withProviderHistory({...params,resume:'claude-session'},true);assert.equal(migrated.resume,null);const messages=[];for await(const m of migrated.inputStream)messages.push(m);assert.match(messages[0].message.content[0].text,/original constraint/);
console.log('Membership passed: Codex provider routing, membership-only auth, plan tool denial, sandbox, completion and cross-provider historical context.');
