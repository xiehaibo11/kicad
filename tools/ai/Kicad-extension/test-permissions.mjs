// Exercise real patched methods: full-access options, live mode changes and rollback.
import assert from 'node:assert/strict';
import {resolveSettings,assertModelAllowed,capEffort} from '../composer/settings.ts';
import {autoDecision} from '../composer/permission-gates.ts';
import {reasoningOptions,applyReasoningEnvironment} from './overlay/kicadReasoning.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function method(file,className,name){
  const tree=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
  return tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===className).members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)===name).getText(tree);
}
let options;
let fixturePolicy=resolveSettings([]);
let fixtureSettings={mcpMode:'onDemand',disabledServers:[],skillsMode:'onDemand',disabledSkills:[],skillRoots:[],subagents:true,disabledSections:[]};
const query=method('src/services/claude/ClaudeSdkService.ts','ClaudeSdkService','query').replace("await import('@anthropic-ai/claude-agent-sdk')",'await fixture.sdk()');
const fixture={sdk:async()=>({query:request=>{options=request.options;return {fixture:true,next:async()=>({done:true}),return:async()=>({done:true})}}})};
const scope={claudeSettingsArgument:value=>value?'/fixture/settings.json':JSON.stringify({includeCoAuthoredBy:false,attribution:{commit:'',pr:''}}),agentSettings:()=>({settings:fixturePolicy}),assertModelAllowed,capEffort,autoDecision,reasoningOptions,DEMAND_GUIDANCE:'on demand',membershipEnvironment:env=>env,withProviderHistory:async p=>p,fixture,path,os,recordToolOutput(){},SessionContinuity:class{configure(){}beforeTool(){return {continue:true}}validateAnswer(tool,input,result){return result}needsConfirmation(tool,input){return tool==='Bash'&&/push --force/.test(input?.command||'')}},AbortController,process:{env:{},platform:'darwin'},vscode:{Uri:{file:f=>f}},getKiCadSdkServers:async()=>({kicad:{type:'sdk',name:'kicad',instance:{}}}),getKiCadSdkSession:async()=>({settings:fixtureSettings,servers:{kicad:{type:'sdk',name:'kicad',instance:{}}},catalog:{isReadOnly:async(id,args)=>id==='tool:kicad_board'&&args?.action==='board.drc.run'}}),kicadAgents:settings=>settings.subagents?{'kicad-reviewer':{description:'fixture',tools:[],prompt:'fixture',model:'inherit'}}:undefined,kicadPromptFeatures:()=>({}),kicadDemandGuidance:()=> 'on demand',READ_ONLY_EDA_TOOLS:['mcp__kicad__kicad_health'],isDeepSeekModel:()=>false,applyReasoningEnvironment,renderPromptSections:()=> 'fixture prompt',VS_CODE_APPEND_PROMPT:'fixture'};
vm.runInNewContext(transpile(`class SDK {
  logService={info(){},warn(){},error(){}};
  configService={getAllSettings:async()=>({}),getEnvironmentVariables:async()=>({})};
  fileSystemService={pathExists:async()=>true,stat:async()=>({size:1}),isExecutable:async()=>true};
  async getClaudeExecutablePath(){return '/fixture/cli'}
  async getMergedEnvironmentVariables(){return {}}
  ${query}
};globalThis.sdk=new SDK();`),scope);
const canUseTool=()=>{throw Error('query setup must not auto-approve anything')};
for(const permissionMode of ['acceptEdits','default','plan','bypassPermissions']){
  const stream=await scope.sdk.query({inputStream:{},resume:null,model:'sonnet',cwd:'/fixture',permissionMode,maxThinkingTokens:0,canUseTool});
  assert.equal(options.permissionMode,permissionMode);
  assert.equal(options.allowDangerouslySkipPermissions,true,'live mode changes require the SDK capability');
  assert.equal(typeof options.canUseTool,'function','questions still have a real permission callback and answer validation');
  assert.equal(options.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,'85');
  assert.equal(options.systemPrompt.append.startsWith('fixture prompt'),true,'dynamic prompt sections precede the static instructions');
  assert.ok(options.hooks.UserPromptSubmit&&options.hooks.PreCompact&&options.hooks.SessionStart);
  assert.deepEqual(Object.keys(options.mcpServers),['kicad'],'chat registers only in-process KiCad tools');
  assert.equal(options.mcpServers.kicad.type,'sdk');
  assert.deepEqual(Array.from(options.allowedTools),['mcp__kicad__kicad_health','mcp__kicad__capability_search'],'only read-only EDA tools skip the prompt');
  assert.deepEqual(Object.keys(options.agents),['kicad-reviewer'],'domain sub-agents are registered');assert.deepEqual(Array.from(options.disallowedTools),['Skill']);assert.ok('disable-slash-commands' in options.extraArgs);
  assert.equal(options.abortController.signal.aborted,false);await stream.return();assert.equal(options.abortController.signal.aborted,true,'closing a channel must abort the CLI and its MCP processes');
}
const delegated=[];
await scope.sdk.query({inputStream:{},resume:null,model:'sonnet',cwd:'/fixture',permissionMode:'plan',canUseTool:async(name,args)=>{delegated.push({name,args});return {behavior:'deny',message:'fixture denial'};}});
assert.equal((await options.canUseTool('mcp__kicad__capability_call',{id:'tool:kicad_health',arguments:{}},{})).behavior,'allow');
for(const id of ['tool:kicad_board','mcp:selected:write','skill:fixture'])assert.equal((await options.canUseTool('mcp__kicad__capability_call',{id,arguments:{action:'write'}},{})).behavior,'deny');
assert.deepEqual(delegated.map(x=>x.name),['mcp__kicad__kicad_board','mcp__selected__write','Skill']);
// Read-only typed actions and the read-only inspect tool never prompt, even in plan mode.
assert.equal((await options.canUseTool('mcp__kicad__capability_call',{id:'tool:kicad_board',arguments:{action:'board.drc.run'}},{})).behavior,'allow');
assert.equal((await options.canUseTool('mcp__kicad__capability_inspect',{id:'tool:kicad_board',arguments:{action:'board.drc.run'}},{})).behavior,'allow');assert.equal(delegated.length,3);
assert.equal((await options.canUseTool('mcp__kicad__capability_inspect',{id:'tool:kicad_board',arguments:{action:'board.items.delete'}},{})).behavior,'deny');assert.equal(delegated.length,3,'a mutating inspect target is refused without asking');
// External MCP targets keep asking through inspect: readOnlyHint is the server's own claim.
assert.equal((await options.canUseTool('mcp__kicad__capability_inspect',{id:'mcp:selected:lookup',arguments:{}},{})).behavior,'deny');assert.equal(delegated.at(-1).name,'mcp__selected__lookup');
assert.deepEqual(JSON.parse(JSON.stringify(delegated[2].args)),{skill:'fixture'});
// Native skills and disabled sub-agents change the offered tools, not the permission policy.
fixtureSettings={...fixtureSettings,skillsMode:'native',subagents:false};
await (await scope.sdk.query({inputStream:{},resume:null,model:'sonnet',cwd:'/fixture',permissionMode:'default',maxThinkingTokens:0,canUseTool})).return();
assert.deepEqual(Array.from(options.disallowedTools),['Agent','Task']);assert.ok(!('disable-slash-commands' in options.extraArgs));assert.equal(options.agents,undefined);assert.ok(!options.allowedTools.includes('mcp__kicad__capability_inspect'));
fixtureSettings={...fixtureSettings,skillsMode:'onDemand',subagents:true};
// Local Auto approves known low-risk calls and keeps unknown operations interactive.
const agentStream=await scope.sdk.query({inputStream:{},resume:null,model:'sonnet',cwd:'/fixture',permissionMode:'acceptEdits',maxThinkingTokens:0,canUseTool:()=>{throw Error('Agent must not ask')}});
assert.equal((await options.canUseTool('Bash',{command:'ls'},{})).behavior,'allow');
// Harness gate 2: a risky call asks even in Agent mode.
await assert.rejects(()=>options.canUseTool('Bash',{command:'git push --force'},{}),/Agent must not ask/,'risky calls reach the user prompt');
await assert.rejects(()=>options.canUseTool('mcp__kicad__capability_call',{id:'tool:kicad_board',arguments:{action:'board.items.delete'}},{}),/Agent must not ask/,'unknown mutations need confirmation');
const preTool=options.hooks.PreToolUse[0].hooks[0];
assert.equal((await preTool({tool_name:'Bash',tool_input:{command:'npm test'}})).hookSpecificOutput.permissionDecision,'ask');
assert.equal((await preTool({tool_name:'Edit',tool_input:{file_path:'/fixture/a.ts'}})).continue,true);
assert.equal(options.env.CLAUDE_CODE_DISABLE_WORKFLOWS,'1');
assert.equal(options.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS,'300000');
await agentStream.return();
fixturePolicy=resolveSettings([{source:'fixture',value:{autoMode:false,commitAttribution:false}}]);
const manual=await scope.sdk.query({inputStream:{},model:'claude-opus-5-5',cwd:'/fixture',permissionMode:'acceptEdits',canUseTool});
assert.equal((await options.hooks.PreToolUse[0].hooks[0]({tool_name:'Edit',tool_input:{file_path:'/fixture/a.ts'}})).hookSpecificOutput.permissionDecision,'ask');
assert.equal(JSON.parse(options.extraArgs.settings).includeCoAuthoredBy,false);await manual.return();
fixturePolicy=resolveSettings([{source:'fixture',value:{mcpVerification:false}}]);
const unverified=await scope.sdk.query({inputStream:{},model:'claude-opus-5-5',cwd:'/fixture',permissionMode:'acceptEdits',canUseTool});
assert.equal((await options.canUseTool('mcp__kicad__capability_call',{id:'mcp:selected:write',arguments:{}},{})).behavior,'allow');await unverified.return();
fixturePolicy=resolveSettings([{source:'fixture',value:{deniedModels:['deepseek-*'],maxEffortLevel:'low'}}]);
await assert.rejects(()=>scope.sdk.query({inputStream:{},model:'deepseek-flash',cwd:'/fixture',permissionMode:'acceptEdits',canUseTool}),/blocked/);
await assert.rejects(()=>scope.sdk.query({inputStream:{},model:'gpt-5-pro',cwd:'/fixture',permissionMode:'acceptEdits',canUseTool,reasoningLevel:'max'}),/No supported/);
const capped=await scope.sdk.query({inputStream:{},model:'claude-opus-5-5',cwd:'/fixture',permissionMode:'acceptEdits',canUseTool,reasoningLevel:'max'});
assert.equal(options.env.CLAUDE_CODE_EFFORT_LEVEL,'low');await capped.return();
fixturePolicy=resolveSettings([]);

