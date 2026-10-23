// Assert actual service options and state transitions; no credentials or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=process.argv[2],require=createRequire(path.join(root,'package.json')),ts=require('typescript');
const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/shared/kicadReasoning.ts'),'utf8')),{module:mod,exports:mod.exports});
const {reasoningOptions,normalizeReasoning,reasoningEnvironment,codexReasoningEffort,registerReasoningModels,onReasoningModelsChanged}=mod.exports;
assert.deepEqual(Array.from(reasoningOptions('deepseek-flash'),v=>v.value),['default_on','off','low','high','max']);
assert.deepEqual(Array.from(reasoningOptions('opus'),v=>v.value),['default_on','off','low','medium','high','max']);
assert.deepEqual(Array.from(reasoningOptions('sonnet'),v=>v.value),['default_on','off','low','medium','high']);
assert.deepEqual(Array.from(reasoningOptions('haiku'),v=>v.value),['default_on','off']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-5-codex'),v=>v.value),['default_on','off','minimal','low','medium','high']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-5.1-codex-max'),v=>v.value),['default_on','off','minimal','low','medium','high','xhigh']);
assert.deepEqual(Array.from(reasoningOptions('codex:o3'),v=>v.value),['default_on','low','medium','high']);
assert.deepEqual(Array.from(reasoningOptions('gpt-5-pro'),v=>v.value),['default_on','high']);
// Static fallback before discovery: Claude 5.x keeps adaptive thinking on (no None tier).
assert.deepEqual(Array.from(reasoningOptions('claude-opus-5-5'),v=>v.value),['default_on','low','medium','high','xhigh','max']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-6.1-sol'),v=>v.value),['default_on','low','medium','high','xhigh','max']);
assert.equal(codexReasoningEffort('codex:gpt-6.1-sol','off'),undefined);
assert.deepEqual(Array.from(reasoningOptions('claude-opus-5-5'),v=>v.label),['Auto','Low','Medium','High','Extra High','Max']);
assert.equal(reasoningOptions('sonnet').find(v=>v.value==='high').description,'Highest level this model supports');
assert.equal(codexReasoningEffort('codex:gpt-5-codex','off'),'minimal');
assert.equal(codexReasoningEffort('codex:gpt-5.1-codex-max','off'),'none');
assert.equal(codexReasoningEffort('codex:gpt-5.1-codex-max','xhigh'),'xhigh');
assert.equal(codexReasoningEffort('codex:gpt-5-codex','xhigh'),'high');
assert.equal(codexReasoningEffort('codex:o3','minimal'),'low');
assert.equal(normalizeReasoning('deepseek-flash','medium'),'default_on');
assert.equal(normalizeReasoning('haiku','max'),'default_on');
assert.throws(()=>reasoningEnvironment('haiku','max'),/does not support/);
assert.equal(reasoningEnvironment('deepseek-v4-pro','max').CLAUDE_CODE_EFFORT_LEVEL,'max');
// Auto defers to Claude Code's own default (settings, then model); DeepSeek stays unset.
assert.deepEqual({...reasoningEnvironment('claude-opus-5-5','default_on')},{});
assert.equal(reasoningEnvironment('deepseek-flash','default_on').CLAUDE_CODE_EFFORT_LEVEL,'unset');
assert.equal(reasoningEnvironment('claude-opus-5-5','xhigh').CLAUDE_CODE_EFFORT_LEVEL,'xhigh');
// Discovered capabilities (shapes from claude 2.1.305 initialize and codex 0.163 model/list) win over the fallback.
let notified=0;const stop=onReasoningModelsChanged(()=>notified++);
registerReasoningModels([
 {value:'claude-opus-5-5',aliases:['default','opus'],reasoningEfforts:['low','medium','high','xhigh','max'],thinkingOff:false},
 {value:'claude-legacy-off',reasoningEfforts:['low','high'],thinkingOff:true},
 {value:'claude-no-effort',reasoningEfforts:[],thinkingOff:false},
 {value:'codex:gpt-6.1-sol',reasoningEfforts:['low','medium','high','xhigh','max','ultra']},
 {value:'codex:gpt-6-luna',reasoningEfforts:['low','medium','high','xhigh','max']},
 {value:'codex:gpt-none',reasoningEfforts:['none','minimal','low','turbo']},
 {value:'custom-without-capabilities'}]);
stop();assert.equal(notified,1);
for(const id of ['claude-opus-5-5','opus','default'])assert.deepEqual(Array.from(reasoningOptions(id),v=>v.value),['default_on','low','medium','high','xhigh','max'],id);
assert.deepEqual(Array.from(reasoningOptions('claude-legacy-off'),v=>v.value),['default_on','off','low','high']);
assert.deepEqual(Array.from(reasoningOptions('claude-no-effort'),v=>v.value),['default_on']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-6.1-sol'),v=>v.label),['Auto','Low','Medium','High','Extra High','Max','Ultra']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-6-luna'),v=>v.value),['default_on','low','medium','high','xhigh','max']);
assert.deepEqual(Array.from(reasoningOptions('codex:gpt-none'),v=>v.value),['default_on','off','minimal','low']);
assert.deepEqual(Array.from(reasoningOptions('custom-without-capabilities'),v=>v.value),['default_on','off']);
assert.equal(codexReasoningEffort('codex:gpt-6.1-sol','ultra'),'ultra');
assert.equal(codexReasoningEffort('codex:gpt-6-luna','ultra'),undefined);
assert.equal(codexReasoningEffort('codex:gpt-none','off'),'none');
assert.equal(normalizeReasoning('codex:gpt-6-luna','ultra'),'default_on');
assert.equal(normalizeReasoning('opus','off'),'default_on');
function method(file,cls,name){const tree=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);return tree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===cls).members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(tree)===name).getText(tree)}
const change=method('src/services/claude/ClaudeAgentService.ts','ClaudeAgentService','setThinkingLevel');
const channel={model:'deepseek-flash',sessionId:'same-session',cwd:'/fixture',permissionMode:'bypassPermissions',thinkingLevel:'high',busy:false},launches=[];
const scope={Map,channel,launches,reasoningEnvironment};
vm.runInNewContext(transpile(`class Service {channels=new Map([['c1',channel]]);closeChannel(id,notify){if(notify)throw Error('must retain stream');this.channels.delete(id)};async launchClaude(...args){launches.push(args);this.channels.set('c1',{...channel,thinkingLevel:args[5]})};${change}};globalThis.service=new Service();`),scope);
await scope.service.setThinkingLevel('c1','max');assert.equal(launches.length,0);assert.equal(channel.needsRestart,true);assert.equal(channel.thinkingLevel,'max');assert.equal(channel.sessionId,'same-session');assert.equal(channel.permissionMode,'bypassPermissions');
await scope.service.setThinkingLevel('c1','max');assert.equal(launches.length,0);
scope.service.channels.get('c1').busy=true;await assert.rejects(scope.service.setThinkingLevel('c1','low'),/Wait for/);assert.equal(launches.length,0);
scope.service.channels.get('c1').busy=false;await assert.rejects(scope.service.setThinkingLevel('c1','medium'),/does not support/);assert.equal(launches.length,0);
const setter=method('src/webview/src/core/Session.ts','Session','setThinkingLevel');
let selected='high',fail=true;
const ui={normalizeReasoning,Map,fixture:{level:(...v)=>v.length?(selected=v[0]):selected,connection:{setThinkingLevel:async()=>{if(fail)throw Error('fixture failure')}}}};
vm.runInNewContext(transpile(`class Session {busy=()=>false;configurationChanging=()=>{};reasoningChanging=false;reasoningByModel=new Map();thinkingLevel=fixture.level;modelSelection=()=> 'deepseek-flash';claudeChannelId=()=> 'c1';async getConnection(){return fixture.connection};${setter}};globalThis.session=new Session();`),ui);
await assert.rejects(ui.session.setThinkingLevel('max'),/fixture failure/);assert.equal(selected,'high');
fail=false;await ui.session.setThinkingLevel('low');assert.equal(selected,'low');
// During a turn the level is queued for the next request, never sent mid-turn.
let calls=0;const queued={normalizeReasoning,Map,fixture:{level:(...v)=>v.length?(selected=v[0]):selected,connection:{setThinkingLevel:async()=>{calls++}}}};
vm.runInNewContext(transpile(`class Session {busy=()=>true;configurationChanging=()=>{};reasoningChanging=false;pendingSettings=false;reasoningByModel=new Map();thinkingLevel=fixture.level;modelSelection=()=> 'deepseek-flash';claudeChannelId=()=> 'c1';async getConnection(){return fixture.connection};${setter}};globalThis.session=new Session();`),queued);
await queued.session.setThinkingLevel('max');assert.equal(selected,'max');assert.equal(calls,0);assert.equal(queued.session.pendingSettings,true);
await assert.rejects(queued.session.setThinkingLevel('medium'),/does not support/);assert.equal(selected,'max');
console.log('Reasoning passed: provider capabilities, invalid effort rejection, same session and permissions, busy guard, no optimistic state on failure.');