const change=method('src/webview/src/core/Session.ts','Session','setPermissionMode');
let selected='acceptEdits',success=true,reject=false,approvals=[];
const requests=['Bash','Read','mcp__kicad__kicad_call','AskUserQuestion','ExitPlanMode','EnterPlanMode'].map(toolName=>({toolName,inputs:{fixture:true},accept:(...args)=>approvals.push({toolName,args})}));
const sessionScope={fixture:{mode:(...args)=>args.length?(selected=args[0]):selected,requests,connection:{setPermissionMode:async()=>{if(reject)throw Error('fixture failure');return success}}}};
vm.runInNewContext(transpile(`class Session {
  permissionMode=fixture.mode;claudeChannelId=()=> 'c1';permissionRequests=()=>fixture.requests;busy(){return false}
  async getConnection(){return fixture.connection}
  ${change}
};globalThis.session=new Session();`),sessionScope);
assert.equal(await sessionScope.session.setPermissionMode('bypassPermissions'),true);
assert.equal(selected,'bypassPermissions');assert.deepEqual(approvals.map(a=>a.toolName),['Bash','Read','mcp__kicad__kicad_call']);
assert.ok(approvals.every(a=>a.args[1].length===0),'changing modes must not write persistent permission rules');
await sessionScope.session.setPermissionMode('acceptEdits');assert.equal(selected,'acceptEdits');
success=false;approvals=[];assert.equal(await sessionScope.session.setPermissionMode('bypassPermissions'),false);assert.equal(selected,'acceptEdits');assert.equal(approvals.length,0);
reject=true;await assert.rejects(sessionScope.session.setPermissionMode('bypassPermissions'),/fixture failure/);assert.equal(selected,'acceptEdits');assert.equal(approvals.length,0);
let release;
sessionScope.fixture.connection.setPermissionMode=()=>new Promise(resolve=>{release=resolve});
const late=sessionScope.session.setPermissionMode('bypassPermissions');
await Promise.resolve();selected='acceptEdits';release(true);await late;
assert.equal(selected,'acceptEdits');assert.equal(approvals.length,0,'a late full-access response may not approve after the user switches away');
console.log('Permissions passed: SDK capability and selected modes, pending Bash/MCP approval, explicit questions retained, no persistent rules, failed switch rollback.');