// A model switch must not claim success or change the visible model on failure.
const modelSetter=method('src/webview/src/core/Session.ts','Session','setModel');
let model='deepseek-flash',modelFail=true;
const switching={normalizeReasoning,Map,fixture:{model:(...v)=>v.length?(model=v[0]):model,level:(...v)=>v.length?(selected=v[0]):selected,connection:{config:()=>undefined,updateExtensionConfig:async()=>({success:true}),setModel:async()=>{if(modelFail)throw Error('model failure');return {success:true}},setThinkingLevel:async()=>{}}}};
vm.runInNewContext(transpile(`class Session {busy=()=>false;configurationChanging=()=>{};reasoningChanging=false;reasoningByModel=new Map();thinkingLevel=fixture.level;modelSelection=fixture.model;claudeChannelId=()=> 'c1';async getConnection(){return fixture.connection};${setter};${modelSetter}};globalThis.session=new Session();`),switching);
selected='max';await assert.rejects(switching.session.setModel({value:'sonnet'}),/model failure/);assert.equal(model,'deepseek-flash');assert.equal(selected,'max');
modelFail=false;await switching.session.setModel({value:'sonnet'});assert.equal(model,'sonnet');assert.equal(selected,'default_on');
await switching.session.setThinkingLevel('medium');await switching.session.setModel({value:'deepseek-flash'});assert.equal(selected,'default_on');
await switching.session.setModel({value:'sonnet'});assert.equal(selected,'medium');
console.log('Model changes passed: failure retains old selection, unsupported effort resets, remembered per-model choice restores.');
